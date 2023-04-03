// noinspection JSUnusedLocalSymbols

import {
    assignBaseArrayArrayValueToArray,
    assignBaseArrayValueToArray,
    assignIteratorMapValuePairs,
    assignIteratorValuesToArrayValue,
    assignIteratorValuesToProperty,
    assignParameterToArrayValue,
    assignParameterToThisArrayValue,
    assignParameterToThisProperty,
    callPromiseExecutor,
    invokeCallback,
    newArray,
    newObject,
    newPackageObject,
    returnArgument,
    returnArrayValue,
    returnIterator,
    returnPackageObject,
    returnPromiseIterator,
    returnResolvedPromise,
    returnShuffledArray,
    returnShuffledInplace,
    returnThis,
    returnThisInPromise,
    returnThisProperty,
    returnToken,
    warnNativeUsed,
    widenArgument
} from "./nativehelpers";
import {PackageObjectToken} from "../analysis/tokens";
import {isExpression, isNewExpression} from "@babel/types";
import {NativeFunctionParams, NativeModel, NativeModelParams} from "./nativebuilder";
import {getBaseAndProperty} from "../misc/asthelpers";
import {TokenListener} from "../analysis/listeners";

export const OBJECT_PROTOTYPE = "Object.prototype";
export const ARRAY_PROTOTYPE = "Array.prototype";
export const FUNCTION_PROTOTYPE = "Function.prototype";
export const REGEXP_PROTOTYPE = "RegExp.prototype";
export const DATE_PROTOTYPE = "Date.prototype";
export const MAP_PROTOTYPE = "Map.prototype";
export const SET_PROTOTYPE = "Set.prototype";
export const WEAKMAP_PROTOTYPE = "WeakMap.prototype";
export const WEAKSET_PROTOTYPE = "WeakSet.prototype";
export const WEAKREF_PROTOTYPE = "WeakRef.prototype";
export const GENERATOR_PROTOTYPE_NEXT = "Generator.prototype.next";
export const ASYNC_GENERATOR_PROTOTYPE_NEXT = "AsyncGenerator.prototype.next";
export const PROMISE_PROTOTYPE = "Promise.prototype";

export const MAP_KEYS = "%MAP_KEYS";
export const MAP_VALUES = "%MAP_VALUES";
export const SET_VALUES = "%SET_VALUES";
export const WEAKMAP_VALUES = "%WEAKMAP_VALUES";
export const WEAKREF_VALUES = "%WEAKREF_VALUES";
export const PROMISE_FULFILLED_VALUES = "%PROMISE_FULFILLED_VALUES";
export const PROMISE_REJECTED_VALUES = "%PROMISE_REJECTED_VALUES";

/*
 * Models of ECMAScript standard built-in objects.
 * See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects
 * and https://github.com/microsoft/TypeScript/tree/main/lib.
 * Primitive values and accessor properties are ignored; only functions and objects are modeled.
 */
