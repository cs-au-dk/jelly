import {AllocType, RequestType, ResponseType, WriteHint} from "../typings/hints";
import {FilePath, LocationJSON, mapArrayAdd, mapGetSet, mapSetToPairArray} from "../misc/util";
import {parseAndDesugar} from "../parsing/parser";
import {approxTransform, checkFile, PREFIX} from "./transform";
import {dirname, resolve} from "path";
import Module from "module";
import {Hints} from "./hints";
import {isProxy, makeBaseProxy, makeModuleProxy, stdlibProxy, theArgumentsProxy, theProxy} from "./proxy";
import logger, {logToFile, writeStdOutIfActive} from "../misc/logger";
import {options} from "../options";
import {preprocessAst} from "../parsing/extras";
import {pathToFileURL} from "url";
import {patchGlobalBuiltins, WHITELISTED} from "./sandbox";
import {inspect} from "util";

// get options from parent process
Object.assign(options, JSON.parse(process.argv[2]));

// prepare logging
logger.level = options.loglevel;
if (options.logfile)
    logToFile(options.logfile);

/**
 * Execution is aborted if loopCount reaches this limit.
 */
const LOOP_COUNT_LIMIT = 2500; // TODO: good value?

/**
 * Execution is aborted if stackSize reaches this limit.
 */
const STACK_SIZE_LIMIT = 50; // TODO: good value?

/**
 * Object allocation sites and types.
 */
const objLoc = new WeakMap<object, [LocationJSON, AllocType]>();

type Constructor = { new (...args: Array<any>): any }

/**
 * Functions and classes discovered but not yet visited.
 */
const unvisitedFunctionsAndClasses = new Map<LocationJSON, {fun: Function | Constructor, isClass?: boolean}>();

/**
 * Base objects for unvisited functions.
 */
const baseObjects = new Map<LocationJSON, Object>();

/**
 * Collected hints.
 */
const hints = new Hints();

/**
 * Stack of dynamic properties in objects and classes.
 * New entries are added by $init, contents added by $comp, used by $alloc.
 */
const constr: Array<Array<{
    mod: string,
    loc: string,
    prop: string,
    kind: "method" | "get" | "set" | "field",
    isStatic: boolean,
    isDynamic: boolean
}>> = [];

/**
 * Dynamic class instance fields for postponed write hints.
 */
const dynamicClassInstanceFields: WeakMap<object, Array<{
    mod: string,
    loc: string,
    prop: string
}>> = new WeakMap();

/**
 * Total number of times a loop body is entered.
 */
let loopCount = 0;

/**
 * Call stack size (approximate).
 */
let stackSize = 0;

/**
 * Flag that indicates if instrumentation is in progress.
 */
let instrumenting = false;

/**
 * Number of functions transformed for dynamically generated/loaded code.
 */
let numStaticFunctions = 0;

/**
 * Total size of code (excluding dynamically generated code).
 */
let totalCodeSize = 0;

/**
 * Map from module name to set of statically resolvable requires (excluding built-ins and aliases).
 */
const staticRequires = new Map<string, Set<string>>();

const NATIVE_CONSTRUCTORS = new Set([
    Object, Boolean, Error, AggregateError, EvalError, RangeError, ReferenceError, SyntaxError, TypeError,
    URIError, Number, BigInt, Date, String, RegExp, Array, Int8Array, Uint8Array, Uint8ClampedArray,
    Int16Array, Uint16Array, Int32Array, Uint32Array, BigInt64Array, BigUint64Array, Float32Array,
    Float64Array, Map, Set, WeakMap, WeakSet, ArrayBuffer, SharedArrayBuffer, DataView, Promise, Proxy
]);

function getLocationJSON(mod: string, loc: string): LocationJSON {
    return `${hints.moduleIndex.get(mod) ?? "?"}:${loc}`;
}

function getProp(prop: any): string {
    return typeof prop === "symbol" ? String(prop) : `"${String(prop)}"`;
}

function getObjLoc(obj: any): [LocationJSON | undefined, AllocType | undefined] {
    return objLoc.get(obj) ?? [undefined, undefined];
}

function locToString(obj: object): string {
    const lt = objLoc.get(obj);
    if (lt) {
        const [loc, type] = lt;
        return `${loc}:${type}`;
    } else
        return "?";
}

class ApproxError extends Error {

    constructor(msg: string) {
        super(msg);
    }

    toString() {
        return `ApproxError: ${this.message}`;
    }
}

