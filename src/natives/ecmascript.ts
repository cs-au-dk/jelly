// noinspection JSUnusedLocalSymbols

import {
    addInherits,
    assignBaseArrayArrayValueToArray,
    assignBaseArrayValueToArray,
    assignIteratorMapValuePairs,
    assignIteratorValuesToArrayValue,
    assignIteratorValuesToProperty,
    assignParameterToArrayValue,
    assignParameterToThisArrayValue,
    assignParameterToThisProperty,
    assignProperties,
    callPromiseExecutor,
    defineProperties,
    functionBind,
    invokeCallApply,
    invokeCallback,
    newSpecialObject,
    newArray,
    newObject,
    newPackageObject,
    prepareDefineProperties,
    prepareDefineProperty,
    returnArgument,
    returnArrayValue,
    returnIterator,
    returnPackageObject,
    returnPromiseIterator,
    returnPrototypeOf,
    returnResolvedPromise,
    returnShuffledArray,
    returnShuffledInplace,
    returnThis,
    returnThisInPromise,
    returnThisProperty,
    returnToken,
    returnUnknown,
    setPrototypeOf,
    warnNativeUsed,
    widenArgument,
    generatorCall,
} from "./nativehelpers";
import {
    AllocationSiteToken,
    ClassToken,
    FunctionToken,
    NativeObjectToken,
    ObjectKind,
    PackageObjectToken,
    Token
} from "../analysis/tokens";
import {isExpression, isNewExpression, isStringLiteral} from "@babel/types";
import {NativeFunctionParams, NativeModel, NativeModelParams} from "./nativebuilder";
import {TokenListener} from "../analysis/listeners";
import {options} from "../options";
import {ObjectPropertyVarObj} from "../analysis/constraintvars";

export const OBJECT_PROTOTYPE = "Object.prototype";
export const ARRAY_PROTOTYPE = "Array.prototype";
export const FUNCTION_PROTOTYPE = "Function.prototype";
export const REGEXP_PROTOTYPE = "RegExp.prototype";
export const ERROR_PROTOTYPE = "Error.prototype";
export const DATE_PROTOTYPE = "Date.prototype";
export const MAP_PROTOTYPE = "Map.prototype";
export const SET_PROTOTYPE = "Set.prototype";
export const WEAKMAP_PROTOTYPE = "WeakMap.prototype";
export const WEAKSET_PROTOTYPE = "WeakSet.prototype";
export const WEAKREF_PROTOTYPE = "WeakRef.prototype";
export const GENERATOR_PROTOTYPE_NEXT = "Generator.prototype.next";
export const GENERATOR_PROTOTYPE_RETURN = "Generator.prototype.return";
export const GENERATOR_PROTOTYPE_THROW = "Generator.prototype.throw";
export const ASYNC_GENERATOR_PROTOTYPE_NEXT = "AsyncGenerator.prototype.next";
export const ASYNC_GENERATOR_PROTOTYPE_RETURN = "AsyncGenerator.prototype.return";
export const ASYNC_GENERATOR_PROTOTYPE_THROW = "AsyncGenerator.prototype.throw";
export const PROMISE_PROTOTYPE = "Promise.prototype";

export const INTERNAL_PROTOTYPE = () => options.proto ? "__proto__" : "%[[Prototype]]";

export const ARRAY_UNKNOWN = "%ARRAY_UNKNOWN";
export const ARRAY_ALL = "%ARRAY_ALL";
export const MAP_KEYS = "%MAP_KEYS";
export const MAP_VALUES = "%MAP_VALUES";
export const SET_VALUES = "%SET_VALUES";
export const WEAKMAP_VALUES = "%WEAKMAP_VALUES";
export const WEAKREF_VALUES = "%WEAKREF_VALUES";
export const PROMISE_FULFILLED_VALUES = "%PROMISE_FULFILLED_VALUES";
export const PROMISE_REJECTED_VALUES = "%PROMISE_REJECTED_VALUES";

/*
 * Returns whether the provided object property name is used internally by Jelly.
 * (As opposed to property names that arise from source code, the ECMAScript specification, or NodeJS.)
 */
export function isInternalProperty(prop: string): boolean {
    return prop === ARRAY_ALL || (prop === INTERNAL_PROTOTYPE() && !options.proto); // TODO: return prop.startsWith("%") ?
}

/**
 * Returns the native type of objects represented by the given token, or undefined if unknown.
 */
function getNativeType(t: Token): ObjectKind | "Function" | undefined {
    let k: ObjectKind | "Function" | undefined;
    if (t instanceof AllocationSiteToken || t instanceof PackageObjectToken)
        switch (t.kind) {
            case "Object":
            case "Prototype":
                k = "Object";
                break;
            case "PromiseResolve":
            case "PromiseReject":
            case "Class":
                k = "Function";
                break;
            default:
                k = t.kind;
                break;
        }
    else if (t instanceof FunctionToken || t instanceof ClassToken)
        k = "Function";
    else if (t instanceof NativeObjectToken)
        if (METHODS.has(t.name) &&
            !(t.name === "Reflect" || t.name === "Atomics" || t.name === "WebAssembly"))
            k = "Function";
        else
            k = "Object";
    return k;
}

/**
 * Returns true if 't' inherits from a global native object that has a property named 'prop'.
 */
export function isNativeProperty(t: Token, prop: string): boolean {
    const kind = getNativeType(t);
    return Boolean(kind !== undefined && METHODS.get(kind)?.has(prop));
}

/*
 * Models of ECMAScript standard built-in objects.
 * See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects
 * and https://github.com/microsoft/TypeScript/tree/main/lib.
 * Primitive values and accessor properties are ignored; only functions and objects are modeled.
 */
