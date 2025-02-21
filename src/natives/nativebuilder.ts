import {CallExpression, identifier, Identifier, NewExpression, OptionalCallExpression, SourceLocation} from "@babel/types";
import Solver from "../analysis/solver";
import {NativeObjectToken} from "../analysis/tokens";
import {ModuleInfo} from "../analysis/infos";
import {ecmascriptModels} from "./ecmascript";
import {NodePath} from "@babel/traverse";
import {nodejsModels} from "./nodejs";
import {options} from "../options";
import logger from "../misc/logger";
import {Operations} from "../analysis/operations";
import {Location} from "../misc/util";
import {ObjectPropertyVarObj} from "../analysis/constraintvars";

export type CallNodePath = NodePath<CallExpression | OptionalCallExpression | NewExpression>;

export type NativeModelParams = {
    solver: Solver,
    moduleInfo: ModuleInfo,
    moduleSpecialNatives: SpecialNativeObjects,
    globalSpecialNatives: SpecialNativeObjects
};

export type NativeFunctionParams = NativeModelParams & {
    base: ObjectPropertyVarObj | undefined,
    op: Operations,
    path: CallNodePath
};

export type NativeFunctionAnalyzer = (p: NativeFunctionParams) => void;

export type NativeModelInitializer = (p: NativeModelParams) => void;

export type NativeVariableInitializer = (p: NativeModelParams) => NativeObjectToken;

export type NativeModel = {
    name: string,
    init?: NativeModelInitializer,
    variables?: Array<NativeVariableModel>,
    params?: Array<NativeVariableModel>,
    functions: Array<NativeFunctionModel>,
    classes: Array<NativeClassModel>
}

export type NativeVariableModel = {
    name: string,
    init?: NativeVariableInitializer
};

export type NativeFunctionModel = {
    name: string,
    invoke?: NativeFunctionAnalyzer
};

export type NativeFieldModel = {
    name: string
};

export type NativeClassModel = {
    name: string,
    hidden?: boolean,
    invoke?: NativeFunctionAnalyzer,
    fields?: Array<NativeFieldModel>, // TODO: NativeObjectModel.fields is current unused
    staticMethods?: Array<NativeFunctionModel>,
    methods?: Array<NativeFunctionModel>
};

export type SpecialNativeObjects = Map<string, NativeObjectToken>;

/**
 * Prepares models for the ECMAScript and Node.js native declarations.
 * Returns the global identifiers and the tokens for special native objects.
 */
