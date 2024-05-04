import {NativeFunctionParams, NativeModel, NativeModelParams} from "./nativebuilder";
import {NativeObjectToken} from "../analysis/tokens";

/*
 * Models of Node.js standard built-in objects.
 * See https://nodejs.org/api/ and https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node.
 * Primitive values and accessor properties are ignored; only functions and objects are modeled.
 */
export const nodejsModels: NativeModel = {
    name: "nodejs",
    init: (p: NativeModelParams) => {
        // module.exports = exports
        p.solver.addTokenConstraint(p.moduleSpecialNatives.get("exports")!, p.solver.varProducer.objPropVar(p.moduleSpecialNatives.get("module")!, "exports"));
        const a = p.solver.globalState;
        const rt = a.canonicalizeToken(new NativeObjectToken("require", p.moduleInfo));
        // add a special object representing the value of require.extensions
        // to the extensions property of the require variable
        p.solver.addTokenConstraint(
            a.canonicalizeToken(new NativeObjectToken("require.extensions", p.moduleInfo)),
            p.solver.varProducer.objPropVar(rt, "extensions"));
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
        }
    ],
    variables: [
        {
            name: "console" // TODO: see https://nodejs.org/api/console.html
        },
        {
            name: "global",
            init: (p: NativeModelParams) => {
                return p.globalSpecialNatives.get("globalThis")!; // TODO: 'global' is actually a property on globalThis
            }
        },
        {
            name: "performance"// TODO: 'performance' is actually a property on globalThis
        },
        {
            name: "process" // TODO: see https://nodejs.org/api/process.html#process
        }
    ],
    functions: [ // TODO: these are actually properties on globalThis, see also 'fetch'
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
                // TODO: model callback
            }
        },
        {
            name: "setImmediate",
            invoke: (p: NativeFunctionParams) => {
                // TODO: model callback
            }
        },
        {
            name: "setInterval",
            invoke: (p: NativeFunctionParams) => {
                // TODO: model callback
            }
        },
        {
            name: "setTimeout",
            invoke: (p: NativeFunctionParams) => {
                // TODO: model callback
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