export const ecmascriptModels: NativeModel = {
    name: "ecmascript",
    init: (p: NativeModelParams) => {
        const thePackageObjectToken = p.solver.globalState.canonicalizeToken(new PackageObjectToken(p.moduleInfo.packageInfo));
        const theArrayPackageObjectToken = p.solver.globalState.canonicalizeToken(new PackageObjectToken(p.moduleInfo.packageInfo, "Array"));
        const theDatePackageObjectToken = p.solver.globalState.canonicalizeToken(new PackageObjectToken(p.moduleInfo.packageInfo, "Date"));
        const theRegExpPackageObjectToken = p.solver.globalState.canonicalizeToken(new PackageObjectToken(p.moduleInfo.packageInfo, "RegExp"));
        const theErrorPackageObjectToken = p.solver.globalState.canonicalizeToken(new PackageObjectToken(p.moduleInfo.packageInfo, "Error"));
        p.solver.addInherits(thePackageObjectToken, p.globalSpecialNatives.get(OBJECT_PROTOTYPE)!);
        p.solver.addInherits(theArrayPackageObjectToken, p.globalSpecialNatives.get(ARRAY_PROTOTYPE)!);
        p.solver.addInherits(theDatePackageObjectToken, p.globalSpecialNatives.get(DATE_PROTOTYPE)!);
        p.solver.addInherits(theRegExpPackageObjectToken, p.globalSpecialNatives.get(REGEXP_PROTOTYPE)!);
        p.solver.addInherits(theErrorPackageObjectToken, p.globalSpecialNatives.get(ERROR_PROTOTYPE)!);
        // TODO: all NativeObjectToken objects and AccessPathToken objects should also inherit from Object.prototype, Array.prototype and Function.prototype?
    },
    variables: [
        {
            name: "globalThis"
        },
        {
            name: "Infinity"
        },
        {
            name: "NaN"
        },
        {
            name: "undefined"
        }
    ],
    functions: [
        {
            name: "decodeURI"
        },
        {
            name: "decodeURIComponent"
        },
        {
            name: "encodeURI"
        },
        {
            name: "encodeURIComponent"
        },
        {
            name: "escape"
        },
        {
            name: "eval",
            invoke: (p: NativeFunctionParams) => {
                warnNativeUsed("eval", p);
            }
        },
        {
            name: "isFinite"
        },
        {
            name: "isNaN"
        },
        {
            name: "parseFloat"
        },
        {
            name: "parseInt"
        },
        {
            name: "unescape"
        }
    ],
    classes: [
        {
            name: "AggregateError",
            invoke: (p: NativeFunctionParams) => {
                warnNativeUsed("AggregateError", p); // TODO
                returnPackageObject(p, "Error");
            }
        },
        {
            name: "Array",
            fields: [
                {
                    name: "length"
                }
            ],
            invoke: (p: NativeFunctionParams) => {
                const t = newArray(p);
                for (let i = 0; i < p.path.node.arguments.length; i++)
                    assignParameterToArrayValue(i, t, p);
                returnToken(t, p);
            },
            staticMethods: [
                {
                    name: "from",
                    invoke: (p: NativeFunctionParams) => {
                        const t = newArray(p);
                        if (!p.path.node.arguments.every(arg => isExpression(arg)))
                            warnNativeUsed("Array.from", p, "with SpreadElement"); // TODO: SpreadElement
                        else if (p.path.node.arguments.length > 0)
                            assignIteratorValuesToArrayValue(0, t, p);
                        if (p.path.node.arguments.length > 1) {
                            // TODO: connect p.path.node.arguments[0] iterable/arrayLike values to mapFn
                            // TODO: connect returnVar of mapFn to array value of t
                            // TODO: if p.path.node.arguments.length > 2, connect thisArg to thisVar of mapFn
                            warnNativeUsed("Array.from", p, "with map function argument"); // TODO
                        }
                        returnToken(t, p);
                    }
                },
                {
                    name: "isArray"
                },
                {
                    name: "of",
                    invoke: (p: NativeFunctionParams) => {
                        const t = newArray(p);
                        for (let i = 0; i < p.path.node.arguments.length; i++)
                            assignParameterToArrayValue(i, t, p);
                        returnToken(t, p);
                    }
                }
            ],
            methods: [
                {
                    name: "at",
                    invoke: (p: NativeFunctionParams) => {
                        returnArrayValue(p);
                    }
                },
                {
                    name: "concat",
                    invoke: (p: NativeFunctionParams) => {
                        const t = newArray(p);
                        assignBaseArrayValueToArray(t, p);
                        for (let i = 0; i < p.path.node.arguments.length; i++) {
                            assignIteratorValuesToArrayValue(i, t, p);
                            assignParameterToArrayValue(i, t, p); // TODO: could omit arrays among the arguments (see also 'flat' below)
                        }
                        returnToken(t, p);
                    }
                },
                {
                    name: "copyWithin",
                    invoke: (p: NativeFunctionParams) => {
                        returnShuffledInplace(p);
                    }
                },
                {
                    name: "entries",
                    invoke: (p: NativeFunctionParams) => {
                        returnIterator("ArrayEntries", p);
                    }
                },
                {
                    name: "every",
                    invoke: (p: NativeFunctionParams) => {
                        invokeCallback("Array.prototype.every", p);
                    }
                },
                {
                    name: "fill",
                    invoke: (p: NativeFunctionParams) => {
                        assignParameterToThisArrayValue(0, p);
                    }
                },
                {
                    name: "filter",
                    invoke: (p: NativeFunctionParams) => {
                        invokeCallback("Array.prototype.filter", p);
                        returnShuffledArray(p);
                    }
                },
                { // TODO: see also findLast (proposal)
                    name: "find",
                    invoke: (p: NativeFunctionParams) => {
                        invokeCallback("Array.prototype.find", p);
                        returnArrayValue(p);
                    }
                },
                { // TODO: see also findLastIndex (proposal)
                    name: "findIndex",
                    invoke: (p: NativeFunctionParams) => {
                        invokeCallback("Array.prototype.findIndex", p);
                    }
                },
                {
                    name: "flat",
                    invoke: (p: NativeFunctionParams) => {
                        const t = newArray(p);
                        assignBaseArrayValueToArray(t, p); // TODO: could omit arrays among the arguments (see also 'concat' above)
                        assignBaseArrayArrayValueToArray(t, p);
                        if (p.path.node.arguments.length > 0)
                            warnNativeUsed("Array.prototype.flat", p, "with unknown depth"); // TODO: connect elements of elements of base recursively
                        returnToken(t, p);
                    }
                },
                {
                    name: "flatMap",
                    invoke: (p: NativeFunctionParams) => {
                        invokeCallback("Array.prototype.flatMap", p);
                    }
                },
                {
                    name: "forEach",
                    invoke: (p: NativeFunctionParams) => {
                        invokeCallback("Array.prototype.forEach", p);
                    }
                },
                {
                    name: "group",
                    invoke: (p: NativeFunctionParams) => {
                        warnNativeUsed("Array.prototype.group", p); // TODO (experimental)
                    }
                },
                {
                    name: "groupToMap",
                    invoke: (p: NativeFunctionParams) => {
                        warnNativeUsed("Array.prototype.groupToMap", p); // TODO (experimental)
                    }
                },
                {
                    name: "includes"
                },
                {
                    name: "indexOf"
                },
                {
                    name: "join"
                },
                {
                    name: "keys",
                    invoke: (p: NativeFunctionParams) => {
                        returnIterator("ArrayKeys", p);
                    }
                },
                {
                    name: "lastIndexOf"
                },
                {
                    name: "map",
                    invoke: (p: NativeFunctionParams) => {
                        invokeCallback("Array.prototype.map", p);
                    }
                },
                {
                    name: "pop",
                    invoke: (p: NativeFunctionParams) => {
                        returnArrayValue(p);
                    }
                },
                {
                    name: "push",
                    invoke: (p: NativeFunctionParams) => {
                        assignParameterToThisArrayValue(0, p);
                    }
                },
                {
                    name: "reduce",
                    invoke: (p: NativeFunctionParams) => {
                        invokeCallback("Array.prototype.reduce", p);
                    }
                },
                {
                    name: "reduceRight",
                    invoke: (p: NativeFunctionParams) => {
                        invokeCallback("Array.prototype.reduceRight", p);
                    }
                },
                {
                    name: "reverse"
                },
                {
                    name: "shift",
                    invoke: (p: NativeFunctionParams) => {
                        returnArrayValue(p);
                    }
                },
                {
                    name: "slice",
                    invoke: (p: NativeFunctionParams) => {
                        returnShuffledArray(p);
                    }
                },
                {
                    name: "some",
                    invoke: (p: NativeFunctionParams) => {
                        invokeCallback("Array.prototype.some", p);
                    }
                },
                {
                    name: "sort",
                    invoke: (p: NativeFunctionParams) => {
                        invokeCallback("Array.prototype.sort", p);
                    }
                },
                {
                    name: "splice",
                    invoke: (p: NativeFunctionParams) => {
                        const t = returnShuffledArray(p);
                        if (t)
                            for (let i = 2; i < p.path.node.arguments.length; i++)
                                assignParameterToArrayValue(i, t, p);
                    }
                },
                {
                    name: "toLocaleString",
                },
                {
                    name: "toString",
                },
                {
                    name: "unshift",
                    invoke: (p: NativeFunctionParams) => {
                        assignParameterToThisArrayValue(0, p);
                    }
                },
                {
                    name: "values",
                    invoke: (p: NativeFunctionParams) => {
                        returnIterator("ArrayValues", p);
                    }
                }
            ]
        },
        {
            name: "ArrayBuffer",
            invoke: (p: NativeFunctionParams) => {
                warnNativeUsed("ArrayBuffer", p); // TODO
            },
            staticMethods: [
                {
                    name: "isView"
                }],
            methods: [
                {
                    name: "slice",
                    invoke: (p: NativeFunctionParams) => {
                        warnNativeUsed("ArrayBuffer.prototype.slice", p); // TODO
                    }
                }]
        },
        // TODO: AsyncFunction, AsyncGeneratorFunction, GeneratorFunction
        {
            name: "Atomics"
            // TODO
        },
        {
            name: "BigInt",
            invoke: (p: NativeFunctionParams) => {
                warnNativeUsed("BigInt", p); // TODO
            },
            // TODO
        },
        {
            name: "BigInt64Array",
            invoke: (p: NativeFunctionParams) => {
                warnNativeUsed("BigInt64Array", p); // TODO
            },
            // TODO
        },
        {
            name: "BigUint64Array",
            invoke: (p: NativeFunctionParams) => {
                warnNativeUsed("BigUint64Array", p); // TODO
            },
            // TODO
        },
        {
            name: "Boolean",
            methods: [
                {
                    name: "toString"
                },
                {
                    name: "valueOf"
                }
            ]
        },
        {
            name: "DataView",
            invoke: (p: NativeFunctionParams) => {
                warnNativeUsed("DataView", p); // TODO
            }
            // TODO
        },
        {
            name: "Date",
            invoke: (p: NativeFunctionParams) => {
                if (isNewExpression(p.path.node))
                    returnToken(newPackageObject("Date", p), p);
            },
            staticMethods: [
                {
                    name: "now"
                },
                {
                    name: "parse"
                },
                {
                    name: "UTC"
                }
            ],
            methods: [
                {
                    name: "getDate"
                },
                {
                    name: "getDay"
                },
                {
                    name: "getFullYear"
                },
                {
                    name: "getHours"
                },
                {
                    name: "getMilliseconds"
                },
                {
                    name: "getMinutes"
                },
                {
                    name: "getMonths"
                },
                {
                    name: "getSeconds"
                },
                {
                    name: "getTime"
                },
                {
                    name: "getTimezoneOffset"
                },
                {
                    name: "getUTCDate"
                },
                {
                    name: "getUTCDay"
                },
                {
                    name: "getUTCFullYear"
                },
                {
                    name: "getUTCMilliseconds"
                },
                {
                    name: "getUTCMinutes"
                },
                {
                    name: "getUTCMonth"
                },
                {
                    name: "getUTCSeconds"
                },
                {
                    name: "getYear"
                },
                {
                    name: "setDate"
                },
                {
                    name: "setFullYear"
                },
                {
                    name: "setHours"
                },
                {
                    name: "setMilliseconds"
                },
                {
                    name: "setMinutes"
                },
                {
                    name: "setMonth"
                },
                {
                    name: "setSeconds"
                },
                {
                    name: "setTime"
                },
                {
                    name: "setUTCDate"
                },
                {
                    name: "setUTCFullYear"
                },
                {
                    name: "setUTCHours"
                },
                {
                    name: "setUTCMilliseconds"
                },
                {
                    name: "setUTCMinutes"
                },
                {
                    name: "setUTCMonth"
                },
                {
                    name: "setUTCSeconds"
                },
                {
                    name: "setYear"
                },
                {
                    name: "toDateString"
                },
                {
                    name: "toGMTString"
                },
                {
                    name: "toISOString"
                },
                {
                    name: "toJSON"
                },
                {
                    name: "toLocaleDateString"
                },
                {
                    name: "toLocaleString"
                },
                {
                    name: "toLocaleTimeString"
                },
                {
                    name: "toString"
                },
                {
                    name: "toTimeString"
                },
                {
                    name: "toUTCString"
                },
                {
                    name: "valueOf"
                },

            ]
        },
        {
            name: "Error",
            fields: [
                {
                    name: "cause"
                },
                {
                    name: "message"
                },
                {
                    name: "name" // FIXME: should be Error.prototype.name
                }
            ],
            methods: [
                {
                    name: "toString"
                }
            ],
            invoke: (p: NativeFunctionParams) => {
                if (p.path.node.arguments.length > 1)
                    warnNativeUsed("Error", p, "with multiple arguments"); // TODO
                returnPackageObject(p, "Error");
            }
        },
        {
            name: "EvalError",
            invoke: (p: NativeFunctionParams) => {
                if (p.path.node.arguments.length > 1)
                    warnNativeUsed("EvalError", p, "with multiple arguments"); // TODO
                returnPackageObject(p, "Error");
            }
            // TODO
        },
        {
            name: "FinalizationRegistry",
            invoke: (p: NativeFunctionParams) => {
                warnNativeUsed("FinalizationRegistry", p); // TODO
            }
            // TODO
        },
        {
            name: "Float32Array",
            invoke: (p: NativeFunctionParams) => {
                warnNativeUsed("Float32Array", p); // TODO
            }
            // TODO
        },
        {
            name: "Float64Array",
            invoke: (p: NativeFunctionParams) => {
                warnNativeUsed("Float64Array", p); // TODO
            }
            // TODO
        },
        {
            name: "Function",
            invoke: (p: NativeFunctionParams) => {
                warnNativeUsed("Function", p);
            },
            methods: [
                {
                    name: "apply",
                    invoke: (p: NativeFunctionParams) => {
                        invokeCallApply("Function.prototype.apply", p);
                    }
                },
                {
                    name: "bind",
                    invoke: (p: NativeFunctionParams) => {
                        functionBind(p);
                    }
                },
                {
                    name: "call",
                    invoke: (p: NativeFunctionParams) => {
                        invokeCallApply("Function.prototype.call", p);
                    }
                },
                {
                    name: "toString"
                }
            ]
        },
        {
            name: "Generator", // also used for Iterator, Iterable, IterableIterator, IteratorResult
            hidden: true,
            methods: [
                {
                    name: "next",
                    invoke: (p: NativeFunctionParams) => {
                        assignParameterToThisProperty(0, "value", p); // assuming the iterator/iterable uses the same abstract object as the iterator result
                        returnThis(p);
                        generatorCall(p);
                    }
                },
                {
                    name: "return",
                    invoke: (p: NativeFunctionParams) => {
                        returnThis(p);
                        generatorCall(p);
                    }
                },
                {
                    name: "throw",
                    invoke: (p: NativeFunctionParams) => {
                        if (p.path.node.arguments.length >= 1)
                            widenArgument(p.path.node.arguments[0], p);
                        generatorCall(p);
                    }
                },
            ]
        },
        {
            name: "AsyncGenerator", // async variant of Generator
            hidden: true,
            methods: [
                {
                    name: "next",
                    invoke: (p: NativeFunctionParams) => {
                        assignParameterToThisProperty(0, "value", p);
                        returnThisInPromise(p);
                        generatorCall(p);
                    }
                },
                {
                    name: "return",
                    invoke: (p: NativeFunctionParams) => {
                        returnThis(p);
                        generatorCall(p);
                    }
                },
                {
                    name: "throw",
                    invoke: (p: NativeFunctionParams) => {
                        if (p.path.node.arguments.length >= 1)
                            widenArgument(p.path.node.arguments[0], p);
                        generatorCall(p);
                    }
                },
            ]
        },
        {
            name: "Int16Array",
            invoke: (p: NativeFunctionParams) => {
                warnNativeUsed("Int16Array", p); // TODO
            }
            // TODO
        },
        {
            name: "Int32Array",
            invoke: (p: NativeFunctionParams) => {
                warnNativeUsed("Int32Array", p); // TODO
            }
            // TODO
        },
        {
            name: "Int8Array",
            invoke: (p: NativeFunctionParams) => {
                warnNativeUsed("Int8Array", p); // TODO
            }
            // TODO
        },
        {
            name: "InternalError",
            invoke: (p: NativeFunctionParams) => {
                if (p.path.node.arguments.length > 1)
                    warnNativeUsed("InternalError", p, "with multiple arguments"); // TODO
                returnPackageObject(p, "Error");
            }
            // TODO
        },
        {
            name: "Intl",
            staticMethods: [
                // TODO
            ]
        },
        {
            name: "JSON",
            staticMethods: [
                {
                    name: "parse",
                    invoke: (p: NativeFunctionParams) => {
                        if (p.path.node.arguments.length > 1)
                            warnNativeUsed("JSON.parse", p, "with reviver"); // TODO
                        // returnPackageObject(p, "Object");
                        // returnPackageObject(p, "Array");
                        returnUnknown(p); // TODO: better model for unknown JSON object/array?
                    }
                },
                {
                    name: "stringify",
                    invoke: (p: NativeFunctionParams) => {
                        if (p.path.node.arguments.length > 1)
                            warnNativeUsed("JSON.stringify", p, "with replacer"); // TODO (only warn if second argument may be a function)
                    }
                },
            ]
        },
        {
            name: "Map",
            invoke: (p: NativeFunctionParams) => {
                if (isNewExpression(p.path.node)) {
                    const t = newSpecialObject("Map", p);
                    if (p.path.node.arguments.length > 0)
                        assignIteratorMapValuePairs(0, t, MAP_KEYS, MAP_VALUES, p);
                    returnToken(t, p);
                }
            },
            methods: [
                {
                    name: "clear"
                },
                {
                    name: "delete"
                },
                {
                    name: "entries",
                    invoke: (p: NativeFunctionParams) => {
                        returnIterator("MapEntries", p);
                    }
                },
                {
                    name: "forEach",
                    invoke: (p: NativeFunctionParams) => {
                        invokeCallback("Map.prototype.forEach", p);
                    }
                },
                {
                    name: "get",
                    invoke: (p: NativeFunctionParams) => {
                        returnThisProperty(MAP_VALUES, p);
                    }
                },
                {
                    name: "has"
                },
                {
                    name: "keys",
                    invoke: (p: NativeFunctionParams) => {
                        returnIterator("MapKeys", p);
                    }
                },
                {
                    name: "set",
                    invoke: (p: NativeFunctionParams) => {
                        assignParameterToThisProperty(0, MAP_KEYS, p);
                        assignParameterToThisProperty(1, MAP_VALUES, p);
                    }
                },
                {
                    name: "values",
                    invoke: (p: NativeFunctionParams) => {
                        returnIterator("MapValues", p);
                    }
                }
            ]
        },
        {
            name: "Math",
            fields: [
                {
                    name: "E"
                },
                {
                    name: "LN10"
                },
                {
                    name: "LN2"
                },
                {
                    name: "LOG10E"
                },
                {
                    name: "LOG2E"
                },
                {
                    name: "PI"
                },
                {
                    name: "SQRT1_2"
                },
                {
                    name: "SQRT2"
                }
            ],
            staticMethods: [
                {
                    name: "abs"
                },
                {
                    name: "acos"
                },
                {
                    name: "acosh"
                },
                {
                    name: "asin"
                },
                {
                    name: "asinh"
                },
                {
                    name: "atan"
                },
                {
                    name: "atan2"
                },
                {
                    name: "atanh"
                },
                {
                    name: "cbrt"
                },
                {
                    name: "ceil"
                },
                {
                    name: "clz32"
                },
                {
                    name: "cos"
                },
                {
                    name: "cosh"
                },
                {
                    name: "exp"
                },
                {
                    name: "expm1"
                },
                {
                    name: "floor"
                },
                {
                    name: "fround"
                },
                {
                    name: "hypot"
                },
                {
                    name: "imul"
                },
                {
                    name: "log"
                },
                {
                    name: "log10"
                },
                {
                    name: "log1p"
                },
                {
                    name: "log2"
                },
                {
                    name: "max"
                },
                {
                    name: "min"
                },
                {
                    name: "pow"
                },
                {
                    name: "random"
                },
                {
                    name: "round"
                },
                {
                    name: "sign"
                },
                {
                    name: "sin"
                },
                {
                    name: "sinh"
                },
                {
                    name: "sqrt"
                },
                {
                    name: "tan"
                },
                {
                    name: "tanh"
                },
                {
                    name: "trunc"
                }
            ]
        },
        {
            name: "Number",
            fields: [
                {
                    name: "EPSILON"
                },
                {
                    name: "MAX_SAFE_INTEGER"
                },
                {
                    name: "MAX_VALUE"
                },
                {
                    name: "MIN_SAFE_INTEGER"
                },
                {
                    name: "MIN_VALUE"
                },
                {
                    name: "NaN"
                },
                {
                    name: "NEGATIVE_INFINITY"
                },
                {
                    name: "POSITIVE_INFINITY"
                }
            ],
            staticMethods: [
                {
                    name: "isFinite"
                },
                {
                    name: "isInteger"
                },
                {
                    name: "isNaN"
                },
                {
                    name: "isSafeInteger"
                },
                {
                    name: "parseFloat"
                },
                {
                    name: "parseInt"
                }
            ],
            methods: [
                {
                    name: "toExponential"
                },
                {
                    name: "toFixed"
                },
                {
                    name: "toLocaleString"
                },
                {
                    name: "toPrecision"
                },
                {
                    name: "toString"
                },
                {
                    name: "valueOf"
                }
            ]
        },
        {
            name: "Object",
            invoke: (p: NativeFunctionParams) => {
                // Object(...) can return primitive wrapper objects, but they are not relevant
                returnToken(
                    !options.alloc ? p.op.packageObjectToken :
                    newObject(p), p);
                returnArgument(p.path.node.arguments[0], p);
            },
            staticMethods: [
                {
                    name: "assign",
                    invoke: (p: NativeFunctionParams) => {
                        const args = p.path.node.arguments;
                        if (args.length >= 1) {
                            if (!isExpression(args[0]))
                                warnNativeUsed("Object.assign", p, "with non-expression as target");
                            else {
                                returnArgument(args[0], p);
                                assignProperties(args[0], args.slice(1), p);
                            }
                        }
                    }
                },
                {
                    name: "create",
                    invoke: (p: NativeFunctionParams) => {
                        const args = p.path.node.arguments;
                        if (args.length === 0)
                            return;

                        let obj: ObjectPropertyVarObj;
                        if (options.alloc) {
                            if (!isExpression(args[0])) {
                                warnNativeUsed("Object.create", p, "with non-expression as prototype");
                                return;
                            }

                            // the returned object gets the object passed as 1st argument as prototype
                            obj = newObject(p);
                            addInherits(obj, args[0], p);
                        } else
                            obj = p.op.packageObjectToken;

                        returnToken(obj, p);

                        if (args.length >= 2) {
                            if (!isExpression(args[1])) {
                                warnNativeUsed("Object.create", p, "with non-expression as property descriptors");
                                return;
                            }

                            // model the part of Object.create's logic that is similar to Object.defineProperties
                            const ivars = prepareDefineProperties("Object.create", args[1], p);
                            defineProperties(obj, TokenListener.NATIVE_OBJECT_CREATE, ivars, p);
                        }
                    }
                },
                {
                    name: "defineProperties",
                    invoke: (p: NativeFunctionParams) => {
                        const args = p.path.node.arguments;
                        if (args.length < 2)
                            return;

                        if (!isExpression(args[0]) || !isExpression(args[1])) {
                            warnNativeUsed("Object.defineProperties", p, "with non-expressions?");
                            return;
                        }

                        const ivars = prepareDefineProperties("Object.defineProperties", args[1], p);
                        defineProperties(args[0], TokenListener.NATIVE_OBJECT_DEFINE_PROPERTIES, ivars, p);
                    }
                },
                {
                    name: "defineProperty",
                    invoke: (p: NativeFunctionParams) => {
                        const args = p.path.node.arguments;
                        if (args.length < 3)
                            return;

                        if (!isStringLiteral(args[1])) {
                            warnNativeUsed("Object.defineProperty", p, "with dynamic property name");
                            return;
                        }

                        if (!isExpression(args[0]) || !isExpression(args[2])) {
                            warnNativeUsed("Object.defineProperty", p, "with non-expressions?");
                            return;
                        }

                        const ivars = prepareDefineProperty("Object.defineProperty", args[1].value, p.op.expVar(args[2], p.path), p);
                        defineProperties(args[0], TokenListener.NATIVE_OBJECT_DEFINE_PROPERTY, ivars, p);
                    }
                },
                {
                    name: "entries",
                    invoke: (p: NativeFunctionParams) => {
                        warnNativeUsed("Object.entries", p); // TODO
                    }
                },
                {
                    name: "freeze"
                },
                {
                    name: "fromEntries",
                    invoke: (p: NativeFunctionParams) => {
                        warnNativeUsed("Object.fromEntries", p); // TODO
                    }
                },
                {
                    name: "getOwnPropertyDescriptor",
                    invoke: (p: NativeFunctionParams) => {
                        warnNativeUsed("Object.getOwnPropertyDescriptor", p); // TODO
                    }
                },
                {
                    name: "getOwnPropertyDescriptors",
                    invoke: (p: NativeFunctionParams) => {
                        warnNativeUsed("Object.getOwnPropertyDescriptors", p); // TODO
                    }
                },
                {
                    name: "getOwnPropertyNames",
                    invoke: (p: NativeFunctionParams) => {
                        returnToken(newArray(p), p);
                    }
                },
                {
                    name: "getOwnPropertySymbols",
                    invoke: (p: NativeFunctionParams) => {
                        returnToken(newArray(p), p);
                    }
                },
                {
                    name: "getPrototypeOf",
                    invoke: (p: NativeFunctionParams) => {
                        returnPrototypeOf(p);
                    }
                },
                {
                    name: "hasOwn"
                },
                {
                    name: "is"
                },
                {
                    name: "isExtensible"
                },
                {
                    name: "isFrozen"
                },
                {
                    name: "isSealed"
                },
                {
                    name: "keys",
                    invoke: (p: NativeFunctionParams) => {
                        returnToken(newArray(p), p);
                    }
                },
                {
                    name: "preventExtensions"
                },
                {
                    name: "seal"
                },
                {
                    name: "setPrototypeOf",
                    invoke: (p: NativeFunctionParams) => {
                        setPrototypeOf(p);
                    }
                },
                {
                    name: "values",
                    invoke: (p: NativeFunctionParams) => {
                        warnNativeUsed("Object.values", p); // TODO
                    }
                },
            ],
            methods: [
                {
                    name: "hasOwnProperty"
                },
                {
                    name: "isPrototypeOf"
                },
                {
                    name: "propertyIsEnumerable"
                },
                {
                    name: "toLocaleString"
                },
                {
                    name: "toString"
                },
                {
                    name: "valueOf"
                }
            ]
        },
        {
            name: "Promise",
            invoke: (p: NativeFunctionParams) => {
                if (isNewExpression(p.path.node)) {
                    callPromiseExecutor(p);
                    returnToken(newSpecialObject("Promise", p), p);
                }
            },
            staticMethods: [
                {
                    name: "all",
                    invoke: (p: NativeFunctionParams) => {
                        returnPromiseIterator("all", p);
                    }
                },
                {
                    name: "allSettled",
                    invoke: (p: NativeFunctionParams) => {
                        returnPromiseIterator("allSettled", p);
                    }
                },
                {
                    name: "any",
                    invoke: (p: NativeFunctionParams) => {
                        returnPromiseIterator("any", p);
                    }
                },
                {
                    name: "race",
                    invoke: (p: NativeFunctionParams) => {
                        returnPromiseIterator("race", p);
                    }
                },
                {
                    name: "reject",
                    invoke: (p: NativeFunctionParams) => {
                        returnResolvedPromise("reject", p);
                    }
                },
                {
                    name: "resolve",
                    invoke: (p: NativeFunctionParams) => {
                        returnResolvedPromise("resolve", p);
                    }
                },
            ],
            methods: [
                {
                    name: "catch",
                    invoke: (p: NativeFunctionParams) => {
                        invokeCallback("Promise.prototype.catch$onRejected", p, 0, TokenListener.NATIVE_INVOKE_CALLBACK);
                    }
                },
                {
                    name: "finally",
                    invoke: (p: NativeFunctionParams) => {
                        invokeCallback("Promise.prototype.finally$onFinally", p, 0, TokenListener.NATIVE_INVOKE_CALLBACK);
                    }
                },
                {
                    name: "then",
                    invoke: (p: NativeFunctionParams) => {
                        invokeCallback("Promise.prototype.then$onFulfilled", p, 0, TokenListener.NATIVE_INVOKE_CALLBACK);
                        invokeCallback("Promise.prototype.then$onRejected", p, 1, TokenListener.NATIVE_INVOKE_CALLBACK2);
                    }
                }
            ]
        },
        {
            name: "Proxy",
            invoke: (p: NativeFunctionParams) => {
                warnNativeUsed("Proxy", p); // TODO
            },
            staticMethods: [
                {
                    name: "revocable",
                    invoke: (p: NativeFunctionParams) => {
                        warnNativeUsed("Proxy.revocable", p); // TODO
                    },
                }
            ]
        },
        {
            name: "RangeError",
            invoke: (p: NativeFunctionParams) => {
                if (p.path.node.arguments.length > 1)
                    warnNativeUsed("RangeError", p, "with multiple arguments"); // TODO
                returnPackageObject(p, "Error");
            }
            // TODO
        },
        {
            name: "ReferenceError",
            invoke: (p: NativeFunctionParams) => {
                if (p.path.node.arguments.length > 1)
                    warnNativeUsed("ReferenceError", p, "with multiple arguments"); // TODO
                returnPackageObject(p, "Error");
            }
            // TODO
        },
        {
            name: "Reflect",
            staticMethods: [
                {
                    name: "apply",
                    invoke: (p: NativeFunctionParams) => {
                        warnNativeUsed("Reflect.apply", p); // TODO
                    }
                },
                {
                    name: "construct",
                    invoke: (p: NativeFunctionParams) => {
                        warnNativeUsed("Reflect.construct", p); // TODO
                    }
                },
                {
                    name: "defineProperty",
                    invoke: (p: NativeFunctionParams) => {
                        warnNativeUsed("Reflect.defineProperty", p); // TODO
                    }
                },
                {
                    name: "deleteProperty"
                },
                {
                    name: "get",
                    invoke: (p: NativeFunctionParams) => {
                        warnNativeUsed("Reflect.get", p); // TODO
                    }
                },
                {
                    name: "getOwnPropertyDescriptor",
                    invoke: (p: NativeFunctionParams) => {
                        warnNativeUsed("Reflect.getOwnPropertyDescriptor", p); // TODO
                    }
                },
                {
                    name: "getPrototypeOf",
                    invoke: (p: NativeFunctionParams) => {
                        warnNativeUsed("Reflect.getPrototypeOf", p); // TODO
                    }
                },
                {
                    name: "has"
                },
                {
                    name: "isExtensible"
                },
                {
                    name: "ownKeys",
                    invoke: (p: NativeFunctionParams) => {
                        warnNativeUsed("Reflect.ownKeys", p); // TODO
                    }
                },
                {
                    name: "preventExtensions"
                },
                {
                    name: "set",
                    invoke: (p: NativeFunctionParams) => {
                        warnNativeUsed("Reflect.set", p); // TODO
                    }
                },
                {
                    name: "setPrototypeOf",
                    invoke: (p: NativeFunctionParams) => {
                        warnNativeUsed("Reflect.setPrototypeOf", p); // TODO
                    }
                },
            ]
        },
        {
            name: "RegExp",
            invoke: (p: NativeFunctionParams) => {
                returnToken(newPackageObject("RegExp", p), p);
            },
            methods: [
                {
                    name: "exec",
                    invoke: (p: NativeFunctionParams) => {
                        returnToken(newArray(p), p);
                    }
                },
                {
                    name: "test"
                },
                {
                    name: "toString"
                }
            ]
        },
        {
            name: "Set",
            invoke: (p: NativeFunctionParams) => {
                if (isNewExpression(p.path.node)) {
                    const t = newSpecialObject("Set", p);
                    if (p.path.node.arguments.length > 0)
                        assignIteratorValuesToProperty(0, t, SET_VALUES, p);
                    returnToken(t, p);
                }
            },
            methods: [
                {
                    name: "add",
                    invoke: (p: NativeFunctionParams) => {
                        assignParameterToThisProperty(0, SET_VALUES, p);
                    }
                },
                {
                    name: "clear"
                },
                {
                    name: "delete"
                },
                {
                    name: "entries",
                    invoke: (p: NativeFunctionParams) => {
                        returnIterator("SetEntries", p);
                    }
                },
                {
                    name: "forEach",
                    invoke: (p: NativeFunctionParams) => {
                        invokeCallback("Set.prototype.forEach", p);
                    }
                },
                {
                    name: "has"
                },
                {
                    name: "values",
                    invoke: (p: NativeFunctionParams) => {
                        returnIterator("SetValues", p);
                    }
                }
            ]
        },
        {
            name: "SharedArrayBuffer",
            invoke: (p: NativeFunctionParams) => {
                warnNativeUsed("SharedArrayBuffer", p); // TODO
            }
            // TODO
        },
        {
            name: "String",
            staticMethods: [
                {
                    name: "fromCharCode"
                },
                {
                    name: "fromCodePoint"
                },
                {
                    name: "raw"
                }
            ],
            methods: [
                {
                    name: "charAt"
                },
                {
                    name: "charCodeAt"
                },
                {
                    name: "codePointAt"
                },
                {
                    name: "concat"
                },
                {
                    name: "endsWith"
                },
                {
                    name: "includes"
                },
                {
                    name: "indexOf"
                },
                {
                    name: "lastIndexOf"
                },
                {
                    name: "localeCompare"
                },
                {
                    name: "match"
                },
                {
                    name: "matchAll"
                },
                {
                    name: "normalize"
                },
                {
                    name: "padEnd"
                },
                {
                    name: "padStart"
                },
                {
                    name: "repeat"
                },
                {
                    name: "replace"
                },
                {
                    name: "replaceAll"
                },
                {
                    name: "search"
                },
                {
                    name: "slice"
                },
                {
                    name: "split"
                },
                {
                    name: "startsWith"
                },
                {
                    name: "substring"
                },
                {
                    name: "toLocaleLowerCase"
                },
                {
                    name: "toLocaleUpperCase"
                },
                {
                    name: "toLowerCase"
                },
                {
                    name: "toString"
                },
                {
                    name: "toUpperCase"
                },
                {
                    name: "trim"
                },
                {
                    name: "trimEnd"
                },
                {
                    name: "trimStart"
                },
                {
                    name: "valueOf"
                }
            ]
        },
        {
            name: "Symbol",
            invoke: (p: NativeFunctionParams) => {
                warnNativeUsed("Symbol", p); // TODO
            }
            // TODO
        },
        {
            name: "SyntaxError",
            invoke: (p: NativeFunctionParams) => {
                if (p.path.node.arguments.length > 1)
                    warnNativeUsed("SyntaxError", p, "with multiple arguments"); // TODO
                returnPackageObject(p, "Error");
            }
            // TODO
        },
        {
            name: "TypedArray",
            hidden: true
            // TODO
        },
        {
            name: "TypeError",
            invoke: (p: NativeFunctionParams) => {
                if (p.path.node.arguments.length > 1)
                    warnNativeUsed("TypeError", p, "with multiple arguments"); // TODO
                returnPackageObject(p, "Error");
            }
            // TODO
        },
        {
            name: "Uint16Array",
            invoke: (p: NativeFunctionParams) => {
                warnNativeUsed("Uint16Array", p); // TODO
            }
            // TODO
        },
        {
            name: "Uint32Array",
            invoke: (p: NativeFunctionParams) => {
                warnNativeUsed("Uint32Array", p); // TODO
            }
            // TODO
        },
        {
            name: "Uint8Array",
            invoke: (p: NativeFunctionParams) => {
                warnNativeUsed("Uint8Array", p); // TODO
            }
            // TODO
        },
        {
            name: "Uint8ClampedArray",
            invoke: (p: NativeFunctionParams) => {
                warnNativeUsed("Uint8ClampedArray", p); // TODO
            }
            // TODO
        },
        {
            name: "URIError",
            invoke: (p: NativeFunctionParams) => {
                if (p.path.node.arguments.length > 1)
                    warnNativeUsed("URIError", p, "with multiple arguments"); // TODO
                returnPackageObject(p, "Error");
            }
            // TODO
        },
        {
            name: "WeakMap",
            invoke: (p: NativeFunctionParams) => {
                const t = newSpecialObject("WeakMap", p);
                if (p.path.node.arguments.length > 0)
                    assignIteratorMapValuePairs(0, t, null, WEAKMAP_VALUES, p);
                returnToken(t, p);
            },
            methods: [
                {
                    name: "clear"
                },
                {
                    name: "delete"
                },
                {
                    name: "get",
                    invoke: (p: NativeFunctionParams) => {
                        returnThisProperty(WEAKMAP_VALUES, p);
                    }
                },
                {
                    name: "has"
                },
                {
                    name: "set",
                    invoke: (p: NativeFunctionParams) => {
                        assignParameterToThisProperty(1, WEAKMAP_VALUES, p);
                    }
                }
            ]
        },
        {
            name: "WeakRef",
            invoke: (p: NativeFunctionParams) => {
                if (isNewExpression(p.path.node)) {
                    assignParameterToThisProperty(0, WEAKREF_VALUES, p);
                    returnToken(newSpecialObject("WeakRef", p), p);
                }
            },
            methods: [
                {
                    name: "deref",
                    invoke: (p: NativeFunctionParams) => {
                        returnThisProperty(WEAKREF_VALUES, p);
                    }
                }
            ]
        },
        {
            name: "WeakSet",
            invoke: (p: NativeFunctionParams) => {
                if (isNewExpression(p.path.node))
                    returnToken(newSpecialObject("WeakSet", p), p);
            },
            methods: [
                {
                    name: "add"
                },
                {
                    name: "delete"
                },
                {
                    name: "has"
                }
            ]
        },
        {
            name: "WebAssembly",
            staticMethods: [
                {
                    name: "compile"
                },
                {
                    name: "compileStreaming"
                },
                {
                    name: "instantiate"
                },
                {
                    name: "instantiateStreaming"
                },
                {
                    name: "validate"
                }
            ]
            // TODO: WebAssembly.Module
            // TODO: WebAssembly.Global
            // TODO: WebAssembly.Instance
            // TODO: WebAssembly.Memory
            // TODO: WebAssembly.Table
            // TODO: WebAssembly.CompileError
            // TODO: WebAssembly.LinkError
            // TODO: WebAssembly.RuntimeError
            // TODO: WebAssembly.Tag
            // TODO: WebAssembly.Exception
        }
    ]
};

/**
 * Map from class name to set of methods.
 */
const METHODS = new Map(ecmascriptModels.classes.map(c => [
    c.name,
    new Set(c.methods?.map(m => m.name))
]));