function incrementStackSize() {
    if (stackSize++ > STACK_SIZE_LIMIT) {
        stackSize = 0;
        throw new ApproxError("Maximum stack size exceeded");
    }
}

function decrementStackSize() {
    stackSize--;
}

function handleException(ex: any): any {
    if (ex instanceof ApproxError || ex instanceof RangeError || ex.toString().startsWith("Error: Cannot find module"))
        throw ex; // ensures that abort, stack overflow, and module load exceptions do not get swallowed
    if (logger.isDebugEnabled())
        logger.debug(`Suppressed exception: ${ex}`);
    return theProxy;
}

/**
 * Process pending write hints for class instance fields.
 * @param fun function that has been instantiated
 * @param res new instance
 */
function processPendingWriteHints(fun: any, res: any) {
    const cs = dynamicClassInstanceFields.get(fun);
    if (cs) {
        for (const c of cs) {
            const val = Object.getOwnPropertyDescriptor(res, c.prop)?.value;
            const [baseLoc, baseType] = getObjLoc(res);
            const [valLoc, valType] = getObjLoc(val);
            if (baseLoc && baseType && valLoc && valType)
                hints.addWriteHint({
                    type: "normal",
                    loc: getLocationJSON(c.mod, c.loc),
                    baseLoc,
                    baseType,
                    prop: c.prop,
                    valLoc,
                    valType
                });
        }
        dynamicClassInstanceFields.delete(fun); // once per class is enough
    }
}

/**
 * Overriding of special native functions where the call location is needed.
 * @param mod module name
 * @param loc source location
 * @param base base value (undefined if absent)
 * @param fun function
 * @param args arguments
 * @param isNew true if constructor call
 * @return if proceed is true then proceed with the call, otherwise return the result value
 */
function callPre(mod: string, loc: string, base: any, fun: any, args: Array<any>, isNew: boolean): {proceed: boolean, result?: any} {
    if (fun === eval && !isNew) {
        const str = args[0];
        if (logger.isVerboseEnabled())
            logger.verbose(`Indirect eval ${mod}:${loc} (code length: ${typeof str === "string" ? str.length : "?"})`);
        if (typeof str === "string")
            hints.addEvalHint({
                loc: getLocationJSON(mod, loc),
                str
            });
        const result = fun(transform(mod, loc, str, "commonjs"));
        return {proceed: false, result};
    } else if (fun === Function) {
        const funargs = args.slice(0, args.length - 1);
        const funbody = args[args.length - 1] ?? "";
        let error = false;
        for (const a of funargs)
            if (typeof a !== "string") {
                error = true;
                break;
            }
        if (!error) {
            const str = `function anonymous(${funargs.join(",")}){${funbody}}`;
            if (logger.isVerboseEnabled())
                logger.verbose(`Function ${mod}:${loc} (code length: ${str.length})`);
            if (logger.isDebugEnabled())
                logger.debug(str);
            const result = fun(...funargs, transform(mod, loc, String(funbody), "commonjs"));
            hints.addEvalHint({
                loc: getLocationJSON(mod, loc),
                str
            });
            objLoc.set(result, [getLocationJSON(mod, loc), "Function"]);
            return {proceed: false, result};
        }
    } else if (fun.name === "require" && "resolve" in fun && "cache" in fun) { // probably a require function
        const str = typeof args[0] === "string" && args[0].startsWith("node:") ? args[0].substring(5) : args[0];
        if (Module.isBuiltin(str) && !WHITELISTED.has(str)) {
            if (logger.isDebugEnabled())
                logger.debug(`Intercepting require "${args[0]}"`);
            return {proceed: false, result: stdlibProxy(fun(args[0]))};
        }
    } else if (fun === Function.prototype.apply)
        return callPre(mod, loc, args[0], base, args[1] ?? [], false);
    else if (fun === Function.prototype.call)
        return callPre(mod, loc, args[0], base, args.slice(1), false);
    else if (fun === Reflect.apply)
        return callPre(mod, loc, args[1], args[0], args[2], false);
    else if (fun === Reflect.construct)
        return callPre(mod, loc, args[1], args[0], args[2], true);
    return {proceed: true};
}

/**
 * Post-processing of special native functions.
 * @param mod module name
 * @param loc source location
 * @param fun function
 * @param args arguments
 * @param val result value
 * @param base the receiver object, if method call
 */