export function buildNatives(solver: Solver, moduleInfo: ModuleInfo): {globals: Array<Identifier>, globalsHidden: Array<Identifier>, moduleSpecialNatives: SpecialNativeObjects, globalSpecialNatives: SpecialNativeObjects} {
    const globals: Array<Identifier> = [];
    const globalsHidden: Array<Identifier> = [];
    const moduleSpecialNatives: SpecialNativeObjects = new Map;
    const globalSpecialNatives: SpecialNativeObjects = new Map;
    const f = solver.fragmentState;
    const a = solver.globalState;
    solver.phase = "init";

    const models = [ecmascriptModels, nodejsModels];
    for (const m of models) {
        const moduleLoc: Location = {start: {line: 0, column: 0}, end: {line: 0, column: 0}, module: moduleInfo, native: `%${m.name}`};
        const globalLoc: Location = {start: {line: 0, column: 0}, end: {line: 0, column: 0}, native: `%${m.name}`}; // dummy location for global identifiers

        /**
         * Adds an identifier to the global scope.
         * @param name identifier name
         * @param moduleSpecific if true, the token and identifier will belong to the current module
         * @param invoke optional model of calls if a function
         * @param constr if true, the function is a constructor (default: false)
         * @param hidden if true, the identifier is not added to globals
         * @param init if provided, execute this initializer instead of using a fresh NativeObjectToken
         */
        function defineGlobal(name: string, moduleSpecific: boolean = false, invoke?: NativeFunctionAnalyzer, constr: boolean = false, hidden: boolean = false, init?: NativeVariableInitializer) {
            if (options.natives || m.name === "ecmascript" || (m.name === "nodejs" && ["exports", "module"].includes(name))) {
                let id = solver.globalState.canonicalGlobals.get(name);
                if (!id) {
                    id = identifier(name);
                    id.loc = (moduleSpecific ? moduleLoc : globalLoc) as SourceLocation; // ignoring filename, identifierName, start.index, end.index
                    if (!moduleSpecific)
                        solver.globalState.canonicalGlobals.set(name, id);
                }
                (hidden ? globalsHidden : globals).push(id);
                const t = init
                    ? init({solver, moduleInfo, moduleSpecialNatives, globalSpecialNatives})
                    : a.canonicalizeToken(new NativeObjectToken(name, moduleSpecific ? moduleInfo : undefined, invoke, constr));
                solver.addTokenConstraint(t, f.varProducer.nodeVar(id));
                (moduleSpecific ? moduleSpecialNatives : globalSpecialNatives).set(name, t);
            }
        }

        /**
         * Adds a global function.
         */
        function defineGlobalFunction(name: string, invoke: NativeFunctionAnalyzer | undefined, constr: boolean = false, hidden: boolean = false) {
            defineGlobal(name, undefined, invoke, constr, hidden);
        }

        /**
         * Adds a prototype object for a class.
         */
        function definePrototypeObject(name: string): NativeObjectToken {
            const t = a.canonicalizeToken(new NativeObjectToken(`${name}.prototype`));
            if (m.name === "ecmascript")
                globalSpecialNatives.set(t.name, t);
            if (options.natives || m.name === "ecmascript")
                solver.addTokenConstraint(t, f.varProducer.objPropVar(globalSpecialNatives.get(name)!, "prototype"));
            return t;
        }

        /**
         * Adds a field to an object.
         */
        function defineField(x: NativeClassModel, nf: NativeFieldModel) {
            // TODO: defineField (ignored for now...)
        }

        /**
         * Adds a static method to an object.
         */
        function defineStaticMethod(x: NativeClassModel, nf: NativeFunctionModel) {
            if (options.natives) {
                const t = a.canonicalizeToken(new NativeObjectToken(`${x.name}.${nf.name}`, undefined, nf.invoke));
                if (m.name === "ecmascript")
                    globalSpecialNatives.set(t.name, t);
                solver.addTokenConstraint(t, f.varProducer.objPropVar(globalSpecialNatives.get(x.name)!, nf.name));
            }
        }

        /**
         * Adds a (non-static) method to an object.
         */
        function defineMethod(x: NativeClassModel, nf: NativeFunctionModel, pro: NativeObjectToken) {
            if (options.natives) {
                const t = a.canonicalizeToken(new NativeObjectToken(`${x.name}.prototype.${nf.name}`, undefined, nf.invoke));
                if (m.name === "ecmascript")
                    globalSpecialNatives.set(t.name, t);
                solver.addTokenConstraint(t, f.varProducer.objPropVar(pro, nf.name));
            }
        }

        if (logger.isVerboseEnabled())
            logger.verbose(`Adding ${m.name}`);

        // implicit parameters
        if (m.params)
            for (const v of m.params)
                defineGlobal(v.name, true, undefined, undefined, undefined, v.init);

        // global variables
        if (m.variables)
            for (const v of m.variables)
                defineGlobal(v.name, undefined, undefined, undefined, undefined, v.init);

        // global functions
        for (const f of m.functions)
            defineGlobalFunction(f.name, f.invoke);

        // global classes
        for (const x of m.classes) {
            defineGlobalFunction(x.name, x.invoke, true, x.hidden);
            const pro = definePrototypeObject(x.name);

            // fields
            if (x.fields)
                for (const v of x.fields)
                    defineField(x, v);

            // static methods
            if (x.staticMethods)
                for (const f of x.staticMethods)
                    defineStaticMethod(x, f);

            // non-static methods
            if (x.methods)
                for (const f of x.methods)
                    defineMethod(x, f, pro);
        }
    }

    // specialized initialization
    for (const m of models)
        if (m.init) {
            if (logger.isVerboseEnabled())
                logger.verbose(`Running initialization for ${m.name}`);
            m.init({solver, moduleInfo, moduleSpecialNatives, globalSpecialNatives});
        }
    if (logger.isVerboseEnabled())
        logger.verbose("Adding natives completed");

    return {globals, globalsHidden, moduleSpecialNatives, globalSpecialNatives};
}
