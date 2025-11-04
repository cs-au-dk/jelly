import {NativeFunctionParams, NativeModel, NativeModelParams} from "./nativebuilder";
import {ArrayToken, NativeObjectToken} from "../analysis/tokens";
import {invokeCallback} from "./nativehelpers";

/*
 * Models of Node.js standard built-in objects.
 * See https://nodejs.org/api/ and https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node.
 * Primitive values and accessor properties are ignored; only functions and objects are modeled.
 */
export const nodejsModels: NativeModel = {
    name: "nodejs",
    init: (p: NativeModelParams) => {
        const a = p.solver.globalState;
        const vp = p.solver.varProducer;
        // module.exports = exports (when writing to module.exports, also write to %exports.default)
        const exp = p.moduleSpecialNatives["exports"];
        const req = a.canonicalizeToken(new NativeObjectToken("require", p.moduleInfo));
        const mod = p.moduleSpecialNatives["module"];
        p.solver.addTokenConstraint(exp, vp.objPropVar(mod, "exports"));
        p.solver.addTokenConstraint(exp, vp.objPropVar(exp, "default"));
        // model 'arguments' of module wrapper function
        const prog = a.modules.get(p.moduleInfo)!;
        const args = a.canonicalizeToken(new ArrayToken(prog));
        p.solver.addTokenConstraint(args, vp.argumentsVar(prog));
        p.solver.addTokenConstraint(exp, vp.objPropVar(args, "0"));
        p.solver.addTokenConstraint(req, vp.objPropVar(args, "1"));
        p.solver.addTokenConstraint(mod, vp.objPropVar(args, "2"));
        // model require.extensions
        const reqext = a.canonicalizeToken(new NativeObjectToken("require.extensions", p.moduleInfo));
        p.solver.addTokenConstraint(reqext, vp.objPropVar(req, "extensions"));
        // TODO: model module.require? (resolves relative to that module!)
    },
    params: [
        {
            name: "require"
        },
        {
            name: "module"
        },
        {
            name: "exports"
        },
        {
            name: "__filename"
        },
        {
            name: "__dirname"
        }
    ],
    variables: [
        {
            name: "console" // TODO: see https://nodejs.org/api/console.html
        },
        {
            name: "global",
            init: (p: NativeModelParams) => {
                return p.globalSpecialNatives["globalThis"];
            }
        },
        {
            name: "performance"// TODO: 'performance' is a property on globalThis
        },
        {
            name: "process" // TODO: see https://nodejs.org/api/process.html#process
        }
    ],
    functions: [ // TODO: these are properties on globalThis, see also 'fetch'
        {
            name: "atob"
        },
        {
            name: "btoa"
        },
        {
            name: "clearImmediate"
        },
        {
            name: "clearInterval"
        },
        {
            name: "clearTimeout"
        },
        {
            name: "queueMicrotask",
            invoke: (p: NativeFunctionParams) => {
                invokeCallback("queueMicrotask", p);
            }
        },
        {
            name: "setImmediate",
            invoke: (p: NativeFunctionParams) => {
                invokeCallback("setImmediate", p);
            }
        },
        {
            name: "setInterval",
            invoke: (p: NativeFunctionParams) => {
                invokeCallback("setInterval", p);
            }
        },
        {
            name: "setTimeout",
            invoke: (p: NativeFunctionParams) => {
                invokeCallback("setTimeout", p);
            }
        },
        {
            name: "structuredClone",
            invoke: (p: NativeFunctionParams) => {
                // TODO: structuredClone
            }
        },
    ],
    classes: [
        {
            name: "AbortController"
            // TODO
        },
        {
            name: "AbortSignal"
            // TODO
        },
        {
            name: "BroadcastChannel"
            // TODO
        },
        {
            name: "Buffer"
            // TODO
        },
        {
            name: "DOMException"
            // TODO
        },
        {
            name: "Event"
            // TODO
        },
        {
            name: "EventTarget"
            // TODO
        },
        {
            name: "MessageChannel"
            // TODO
        },
        {
            name: "MessageEvent"
            // TODO
        },
        {
            name: "MessagePort"
            // TODO
        },
        {
            name: "TextDecoder"
            // TODO
        },
        {
            name: "TextEncoder"
            // TODO
        },
        {
            name: "URL"
            // TODO
        },
        {
            name: "URLSearchParams"
            // TODO
        }
    ]
};

export const MODULE_PARAMETERS = nodejsModels.params!.map(p => p.name);