function callPost(mod: string, loc: string, fun: any, args: Array<any>, val: any, base?: any) {

    /**
     * Copies properties according to a property descriptor.
     * @param to object to copy to
     * @param prop property
     * @param descriptor property descriptor
     */
    function copyFromDescriptor(to: any, prop: string, descriptor: PropertyDescriptor) {
        const [baseLoc, baseType] = getObjLoc(to);
        if (baseLoc && baseType) {
            if ("value" in descriptor) {
                const [valLoc, valType] = getObjLoc(descriptor.value);
                if (valLoc && valType)
                    hints.addWriteHint({
                        type: "normal",
                        loc: getLocationJSON(mod, loc),
                        baseLoc,
                        baseType,
                        prop,
                        valLoc,
                        valType
                    });
            }
            if ("get" in descriptor) {
                const [valLoc, valType] = getObjLoc(descriptor.get);
                if (valLoc && valType)
                    hints.addWriteHint({
                        type: "get",
                        loc: getLocationJSON(mod, loc),
                        baseLoc,
                        baseType,
                        prop,
                        valLoc,
                        valType
                    });
            }
            if ("set" in descriptor) {
                const [valLoc, valType] = getObjLoc(descriptor.set);
                if (valLoc && valType)
                    hints.addWriteHint({
                        type: "set",
                        loc: getLocationJSON(mod, loc),
                        baseLoc,
                        baseType,
                        prop,
                        valLoc,
                        valType
                    });
            }
        }
    }

    switch (fun) {
        case Object.create: {
            objLoc.set(val, [getLocationJSON(mod, loc), "Object"]);
            break;
        }
        case Object.assign: {
            const target = args.at(0);
            for (const arg of args.slice(1, args.length))
                for (const [prop, val] of Object.entries(Object.getOwnPropertyDescriptors(arg)))
                    if (val.enumerable)
                        copyFromDescriptor(target, prop, val);
            break;
        }
        case Object.defineProperty: {
            copyFromDescriptor(args.at(0), args.at(1), args.at(2))
            break;
        }
        case Object.defineProperties: {
            const target = args.at(0);
            for (const [prop, val] of Object.entries(args.at(1) as { [x: string]: PropertyDescriptor }))
                copyFromDescriptor(target, prop, val);
            break;
        }
        case Array.from:
        case Array.of:
        case Array.prototype.concat:
        case Array.prototype.flat:
        case Array.prototype.filter:
        case Array.prototype.slice: {
            objLoc.set(val, [getLocationJSON(mod, loc), "Array"]);
            break;
        }
        case Function.prototype.bind: {
            const [baseLoc, baseAllocType] = getObjLoc(base);
            if (!baseLoc || !baseAllocType)
                return;
            objLoc.set(val, [baseLoc, baseAllocType]);
            baseObjects.set(baseLoc, args[0]);
            break;
        }
        case Reflect.get: {
            // TODO: produce read hint for Reflect.get
            break;
        }
        case Reflect.set: {
            // TODO: produce write hint for Reflect.set
            break;
        }
        case Reflect.defineProperty: {
            // TODO: produce write hint for Reflect.defineProperty
            break;
        }
    }
}

/**
 * Instruments dynamically generated/loaded code.
 * @param mod module name
 * @param loc source location, undefined if entire module
 * @param code the code
 * @param mode CommonJS or ESM module
 * @return transformed code, or "" if transformation failed
 */
function transform(mod: string, loc: string | undefined, code: string, mode: "commonjs" | "module"): string {
    const name = loc ? `${mod}:eval[${loc}]` : mod;
    if (logger.isVerboseEnabled())
        logger.verbose(`Instrumenting ${name}`);
    instrumenting = true;
    try {
        const ast = parseAndDesugar(code, name);
        if (!ast) {
            logger.warn(`Parsing failed for ${name}`);
            return "";
        }
        preprocessAst(ast);
        const {transformed, staticRequires: sr, numStaticFunctions: nsf} = approxTransform(ast, code, name, mode);
        if (transformed === undefined) {
            logger.warn(`Instrumentation failed for ${name}`);
            return "";
        }
        if (!loc) // eval code doesn't count in numStaticFunctions
            numStaticFunctions += nsf;
        for (const req of sr)
            mapGetSet(staticRequires, mod).add(req);
        return transformed;
    } catch (err) {
        logger.error(`Error: Instrumentation failed for ${name}, ${err instanceof Error ? err.stack : err}`);
        return "";
    } finally {
        instrumenting = false;
    }
}

/**
 * Instruments a source file.
 * @param filename file path
 * @param code the code
 * @param mode CommonJS or ESM module
 */
