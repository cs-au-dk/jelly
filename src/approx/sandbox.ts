import Module from "module";
import {theProxy} from "./proxy";
import {PREFIX, SPECIALS} from "./transform";

/**
 * Standard library modules that are not mocked.
 */
export const WHITELISTED = new Set([ // TODO: white-list some more standard library modules?
    "events", "buffer", "assert", "assert/strict", "constants", "crypto",
    "string_decoder", "util", "util/types", "path", "url", "tty", "sys"
]);

/**
 * Sandboxes global builtins.
 */
export function patchGlobalBuiltins() {
    const emptyFunction = function() {};
    const invokeCallbackWithArgs = function(cb: any, ...args: Array<any>) { cb(...args) };
    const invokeCallbackWithArgs2 = function(cb: any, _c: any, ...args: Array<any>) { cb(...args) };

    // replace globals
    const g = globalThis as any;
    g.clearImmediate = g.clearInterval = g.clearTimeout = g.fetch = emptyFunction;
    g.setImmediate = g.queueMicrotask = invokeCallbackWithArgs;
    g.setInterval = g.setTimeout = invokeCallbackWithArgs2;

    // replace process.*
    const p = process as any;
    p.on = p.send = p.chdir = p.exit = p.reallyExit = p.abort = p.dlopen = p.kill = p.openStdin = p.binding = p._linkedBinding = p.removeAllListeners = p.removeListener = p.off = theProxy;
    p.nextTick = invokeCallbackWithArgs;
    for (const prop of ["stdin", "stdout", "stderr"])
        Object.defineProperty(p, prop, {value: theProxy});

    // replace console.*
    const c = console as any;
    for (const p of Object.getOwnPropertyNames(Object.getPrototypeOf(console)))
        if (typeof c[p] === "function") c[p] = emptyFunction;
    c._stdout = c._stderr = theProxy;

    // replace Error.*, Atomics.*, Module.*
    Error.captureStackTrace = emptyFunction; // TODO: Error (parser writes to Error.prepareStackTrace)
    Atomics.wait = Atomics.waitAsync = theProxy;
    Module.register = function() {};

    // replace Module._load
    const realLoad = (Module as any)._load;
    (Module as any)._load = function(request: string, parent: any, isMain: boolean) {
        const result = realLoad.call(this, request, parent, isMain);
        const name = request.startsWith("node:") ? request.substring(5) : request;
        if (Module.isBuiltin(name) && !WHITELISTED.has(name))
            return (globalThis as any)[PREFIX + "builtin"]?.[name] ?? theProxy;
        return result;
    };

    // define typical test framework functions
    g.describe = g.it = g.before = g.beforeAll = g.beforeEach = g.after = g.afterAll = g.afterEach = g.test = g.define = emptyFunction;
    g.describe.skip = emptyFunction;
    g.expect = theProxy;
    // TODO: assign theProxy to all undeclared variables?

    g.Worker = theProxy;

    // DOM specific interface
    g.window = g.document = theProxy;

    // freeze objects and properties
    for (const x of [
        Array, ArrayBuffer, BigInt, Boolean, DataView, Date, /*Error,*/ AggregateError, EvalError, RangeError, ReferenceError,
        SyntaxError, TypeError, URIError, Intl, Int8Array, Uint8Array, Uint16Array, Int16Array, Uint32Array, Int32Array,
        Float32Array, Float64Array, Uint8ClampedArray, BigUint64Array, BigInt64Array, FinalizationRegistry, JSON, Map,
        Math, Number, Object, Promise, Proxy, Reflect, RegExp, Set, String, Symbol, WeakMap, WeakRef, WeakSet
    ]) {
        Object.freeze(x);
        if ("prototype" in x)
            Object.freeze(x.prototype);
    }
    Object.freeze(Function);
    for (const p of ["apply", "bind", "call"]) // must allow overwriting toString at functions
        Object.defineProperty(Function.prototype, p, { configurable: false, writable: false });
    for (const p of ["globalThis", "global", "Infinity", "NaN", "undefined", "eval", "isFinite", "isNaN", "parseFloat", "parseInt", ...SPECIALS, "$log"])
        Object.defineProperty(g, p, { configurable: false, writable: false });
    Object.freeze((Module as any)._extensions);
    Object.freeze(Module);
    Object.freeze(Module.prototype);
    Object.freeze(process);
    //Object.freeze(console); // TODO: parser writes to console.warn
    Object.freeze(Object.getPrototypeOf(module));
}