export const ecmascriptModels: NativeModel = {
    name: "ecmascript",
    init: (p: NativeModelParams) => {
        // establish essential inheritance relations
        const thePackageObjectToken = p.solver.globalState.canonicalizeToken(new PackageObjectToken(p.moduleInfo.packageInfo));
        const theArrayPackageObjectToken = p.solver.globalState.canonicalizeToken(new PackageObjectToken(p.moduleInfo.packageInfo, "Array"));
        const theDatePackageObjectToken = p.solver.globalState.canonicalizeToken(new PackageObjectToken(p.moduleInfo.packageInfo, "Date"));
        const theRegExpPackageObjectToken = p.solver.globalState.canonicalizeToken(new PackageObjectToken(p.moduleInfo.packageInfo, "RegExp"));
        p.solver.addInherits(thePackageObjectToken, p.globalSpecialNatives.get(OBJECT_PROTOTYPE)!);
        p.solver.addInherits(theArrayPackageObjectToken, p.globalSpecialNatives.get(ARRAY_PROTOTYPE)!);
        p.solver.addInherits(theDatePackageObjectToken, p.globalSpecialNatives.get(DATE_PROTOTYPE)!);
        p.solver.addInherits(theRegExpPackageObjectToken, p.globalSpecialNatives.get(REGEXP_PROTOTYPE)!);
        p.solver.addInherits(p.globalSpecialNatives.get(ARRAY_PROTOTYPE)!, p.globalSpecialNatives.get(OBJECT_PROTOTYPE)!);
        p.solver.addInherits(p.globalSpecialNatives.get(DATE_PROTOTYPE)!, p.globalSpecialNatives.get(OBJECT_PROTOTYPE)!);
        p.solver.addInherits(p.globalSpecialNatives.get(REGEXP_PROTOTYPE)!, p.globalSpecialNatives.get(OBJECT_PROTOTYPE)!);
        p.solver.addInherits(p.globalSpecialNatives.get(FUNCTION_PROTOTYPE)!, p.globalSpecialNatives.get(OBJECT_PROTOTYPE)!);
        p.solver.addInherits(p.globalSpecialNatives.get(PROMISE_PROTOTYPE)!, p.globalSpecialNatives.get(OBJECT_PROTOTYPE)!);
        // TODO: all ObjectToken objects should also inherit from Object.prototype and Array.prototype?
        // TODO: all FunctionToken objects should also inherit from Function.prototype?
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
                returnPackageObject(p); // TODO: should inherit toString from Error
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
                    returnToken(newPackageObject("Date", p.globalSpecialNatives.get(DATE_PROTOTYPE)!, p), p);
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
                    name: "name"
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
                returnPackageObject(p);
            }
        },
        {
            name: "EvalError",
            invoke: (p: NativeFunctionParams) => {
                if (p.path.node.arguments.length > 1)
                    warnNativeUsed("EvalError", p, "with multiple arguments"); // TODO
                returnPackageObject(p); // TODO: should inherit toString from Error
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
                        warnNativeUsed("Function.prototype.apply", p); // TODO
                    }
                },
                {
                    name: "bind",
                    invoke: (p: NativeFunctionParams) => {
                        const bp = getBaseAndProperty(p.path);
                        if (bp) {
                            const vp = p.solver.fragmentState.varProducer;
                            p.solver.addSubsetConstraint(vp.expVar(bp.base, p.path), vp.expVar(p.path.node, p.path)); // TODO: move to nativehelpers
                        }
                        if (!p.path.node.arguments.every(arg => isExpression(arg)))
                            warnNativeUsed("Function.prototype.bind", p, "with SpreadElement"); // TODO: SpreadElement
                        else if (p.path.node.arguments.length === 1)
                            warnNativeUsed("Function.prototype.bind", p, "with one argument"); // TODO: bind 'this'
                        else if (p.path.node.arguments.length > 1)
                            warnNativeUsed("Function.prototype.bind", p, "with multiple arguments"); // TODO: bind 'this' and partial arguments
                    }
                },
                {
                    name: "call",
                    invoke: (p: NativeFunctionParams) => {
                        warnNativeUsed("Function.prototype.call", p); // TODO
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
                    }
                },
                {
                    name: "return",
                    invoke: (p: NativeFunctionParams) => {
                        returnThis(p);
                    }
                },
                {
                    name: "throw",
                    invoke: (p: NativeFunctionParams) => {
                        if (p.path.node.arguments.length >= 1)
                            widenArgument(p.path.node.arguments[0], p);
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
                    }
                }
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
                returnPackageObject(p); // TODO: should inherit toString from Error
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
                        returnPackageObject(p);
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
                    const t = newObject("Map", p.globalSpecialNatives.get(MAP_PROTOTYPE)!, p);
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
                if (p.path.node.arguments.length > 0)
                    warnNativeUsed("Object", p, "with arguments"); // TODO
                returnPackageObject(p);
            },
            staticMethods: [
                {
                    name: "assign",
                    invoke: (p: NativeFunctionParams) => {
                        for (let i = 1; i < p.path.node.arguments.length; i++)
                            widenArgument(p.path.node.arguments[i], p);
                        if (p.path.node.arguments.length >= 1)
                            returnArgument(p.path.node.arguments[0], p);
                        returnPackageObject(p);
                    }
                },
                {
                    name: "create",
                    invoke: (p: NativeFunctionParams) => {
                        if (p.path.node.arguments.length >= 1)
                            widenArgument(p.path.node.arguments[0], p);
                        if (p.path.node.arguments.length >= 2)
                            warnNativeUsed("Object.create", p, "with properties object"); // TODO
                        returnPackageObject(p);
                    }
                },
                {
                    name: "defineProperties",
                    invoke: (p: NativeFunctionParams) => {
                        warnNativeUsed("Object.defineProperties", p); // TODO
                    }
                },
                {
                    name: "defineProperty",
                    invoke: (p: NativeFunctionParams) => {
                        warnNativeUsed("Object.defineProperty", p); // TODO
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
                        warnNativeUsed("Object.getPrototypeOf", p); // TODO
                    }
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
                        warnNativeUsed("Object.setPrototypeOf", p); // TODO
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
                    const promise = newObject("Promise", p.globalSpecialNatives.get(PROMISE_PROTOTYPE)!, p);
                    const resolveFunction = newObject("PromiseResolve", p.globalSpecialNatives.get(FUNCTION_PROTOTYPE)!, p);
                    const rejectFunction = newObject("PromiseReject", p.globalSpecialNatives.get(FUNCTION_PROTOTYPE)!, p);
                    callPromiseExecutor(promise, resolveFunction, rejectFunction, p);
                    returnToken(promise, p);
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
                returnPackageObject(p); // TODO: should inherit toString from Error
            }
            // TODO
        },
        {
            name: "ReferenceError",
            invoke: (p: NativeFunctionParams) => {
                if (p.path.node.arguments.length > 1)
                    warnNativeUsed("ReferenceError", p, "with multiple arguments"); // TODO
                returnPackageObject(p); // TODO: should inherit toString from Error
            }
            // TODO
        },
        {
            name: "Reflect"
            // TODO
        },
        {
            name: "RegExp",
            invoke: (p: NativeFunctionParams) => {
                returnToken(newPackageObject("RegExp", p.globalSpecialNatives.get(REGEXP_PROTOTYPE)!, p), p);
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
                    const t = newObject("Set", p.globalSpecialNatives.get(SET_PROTOTYPE)!, p);
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
                returnPackageObject(p); // TODO: should inherit toString from Error
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
                returnPackageObject(p); // TODO: should inherit toString from Error
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
                returnPackageObject(p); // TODO: should inherit toString from Error
            }
            // TODO
        },
        {
            name: "WeakMap",
            invoke: (p: NativeFunctionParams) => {
                const t = newObject("WeakMap", p.globalSpecialNatives.get(WEAKMAP_PROTOTYPE)!, p);
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
                    returnToken(newObject("WeakRef", p.globalSpecialNatives.get(WEAKREF_PROTOTYPE)!, p), p);
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
                    returnToken(newObject("WeakSet", p.globalSpecialNatives.get(WEAKSET_PROTOTYPE)!, p), p);
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