function transformModule(filename: FilePath, code: string, mode: "commonjs" | "module"): string {
    let transformed;
    if (!(typeof (filename as any) === "string" && typeof (code as any) === "string")) // value likely generated by the proxy, ignore
        transformed = "";
    else if (!filename.startsWith(options.basedir)) {
        if (logger.isVerboseEnabled())
            logger.verbose(`Ignoring module outside basedir: ${filename}`);
        transformed = mode === "commonjs" ? `module.exports = ${PREFIX}proxy` : "";
    } else {
        try {
            checkFile(filename);
        } catch (err) {
            logger.error(err);
            return "";
        }
        if (options.printProgress && logger.isInfoEnabled())
            writeStdOutIfActive(`Loading module ${filename} (${Math.ceil(code.length / 1024)}KB)`);
        totalCodeSize += code.length;
        transformed = transform(filename, undefined, code, mode); // using filename as module name, manager will convert
    }
    return transformed;
}

const g = globalThis as any;

for (const [name, val] of Object.entries({

    /**
     * The proxy mock object.
     */
    proxy: theProxy,

    /**
     * Sandboxed builtin modules (used by hooks.ts).
     */
    builtin: Object.fromEntries(Module.builtinModules
        .filter(m => !WHITELISTED.has(m))
        .map(m => [m, stdlibProxy(require(m))])),

    /**
     * Records the entry of a module.
     * Also wraps the module object to prevent access to module.constructor.
     */
    start(mod: string, modobj?: typeof module | false): any {
        const i = hints.addModule(mod);
        if (logger.isDebugEnabled())
            logger.debug(`$start ${mod}: ${i}`);
        if (modobj && modobj.exports) { // undefined for ESM modules (don't have dynamic exports anyway)
            objLoc.set(modobj.exports, [`${i}:-1:-1:-1:-1`, "Object"]); // allocation site for module.exports
            return makeModuleProxy(modobj);
        }
        return undefined;
    },

    /**
     * Records the entry of an object expression or class.
     */
    init() {
        logger.debug("$init");
        constr.push([]);
    },

    /**
     * Records the exit of an object expression, class or function and collects the allocation sites.
     * @param mod module name
     * @param loc source location
     * @param obj new object
     * @param hasInit if true, the call matches a call to $init
     * @param isClass if true, the object is a class constructor
     * @return the new object
     */
    alloc(mod: string, loc: string, obj: any, hasInit?: boolean, isClass?: boolean): typeof obj {
        if (typeof obj === "object" || typeof obj === "function" || Array.isArray(obj)) {
            if (logger.isDebugEnabled())
                logger.debug(`$alloc ${mod}:${loc}: ${Array.isArray(obj) ? "array" : typeof obj}`);
            const s = getLocationJSON(mod, loc);
            if (Array.isArray(obj))
                objLoc.set(obj, [s, "Array"]); // allocation site for array
            else if (typeof obj === "object")
                objLoc.set(obj, [s, "Object"]); // allocation site for object expression
            else {
                if (isClass)
                    objLoc.set(obj, [s, "Class"]); // allocation site for class
                else
                    objLoc.set(obj, [s, "Function"]); // allocation site for function
                if (obj.prototype)
                    objLoc.set(obj.prototype, [s, "Prototype"]); // allocation site for (non-arrow) function or class prototype
            }
            if (typeof obj === "function" && !hints.functions.has(s) && !unvisitedFunctionsAndClasses.has(s))
                unvisitedFunctionsAndClasses.set(s, {fun: obj, isClass});
            if (hasInit)
                for (const c of constr.pop()!) {
                    let type: WriteHint["type"];
                    let valLoc: LocationJSON | undefined, valType: AllocType | undefined;
                    let baseLoc = s, baseType: AllocType | undefined;
                    if (typeof obj === "function") { // class
                        baseType = c.isStatic ? "Class" : "Prototype";
                        const desc = Object.getOwnPropertyDescriptor(c.isStatic ? obj : obj.prototype, c.prop);
                        switch (c.kind) {
                            case "field":
                                if (!c.isStatic) {
                                    // class instance field, need to postpone hint until location of value is known at 'new'
                                    mapArrayAdd(obj, c, dynamicClassInstanceFields);
                                    continue;
                                }
                                type = "normal";
                                [valLoc, valType] = getObjLoc(desc?.value);
                                break;
                            case "method":
                                type = "normal";
                                valLoc = getLocationJSON(c.mod, c.loc);
                                valType = "Function";
                                const v = desc?.value;
                                if (v)
                                    objLoc.set(v, [valLoc, valType]);
                                break;
                            case "get":
                            case "set":
                                type = c.kind;
                                valLoc = getLocationJSON(c.mod, c.loc);
                                valType = "Function";
                                const a = desc?.[c.kind];
                                if (a)
                                    objLoc.set(a, [valLoc, valType]);
                                break;
                        }
                    } else { // object
                        baseType = "Object";
                        const desc = Object.getOwnPropertyDescriptor(obj, c.prop);
                        switch (c.kind) {
                            case "field":
                                type = "normal";
                                [valLoc, valType] = getObjLoc(desc?.value);
                                break;
                            case "method":
                                type = "normal";
                                valLoc = getLocationJSON(c.mod, c.loc);
                                valType = "Function";
                                const v = desc?.value;
                                if (v)
                                    objLoc.set(v, [valLoc, valType]);
                                break;
                            case "get":
                            case "set":
                                type = c.kind;
                                valLoc = getLocationJSON(c.mod, c.loc);
                                valType = "Function";
                                const a = desc?.[c.kind];
                                if (a)
                                    objLoc.set(a, [valLoc, valType]);
                                break;
                        }
                    }
                    if (c.isDynamic && valLoc && valType)
                        hints.addWriteHint({
                            type,
                            loc: getLocationJSON(c.mod, c.loc),
                            baseLoc,
                            baseType,
                            prop: c.prop,
                            valLoc,
                            valType
                        });
                }
        }
        return obj;
    },

    /**
     * Performs a (static or dynamic) property write operation and collects a write hint.
     * @param mod module name
     * @param loc source location
     * @param base base value
     * @param prop property value
     * @param val value being assigned
     * @param isDynamic if true, the property name is a computed value
     * @return the value being assigned
     */
    pw(mod: string, loc: string, base: any, prop: any, val: any, isDynamic: boolean): typeof val {
        if (base === undefined) {
            if (logger.isDebugEnabled())
                logger.debug(`Suppressed exception: TypeError: Cannot set properties of undefined`);
            return undefined;
        }
        if (typeof prop === "symbol" || Array.isArray(base))
            return base[prop]; // ignoring symbols and writes to arrays
        if (isProxy(base) || isProxy(val))
            return theProxy;
        const p = String(prop);
        if (logger.isDebugEnabled())
            logger.debug(`$pw ${mod}:${loc}: ${locToString(base)}${isDynamic ? `[${getProp(prop)}]` : `.${String(prop)}`} = ${locToString(val)}`);
        try {
            base[p] = val;
        } catch (ex) {
            if (logger.isDebugEnabled())
                logger.debug(`Suppressed exception: ${ex}`);
        }
        if (typeof val === "function") {
            const loc = objLoc.get(val);
            if (loc) {
                const [funloc] = loc;
                if (!baseObjects.has(funloc))
                    baseObjects.set(funloc, base);
            }
        }
        const [baseLoc, baseType] = getObjLoc(base);
        const [valLoc, valType] = getObjLoc(val);
        if (baseLoc && baseType && valLoc && valType)
            hints.addWriteHint({
                type: "normal",
                loc: getLocationJSON(mod, loc),
                baseLoc,
                baseType,
                prop: p,
                valLoc,
                valType
            });
        return val;
    },

    /**
     * Performs a dynamic property read operation and collects a read hint.
     * @param mod module name
     * @param loc source location
     * @param base base value
     * @param prop property value
     * @return the result value
     */
    dpr(mod: string, loc: string, base: any, prop: any): any {
        if (base === undefined) {
            if (logger.isDebugEnabled())
                logger.debug(`Suppressed exception: TypeError: Cannot read properties of undefined`);
            return undefined;
        }
        if (Array.isArray(base))
            return base[prop]; // ignoring reads from arrays
        if (isProxy(base))
            return theProxy;
        const p = typeof prop === "symbol" ? prop : String(prop);
        let val;
        try {
            val = base[p];
        } catch (ex) {
            if (logger.isDebugEnabled())
                logger.debug(`Suppressed exception: ${ex}`);
            return theProxy;
        }
        if (isProxy(val))
            return theProxy;
        if (logger.isDebugEnabled())
            logger.debug(`$dpr ${mod}:${loc}: ${locToString(base)}[${getProp(prop)}] -> ${locToString(val)}`);
        const [valLoc, valType] = getObjLoc(val);
        if (valLoc && valType)
            hints.addReadHint({
                loc: getLocationJSON(mod, loc),
                prop: typeof p === "string" ? p : undefined,
                valLoc,
                valType
            });
        return val;
    },

    /**
     * Performs a function call and models special native functions.
     * @param mod module name
     * @param loc source location
     * @param fun function being called
     * @param isOptionalCall if true, this is an optional call
     * @param args arguments
     * @return the call result value
     */
    fun(mod: string, loc: string, fun: any, isOptionalCall: boolean, ...args: Array<any>): any {
        if (logger.isDebugEnabled())
            logger.debug(`$fun ${mod}:${loc}${isOptionalCall ? " optional" : ""}`);
        if (isOptionalCall && (fun === undefined || fun === null))
            return undefined;
        if (typeof fun !== "function")
            return theProxy;
        try {
            incrementStackSize();
            const {proceed, result} = callPre(mod, loc, undefined, fun, args, false);
            if (proceed) {
                const res = Reflect.apply(fun, undefined, args);
                callPost(mod, loc, fun, args, res);
                return res;
            } else
                return result;
        } catch (ex) {
            return handleException(ex);
        } finally {
            decrementStackSize();
        }
    },

    /**
     * Performs a method call and models special native functions.
     * @param mod module name
     * @param loc source location
     * @param base base value
     * @param prop property value
     * @param isDynamic if true, the method name is a computed value
     * @param isOptionalMember if true, the method expression is an optional member expression
     * @param isOptionalCall if true, this is an optional call
     * @param args arguments
     * @return the call result value
     */
    method(mod: string, loc: string, base: any, prop: any, isDynamic: boolean, isOptionalMember: boolean, isOptionalCall: boolean, ...args: Array<any>): any {
        if (logger.isDebugEnabled())
            logger.debug(`$method ${mod}:${loc}${isDynamic ? " dynamic" : ""}${isOptionalMember ? " optionalMember" : ""}${isOptionalCall ? " optionalCall" : ""}`);
        let fun;
        try {
            fun = isOptionalMember && (base === undefined || base === null) ? undefined : base[prop];
        } catch (ex) {
            if (logger.isDebugEnabled())
                logger.debug(`Suppressed exception: ${ex}`);
            return theProxy;
        }
        if (isOptionalCall && (fun === undefined || fun === null))
            return undefined;
        if (typeof fun !== "function") {
            if (logger.isDebugEnabled())
                logger.debug(`Suppressed exception: TypeError: Must be a function`);
            return theProxy;
        }
        try {
            incrementStackSize();
            const {proceed, result} = callPre(mod, loc, base, fun, args, false);
            if (proceed) {
                const res = Reflect.apply(fun, base, args);
                callPost(mod, loc, fun, args, res, base);
                return res;
            } else
                return result;
        } catch (ex) {
            return handleException(ex);
        } finally {
            decrementStackSize();
        }
    },

    /**
     * Performs a 'new' operation.
     * @param mod module name
     * @param loc source location
     * @param fun the constructor to instantiate
     * @param args arguments
     * @return the result value
     */
    new(mod: string, loc: string, fun: any, ...args: any): any {
        logger.debug("$new");
        if (typeof fun !== "function") {
            if (logger.isDebugEnabled())
                logger.debug(`Suppressed exception: TypeError: Must be a function`);
            return theProxy;
        }
        try {
            incrementStackSize();
            const {proceed, result} = callPre(mod, loc, undefined, fun, args, true);
            if (proceed) {
                const res = Reflect.construct(fun, args) as any;
                processPendingWriteHints(fun, res);
                if (NATIVE_CONSTRUCTORS.has(fun) && (typeof res === "object" || typeof res === "function")) {
                    const t =
                        typeof res === "object" ? "Object" :
                            typeof res === "function" ? "Function" :
                                Array.isArray(res) ? "Array" :
                                    undefined;
                    if (t)
                        objLoc.set(res, [getLocationJSON(mod, loc), t]);
                }
                return res;
            } else
                return result;
        } catch (ex) {
            return handleException(ex);
        } finally {
            decrementStackSize();
        }
    },

    /**
     * Records a dynamic property to be processed later by $alloc.
     * @param mod module name
     * @param loc source location
     * @param prop property value
     * @param kind kind of property
     * @param isStatic if true this is a static field
     * @param isDynamic if true, the property name is a computed value
     * @return the property value
     */
    comp(mod: string, loc: string, prop: any, kind: "method" | "get" | "set" | "field", isStatic: boolean, isDynamic: boolean): typeof prop {
        if (logger.isDebugEnabled())
            logger.debug(`$comp ${mod}:${loc} ${getProp(prop)} ${kind}`);
        if (typeof prop !== "symbol")
            constr.at(constr.length - 1)!.push({mod, loc, prop: String(prop), kind, isStatic, isDynamic});
        return prop;
    },

    /**
     * Registers that a function or class constructor has been visited.
     * @param mod module name
     * @param loc source location
     */
    enter(mod: string, loc: string) {
        if (logger.isDebugEnabled())
            logger.debug(`$enter ${mod}:${loc}`);
        const s = getLocationJSON(mod, loc);
        unvisitedFunctionsAndClasses.delete(s);
        hints.addFunction(s);
    },

    /**
     * Registers 'this' in a function or class constructor.
     * @param mod module name
     * @param loc source location
     * @param thiss the 'this' object
     * @returns the 'this' object
     */
    this(mod: string, loc: string, thiss: object | null): object | null {
        logger.debug(`$this ${mod}:${loc}`);
        if (thiss) {
            const s = getLocationJSON(mod, loc);
            objLoc.set(thiss, [s, "Object"]); // allocation site for 'new' expression
        }
        return thiss;
    },

    /**
     * Invoked when entering a catch block to make sure AbortExceptions are passed through.
     * @param ex the exception
     */
    catch(ex: any) {
        logger.debug("$catch");
        if (ex instanceof ApproxError)
            throw ex; // ensures that abort exceptions do not get swallowed
    },

    /**
     * Invoked when entering a loop body to terminate long-running executions.
     */
    loop() {
        logger.debug("$loop");
        if (loopCount++ > LOOP_COUNT_LIMIT) {
            loopCount = 0;
            throw new ApproxError("Loop limit reached");
        }
    },

    /**
     * Records a direct eval call and instruments the code.
     * @param mod module name
     * @param loc source location
     * @param str eval string
     * @return the instrumented eval string
     */
    eval(mod: string, loc: string, str: any): string {
        if (logger.isDebugEnabled())
            logger.debug(`$eval ${mod}:${loc} (code length: ${typeof str === "string" ? str.length : "?"})`);
        if (typeof str === "string")
            hints.addEvalHint({
                loc: getLocationJSON(mod, loc),
                str
            });
        return transform(mod, loc, str, "commonjs");
    },

    /**
     * Records a dynamic require/import.
     * @param mod name of module containing the require/import
     * @param loc source location
     * @param str module string
     * @return the module string
     */
    require(mod: string, loc: string, str: any): any {
        if (Module.isBuiltin(str))
            return str;
        if (logger.isDebugEnabled())
            logger.debug(`$require ${mod}:${loc} "${str}"`);
        if (typeof str === "string")
            hints.addRequireHint({
                loc: getLocationJSON(mod, loc),
                str
            });
        return str;
    },

    /**
     * Freezes the given object.
     */
    freeze(obj: any) {
        Object.freeze(obj);
    }

}))
    g[PREFIX + name] = val;

/**
 * Log function for testing and debugging.
 * @param msg message
 */
g.$log = function(msg: any) {
    writeStdOutIfActive("");
    logger.info(`$log: ${inspect(msg, {depth: 1})}`);
}

const realSetTimeout = setTimeout;

/**
 * Performs forced execution of functions that have been found but not visited.
 */
async function forceExecuteUnvisitedFunctions(): Promise<{numForced: number, numForcedExceptions: number}> {
    let numForced = 0, numForcedExceptions = 0;
    for (const [loc, {fun, isClass}] of unvisitedFunctionsAndClasses) {
        const sloc = `${hints.modules[parseInt(loc)]}${loc.substring(loc.indexOf(":"))}`;
        if (options.printProgress && logger.isInfoEnabled())
            (logger.isVerboseEnabled() ? logger.verbose : writeStdOutIfActive)(`Force-executing ${isClass ? "constructor" : "function"} ${sloc} (${unvisitedFunctionsAndClasses.size - 1} pending)`);
        try {
            const args = theArgumentsProxy;
            if (isClass)
                Reflect.construct(fun, args);
            else {
                const base = baseObjects.get(loc);
                let res = Reflect.apply(fun, makeBaseProxy(base), args);
                if (res && typeof res === "object" && (Symbol.iterator in res || Symbol.asyncIterator in res) && typeof res.next === "function") // fun is a generator function
                    res.next(); // TODO: currently only invoking 'next' once
                if (res instanceof Promise) {
                    if (logger.isDebugEnabled())
                        logger.debug("Awaiting promise");
                    res = await Promise.race([res, new Promise(resolve => realSetTimeout(resolve, 100))]);
                }
            }
            if (logger.isDebugEnabled())
                logger.debug("Function completed successfully");
        } catch (err) {
            if (logger.isVerboseEnabled())
                logger.verbose(`Function completed with exception: ${err instanceof Error && logger.isDebugEnabled() ? err.stack : err}`);
            numForcedExceptions++;
        }
        numForced++;
        unvisitedFunctionsAndClasses.delete(loc);
        baseObjects.delete(loc);
        loopCount = 0;
        if (!hints.functions.has(loc))
            logger.error(`Error: Function ${sloc} should be visited now`);
    }
    return {numForced, numForcedExceptions};
}

// intercept ESM module loading
const {port1, port2} = new MessageChannel();
Module.register("./hooks.js", {
    parentURL: pathToFileURL(__filename),
    data: {
        opts: options,
        port2
    },
    transferList: [port2]
});
port1.on("message",(msg:
                        {type: "log", level: string, str: string} |
                        {type: "transform", filename: FilePath, source: string}) => {
    switch (msg.type) {
        case "log": {
            const {level, str} = msg;
            logger.log(level, str);
            break;
        }
        case "transform": {
            const {filename, source} = msg;
            const transformed = transformModule(filename, source, "module");
            port1.postMessage({filename, transformed});
            break;
        }
    }
});

// intercept CJS module loading
const realCompile = (Module as any).prototype._compile;
(Module as any).prototype._compile = function(content: unknown, filename: unknown): any {
    if (typeof content !== "string" || typeof filename !== "string")
        return; // protect against accidental calls
    const orig = content;
    if (!instrumenting) { // prevents instrumentation of Jelly runtime modules
        if (logger.isVerboseEnabled())
            logger.verbose(`Loading ${filename} (CJS loader)`);
        content = transformModule(filename, orig, "commonjs");
    }
    try {
        return realCompile.call(this, content, filename);
    } catch (err) {
        if (String(err).includes("SyntaxError"))
            logger.verbose(`Unable to load ${filename} (trying to load ESM module as CJS?)`); // TODO: retry using ESM loader?
        else
            logger.warn(`Unable to load ${filename}: ${err instanceof Error && logger.isDebugEnabled() ? err.stack : err}`);
        return realCompile.call(this, `module.exports = ${PREFIX}proxy`, filename);
    }
}

// detect uncaught exceptions
process.on('uncaughtException', (err: any) => {
    logger.warn(`Unexpected exception (insufficient sandboxing?): ${err instanceof Error && logger.isDebugEnabled() ? err.stack : err}`); // should not happen if sandboxing is done properly
});
process.on("unhandledRejection", (err) => {
    logger.verbose(`Unhandled promise rejection: ${err instanceof Error ? err.stack : err}`); // (usually harmless)
});

// evaluate the code received from the master process, force execute unvisited functions, and return the resulting hints
const chdir = process.chdir.bind(process);
const send = process.send!.bind(process);
const dynamicImport = new Function("s", "return import(s)") as (s: URL) => Promise<any>; // prevents ts compilation to require
process.on('message', async (msg: RequestType) => {
    logger.verbose(`Starting approximate interpretation of ${msg.file}`);
    let moduleException = false;
    module.filename = __filename = msg.file;
    module.path = __dirname = dirname(msg.file);
    module.paths = [resolve(__dirname, "node_modules")];
    chdir(__dirname);
    try {
        await dynamicImport(pathToFileURL(msg.file)); // TODO: not awaiting dynamic imports that are executed via module top-level code
        if (logger.isDebugEnabled())
            logger.debug(`Module completed successfully: ${msg.file}`);
    } catch (err) {
        if (logger.isVerboseEnabled())
            logger.verbose(`Uncaught exception for ${msg.file}: ${err instanceof Error && logger.isDebugEnabled() ? err.stack : err}`);
        moduleException = true;
    }
    loopCount = 0;
    const {numForced, numForcedExceptions} = await forceExecuteUnvisitedFunctions();
    logger.verbose("Approximate interpretation completed");
    send!({
        hints: hints.toJSON(),
        numForced,
        numForcedExceptions,
        moduleException,
        numStaticFunctions,
        totalCodeSize,
        staticRequires: mapSetToPairArray(staticRequires)
    } satisfies ResponseType);
    hints.clearHints(); // keeping visited modules and functions, but the hints are no longer needed in this process
    numStaticFunctions = 0;
    staticRequires.clear();
});

// sandbox global builtins
patchGlobalBuiltins();
