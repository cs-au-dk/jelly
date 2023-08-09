import {CallExpression, Expression, Function, isExpression, isIdentifier} from "@babel/types";
import {
    AccessPathToken,
    AllocationSiteToken,
    ArrayToken,
    FunctionToken,
    NativeObjectToken,
    ObjectKind,
    ObjectToken,
    PackageObjectToken,
    Token
} from "../analysis/tokens";
import {getAdjustedCallNodePath, getBaseAndProperty, isParentExpressionStatement} from "../misc/asthelpers";
import {Node} from "@babel/core";
import {
    ARRAY_PROTOTYPE,
    GENERATOR_PROTOTYPE_NEXT,
    MAP_KEYS,
    MAP_VALUES,
    OBJECT_PROTOTYPE,
    PROMISE_FULFILLED_VALUES,
    PROMISE_PROTOTYPE,
    PROMISE_REJECTED_VALUES,
    SET_VALUES
} from "./ecmascript";
import {NativeFunctionParams} from "./nativebuilder";
import {TokenListener} from "../analysis/listeners";
import assert from "assert";
import {NodePath} from "@babel/traverse";
import {Operations} from "../analysis/operations";

/**
 * Models an assignment from a function parameter (0-based indexing) to a property of the base object.
 */
export function assignParameterToThisProperty(param: number, prop: string, p: NativeFunctionParams) {
    if (p.path.node.arguments.length > param) {
        const bp = getBaseAndProperty(p.path);
        const arg = p.path.node.arguments[param];
        if (isExpression(arg) && bp) { // TODO: non-expression arguments?
            const baseVar = p.solver.varProducer.expVar(bp.base, p.path);
            p.solver.addForAllConstraint(baseVar, TokenListener.NATIVE_1, arg, (t: Token) => {
                if (t instanceof NativeObjectToken || t instanceof AllocationSiteToken || t instanceof FunctionToken || t instanceof PackageObjectToken) {
                    const argVar = p.solver.varProducer.expVar(arg, p.path);
                    p.solver.addSubsetConstraint(argVar, p.solver.varProducer.objPropVar(t, prop));
                }
            });
        }
    }
}

/**
 * Assigns from the given expression to an unknown entry of the given array object.
 */
function assignExpressionToArrayValue(from: Expression, t: ArrayToken, p: NativeFunctionParams) {
    const argVar = p.solver.varProducer.expVar(from, p.path);
    p.solver.addSubsetConstraint(argVar, p.solver.varProducer.arrayValueVar(t));
    p.solver.addForAllArrayEntriesConstraint(t, TokenListener.NATIVE_13, from, (prop: string) =>
        p.solver.addSubsetConstraint(argVar, p.solver.varProducer.objPropVar(t, prop)));
}

/**
 * Models an assignment from a function parameter (0-based indexing) to an unknown entry of the base array object.
 */
export function assignParameterToThisArrayValue(param: number, p: NativeFunctionParams) {
    if (p.path.node.arguments.length > param) {
        const bp = getBaseAndProperty(p.path);
        const arg = p.path.node.arguments[param];
        if (isExpression(arg) && bp) { // TODO: non-expression arguments?
            const baseVar = p.solver.varProducer.expVar(bp.base, p.path);
            p.solver.addForAllConstraint(baseVar, TokenListener.NATIVE_2, arg, (t: Token) => {
                if (t instanceof ArrayToken)
                    assignExpressionToArrayValue(arg, t, p);
            });
        }
    }
}

/**
 * Models an assignment from a function parameter (0-based indexing) to an unknown entry of the given array object.
 */
export function assignParameterToArrayValue(param: number, t: ArrayToken, p: NativeFunctionParams) {
    if (p.path.node.arguments.length > param) {
        const arg = p.path.node.arguments[param];
        if (isExpression(arg)) // TODO: non-expression arguments?
            assignExpressionToArrayValue(arg, t, p);
    }
}

/**
 * Models a property of the base object being returned from a function.
 */
export function returnThisProperty(prop: string, p: NativeFunctionParams) {
    const bp = getBaseAndProperty(p.path);
    if (!isParentExpressionStatement(p.path) && bp) {
        const baseVar = p.solver.varProducer.expVar(bp.base, p.path);
        p.solver.addForAllConstraint(baseVar, TokenListener.NATIVE_3, p.path.node, (t: Token) => {
            if (t instanceof NativeObjectToken || t instanceof AllocationSiteToken || t instanceof FunctionToken || t instanceof PackageObjectToken)
                p.solver.addSubsetConstraint(p.solver.varProducer.objPropVar(t, prop), p.solver.varProducer.nodeVar(p.path.node));
        });
    }
}

/**
 * Models the base object being returned from a function.
 */
export function returnThis(p: NativeFunctionParams) {
    const bp = getBaseAndProperty(p.path);
    if (!isParentExpressionStatement(p.path) && bp) {
        const baseVar = p.solver.varProducer.expVar(bp.base, p.path);
        p.solver.addSubsetConstraint(baseVar, p.solver.varProducer.nodeVar(p.path.node));
    }
}

/**
 * Models the base object wrapped into a promise being returned from a function.
 */
export function returnThisInPromise(p: NativeFunctionParams) {
    const bp = getBaseAndProperty(p.path);
    if (!isParentExpressionStatement(p.path) && bp) {
        const baseVar = p.solver.varProducer.expVar(bp.base, p.path);
        const promise = newObject("Promise", p.globalSpecialNatives.get(PROMISE_PROTOTYPE)!, p);
        p.solver.addSubsetConstraint(baseVar, p.solver.varProducer.objPropVar(promise, PROMISE_FULFILLED_VALUES));
        p.solver.addTokenConstraint(promise, p.solver.varProducer.nodeVar(p.path.node));
    }
}

/**
 * Models an unknown entry of the base array object being returned from a function.
 */
export function returnArrayValue(p: NativeFunctionParams) {
    const bp = getBaseAndProperty(p.path);
    if (!isParentExpressionStatement(p.path) && bp) {
        const baseVar = p.solver.varProducer.expVar(bp.base, p.path);
        p.solver.addForAllConstraint(baseVar, TokenListener.NATIVE_4, p.path.node, (t: Token) => {
            if (t instanceof ArrayToken) {
                p.solver.addSubsetConstraint(p.solver.varProducer.arrayValueVar(t), p.solver.varProducer.nodeVar(p.path.node));
                p.solver.addForAllArrayEntriesConstraint(t, TokenListener.NATIVE_14, p.path.node, (prop: string) =>
                    p.solver.addSubsetConstraint(p.solver.varProducer.objPropVar(t, prop), p.solver.varProducer.nodeVar(p.path.node)));
            }
        });
    }
}

/**
 * Models creation of an array that contains the same values as in the base array but in unknown order.
 */
export function returnShuffledArray(p: NativeFunctionParams): ArrayToken | undefined {
    const bp = getBaseAndProperty(p.path);
    if (!isParentExpressionStatement(p.path) && bp) {
        const res = newArray(p);
        returnToken(res, p);
        const resVar = p.solver.varProducer.arrayValueVar(res);
        const baseVar = p.solver.varProducer.expVar(bp.base, p.path);
        p.solver.addForAllConstraint(baseVar, TokenListener.NATIVE_5, p.path.node, (t: Token) => {
            if (t instanceof ArrayToken) {
                p.solver.addSubsetConstraint(p.solver.varProducer.arrayValueVar(t), resVar);
                p.solver.addForAllArrayEntriesConstraint(t, TokenListener.NATIVE_15, p.path.node, (prop: string) =>
                    p.solver.addSubsetConstraint(p.solver.varProducer.objPropVar(t, prop), resVar));
            }
        });
        return res;
    } else
        return undefined;
}

/**
 * Models an unknown permutation of the values in the base array, returning the base array.
 */
export function returnShuffledInplace(p: NativeFunctionParams) {
    const bp = getBaseAndProperty(p.path);
    if (!isParentExpressionStatement(p.path) && bp) {
        const baseVar = p.solver.varProducer.expVar(bp.base, p.path);
        p.solver.addForAllConstraint(baseVar, TokenListener.NATIVE_6, p.path.node, (t: Token) => {
            if (t instanceof ArrayToken) {
                p.solver.addSubsetConstraint(p.solver.varProducer.arrayValueVar(t), baseVar);
                p.solver.addForAllArrayEntriesConstraint(t, TokenListener.NATIVE_16, p.path.node, (prop: string) =>
                    p.solver.addSubsetConstraint(p.solver.varProducer.objPropVar(t, prop), baseVar));
            }
        });
        p.solver.addSubsetConstraint(baseVar, p.solver.varProducer.nodeVar(p.path.node));
    }
}

/**
 * Warns about use of a native function.
 */
export function warnNativeUsed(name: string, p: NativeFunctionParams, extra?: string) {
    p.solver.fragmentState.warnUnsupported(p.path.node, `Call to '${name}'${extra ? ` ${extra}` : ""}`);
}

/**
 * Models that an object represented by the current PackageObjectToken is returned.
 */
export function returnPackageObject(p: NativeFunctionParams) {
    p.solver.addTokenConstraint(p.solver.globalState.canonicalizeToken(new PackageObjectToken(p.moduleInfo.packageInfo)), p.solver.varProducer.expVar(p.path.node, p.path));
}

/**
 * Ensures that objects at the given expression are widened to field-based analysis.
 */
export function widenArgument(arg: Node, p: NativeFunctionParams) {
    if (isExpression(arg)) // TODO: non-Expression arguments?
        p.solver.fragmentState.registerEscapingFromModule(p.solver.varProducer.expVar(arg, p.path)); // triggers widening to field-based
}

/**
 * Models flow from the given expression to the function return.
 */
export function returnArgument(arg: Node, p: NativeFunctionParams) {
    if (isExpression(arg)) // TODO: non-Expression arguments?
        p.solver.addSubsetConstraint(p.solver.varProducer.expVar(arg, p.path), p.solver.varProducer.expVar(p.path.node, p.path));
}

/**
 * Creates a new AllocationSiteToken with the given kind and prototype.
 */
export function newObject(kind: ObjectKind, proto: NativeObjectToken | PackageObjectToken, p: NativeFunctionParams): AllocationSiteToken {
    const t = p.solver.globalState.canonicalizeToken(
        kind ==="Object" ? new ObjectToken(p.path.node, p.moduleInfo.packageInfo) :
            kind === "Array" ? new ArrayToken(p.path.node, p.moduleInfo.packageInfo) :
                new AllocationSiteToken(kind, p.path.node, p.moduleInfo.packageInfo));
    p.solver.addInherits(t, proto);
    return t;
}

/**
 * Creates a new PackageObjectToken with the given kind and prototype.
 */
export function newPackageObject(kind: ObjectKind, proto: NativeObjectToken | PackageObjectToken, p: NativeFunctionParams): PackageObjectToken {
    const t = p.solver.globalState.canonicalizeToken(new PackageObjectToken(p.moduleInfo.packageInfo, kind));
    p.solver.addInherits(t, proto);
    return t;
}

/**
 * Creates a new array represented by an ArrayToken.
 */
export function newArray(p: NativeFunctionParams): ArrayToken {
    const a = p.solver.globalState;
    const t = a.canonicalizeToken(new ArrayToken(p.path.node, p.moduleInfo.packageInfo));
    p.solver.addInherits(t, p.globalSpecialNatives.get(ARRAY_PROTOTYPE)!);
    return t;
}

/**
 * Models flow of the given token to the function return.
 */
export function returnToken(t: Token, p: NativeFunctionParams) {
    p.solver.addTokenConstraint(t, p.solver.varProducer.expVar(p.path.node, p.path));
}

type IteratorKind =
    "ArrayKeys" |
    "ArrayValues" |
    "ArrayEntries" |
    "SetValues" |
    "SetEntries" |
    "MapKeys" |
    "MapValues" |
    "MapEntries";

/**
 * Models returning an Iterator object for the given kind of base object.
 */
export function returnIterator(kind: IteratorKind, p: NativeFunctionParams) { // TODO: see also astvisitor.ts:ForOfStatement
    const bp = getBaseAndProperty(p.path);
    if (!isParentExpressionStatement(p.path) && bp) {
        const a = p.solver.globalState;
        const baseVar = p.solver.varProducer.expVar(bp.base, p.path);
        p.solver.addForAllConstraint(baseVar, TokenListener.NATIVE_7, p.path.node, (t: Token) => {
            const vp = p.solver.varProducer; // (don't use in callbacks)
            if (t instanceof AllocationSiteToken) {
                const iter = a.canonicalizeToken(new AllocationSiteToken("Iterator", t.allocSite, p.moduleInfo.packageInfo));
                p.solver.addTokenConstraint(iter, vp.expVar(p.path.node, p.path));
                const iterNext = vp.objPropVar(iter, "next");
                p.solver.addTokenConstraint(p.globalSpecialNatives.get(GENERATOR_PROTOTYPE_NEXT)!, iterNext);
                const iterValue = vp.objPropVar(iter, "value");
                switch (kind) {
                    case "ArrayKeys": {
                        if (t.kind !== "Array")
                            break;
                        // do nothing, the iterator values are just primitives
                        break;
                    }
                    case "ArrayValues": {
                        if (t.kind !== "Array")
                            break;
                        p.solver.addSubsetConstraint(vp.arrayValueVar(t), iterValue);
                        p.solver.addForAllArrayEntriesConstraint(t, TokenListener.NATIVE_17, p.path.node, (prop: string) =>
                            p.solver.addSubsetConstraint(p.solver.varProducer.objPropVar(t, prop), iterValue));
                        break;
                    }
                    case "ArrayEntries": {
                        if (t.kind !== "Array")
                            break;
                        const pair = a.canonicalizeToken(new ArrayToken(p.path.node, p.moduleInfo.packageInfo)); // TODO: see newArrayToken
                        p.solver.addInherits(t, p.globalSpecialNatives.get(ARRAY_PROTOTYPE)!);
                        p.solver.addTokenConstraint(pair, iterValue);
                        const oneVar = vp.objPropVar(pair, "1");
                        p.solver.addSubsetConstraint(vp.arrayValueVar(t), oneVar);
                        p.solver.addForAllArrayEntriesConstraint(t, TokenListener.NATIVE_18, p.path.node, (prop: string) =>
                            p.solver.addSubsetConstraint(p.solver.varProducer.objPropVar(t, prop), oneVar));
                        break;
                    }
                    case "SetValues": {
                        if (t.kind !== "Set")
                            break;
                        p.solver.addSubsetConstraint(vp.objPropVar(t, SET_VALUES), iterValue);
                        break;
                    }
                    case "SetEntries": {
                        if (t.kind !== "Set")
                            break;
                        const pair = a.canonicalizeToken(new ArrayToken(p.path.node, p.moduleInfo.packageInfo)); // TODO: see newArrayToken
                        p.solver.addInherits(t, p.globalSpecialNatives.get(ARRAY_PROTOTYPE)!);
                        p.solver.addTokenConstraint(pair, iterValue);
                        p.solver.addSubsetConstraint(vp.objPropVar(t, SET_VALUES), vp.objPropVar(pair, "0"));
                        p.solver.addSubsetConstraint(vp.objPropVar(t, SET_VALUES), vp.objPropVar(pair, "1"));
                        break;
                    }
                    case "MapKeys": {
                        if (t.kind !== "Map")
                            break;
                        p.solver.addSubsetConstraint(vp.objPropVar(t, MAP_KEYS), iterValue);
                        break;
                    }
                    case "MapValues": {
                        if (t.kind !== "Map")
                            break;
                        p.solver.addSubsetConstraint(vp.objPropVar(t, MAP_VALUES), iterValue);
                        break;
                    }
                    case "MapEntries": {
                        if (t.kind !== "Map")
                            break;
                        const pair = a.canonicalizeToken(new ArrayToken(p.path.node, p.moduleInfo.packageInfo)); // TODO: see newArrayToken
                        p.solver.addInherits(t, p.globalSpecialNatives.get(ARRAY_PROTOTYPE)!);
                        p.solver.addTokenConstraint(pair, iterValue);
                        p.solver.addSubsetConstraint(vp.objPropVar(t, MAP_KEYS), vp.objPropVar(pair, "0"));
                        p.solver.addSubsetConstraint(vp.objPropVar(t, MAP_VALUES), vp.objPropVar(pair, "1"));
                        break;
                    }
                } // TODO: also handle TypedArray
            }
            // TODO: also handle arguments, user-defined...
        });
    }
}

type CallbackKind =
    "Array.prototype.forEach" |
    "Array.prototype.every" |
    "Array.prototype.filter" |
    "Array.prototype.find" |
    "Array.prototype.findIndex" |
    "Array.prototype.flatMap" |
    "Array.prototype.map" |
    "Array.prototype.reduce" |
    "Array.prototype.reduceRight" |
    "Array.prototype.some" |
    "Array.prototype.sort" |
    "Map.prototype.forEach" |
    "Set.prototype.forEach" |
    "Promise.prototype.then$onFulfilled" |
    "Promise.prototype.then$onRejected" |
    "Promise.prototype.catch$onRejected" |
    "Promise.prototype.finally$onFinally";

/**
 * Models call to a callback.
 */
export function invokeCallback(kind: CallbackKind, p: NativeFunctionParams, arg: number = 0, key: TokenListener = TokenListener.NATIVE_INVOKE_CALLBACK) {
    const args = p.path.node.arguments;
    if (args.length > arg) {
        const funarg = args[arg];
        const bp = getBaseAndProperty(p.path);
        if (isExpression(funarg) && bp) { // TODO: SpreadElement? non-MemberExpression?
            const a = p.solver.globalState;
            const baseVar = p.solver.varProducer.expVar(bp.base, p.path);
            const funVar = p.solver.varProducer.expVar(funarg, p.path);
            const caller = a.getEnclosingFunctionOrModule(p.path, p.moduleInfo);
            p.solver.addForAllPairsConstraint(baseVar, funVar, key, p.path.node, (bt: AllocationSiteToken, ft: FunctionToken | AccessPathToken) => { // TODO: ignoring native functions etc.
                const vp = p.solver.varProducer; // (don't use in callbacks)
                type Param = Function["params"][0] | undefined;
                let param1: Param, param2: Param, param3: Param, param4: Param;
                if (ft instanceof FunctionToken) {
                    p.solver.fragmentState.registerCallEdge(getAdjustedCallNodePath(p.path).node, caller, a.functionInfos.get(ft.fun)!, {native: true}); // TODO: call graph edges for promise-related calls?
                    param1 = ft.fun.params.length > 0 && isIdentifier(ft.fun.params[0]) ? ft.fun.params[0] : undefined; // TODO: non-Identifier parameters?
                    param2 = ft.fun.params.length > 1 && isIdentifier(ft.fun.params[1]) ? ft.fun.params[1] : undefined;
                    param3 = ft.fun.params.length > 2 && isIdentifier(ft.fun.params[2]) ? ft.fun.params[2] : undefined;
                    param4 = ft.fun.params.length > 3 && isIdentifier(ft.fun.params[3]) ? ft.fun.params[3] : undefined;
                }
                const connectThis = () => { // TODO: only bind 'this' if the callback is a proper function (not a lambda?)
                    if (ft instanceof FunctionToken && args.length > 1 && isExpression(args[1])) { // TODO: SpreadElement
                        // bind thisArg to 'this' of the callback
                        const thisArgVar = vp.expVar(args[1], p.path);
                        p.solver.addSubsetConstraint(thisArgVar, vp.thisVar(ft.fun));
                    }
                }
                switch (kind) {
                    case "Array.prototype.forEach":
                    case "Array.prototype.every":
                    case "Array.prototype.filter":
                    case "Array.prototype.find":
                    case "Array.prototype.findIndex":
                    case "Array.prototype.flatMap":
                    case "Array.prototype.map":
                    case "Array.prototype.some":
                        // write array elements to param1
                        if (param1) {
                            p.solver.addSubsetConstraint(vp.arrayValueVar(bt), vp.nodeVar(param1));
                            p.solver.addForAllArrayEntriesConstraint(bt, TokenListener.NATIVE_19, param1, (prop: string) =>
                                p.solver.addSubsetConstraint(vp.objPropVar(bt, prop), p.solver.varProducer.nodeVar(param1)));
                        }
                        switch (kind) {
                            case "Array.prototype.map":
                                // return new array with elements from the callback return values
                                const t = newArray(p);
                                if (ft instanceof FunctionToken)
                                    p.solver.addSubsetConstraint(vp.returnVar(ft.fun), vp.arrayValueVar(t));
                                returnToken(t, p);
                                break;
                            case "Array.prototype.flatMap":
                                warnNativeUsed("Array.prototype.flatMap", p, "(return value ignored)"); // TODO: flatMap return value...
                                break;
                        }
                        p.solver.addSubsetConstraint(baseVar, vp.nodeVar(param3));
                        connectThis();
                        // TODO: array functions are generic (can be applied to any array-like object, including strings), can also be sub-classed
                        break;
                    case "Array.prototype.reduce":
                    case "Array.prototype.reduceRight":
                        // write array elements to param2
                        if (param2) {
                            p.solver.addSubsetConstraint(vp.arrayValueVar(bt), vp.nodeVar(param2));
                            p.solver.addForAllArrayEntriesConstraint(bt, TokenListener.NATIVE_20, param2, (prop: string) =>
                                p.solver.addSubsetConstraint(p.solver.varProducer.objPropVar(bt, prop), p.solver.varProducer.nodeVar(param2)));
                        }
                        p.solver.addSubsetConstraint(baseVar, vp.nodeVar(param4));
                        // bind initialValue to previousValue
                        if (args.length > 1 && isExpression(args[1])) { // TODO: SpreadElement
                            const thisArgVar = vp.expVar(args[1], p.path);
                            p.solver.addSubsetConstraint(thisArgVar, vp.nodeVar(param1));
                        }
                        // connect callback return value to previousValue and to result
                        if (ft instanceof FunctionToken) {
                            const retVar = vp.returnVar(ft.fun);
                            p.solver.addSubsetConstraint(retVar, vp.nodeVar(param1));
                            p.solver.addSubsetConstraint(retVar, vp.expVar(p.path.node, p.path));
                        }
                        break;
                    case "Array.prototype.sort":
                        // write array elements to param1 and param2 and to the array
                        if (bt instanceof ArrayToken && ft instanceof FunctionToken) { // TODO: currently limited support for generic array methods
                            const btVar = vp.arrayValueVar(bt);
                            p.solver.addSubsetConstraint(btVar, vp.nodeVar(param1));
                            p.solver.addSubsetConstraint(btVar, vp.nodeVar(param2));
                            p.solver.addForAllArrayEntriesConstraint(bt, TokenListener.NATIVE_21, ft.fun, (prop: string) => {
                                const btPropVar = vp.objPropVar(bt, prop)
                                p.solver.addSubsetConstraint(btPropVar, p.solver.varProducer.nodeVar(param1));
                                p.solver.addSubsetConstraint(btPropVar, p.solver.varProducer.nodeVar(param2));
                                p.solver.addSubsetConstraint(btPropVar, btVar);
                            });
                        }
                        p.solver.addSubsetConstraint(baseVar, vp.nodeVar(p.path.node));
                        break;
                    case "Map.prototype.forEach":
                        if (bt.kind !== "Map")
                            break;
                        p.solver.addSubsetConstraint(vp.objPropVar(bt, MAP_VALUES), vp.nodeVar(param1));
                        p.solver.addSubsetConstraint(vp.objPropVar(bt, MAP_KEYS), vp.nodeVar(param2));
                        p.solver.addSubsetConstraint(baseVar, vp.nodeVar(param3));
                        connectThis();
                        break;
                    case "Set.prototype.forEach":
                        if (bt.kind !== "Set")
                            break;
                        p.solver.addSubsetConstraint(vp.objPropVar(bt, SET_VALUES), vp.nodeVar(param1));
                        p.solver.addSubsetConstraint(vp.objPropVar(bt, SET_VALUES), vp.nodeVar(param2));
                        p.solver.addSubsetConstraint(baseVar, vp.nodeVar(param3)); // TODO: what if called via e.g. bind? (same for other baseVar constraints above)
                        connectThis();
                        break;
                    case "Promise.prototype.then$onFulfilled":
                    case "Promise.prototype.then$onRejected":
                    case "Promise.prototype.catch$onRejected":
                    case "Promise.prototype.finally$onFinally":
                        if (bt.kind !== "Promise")
                            break;
                        let prop, key;
                        switch (kind) {
                            case "Promise.prototype.then$onFulfilled":
                                prop = PROMISE_FULFILLED_VALUES;
                                key = TokenListener.CALL_PROMISE_ONFULFILLED;
                                break;
                            case "Promise.prototype.then$onRejected":
                            case "Promise.prototype.catch$onRejected":
                                prop = PROMISE_REJECTED_VALUES;
                                key = TokenListener.CALL_PROMISE_ONREJECTED;
                                break;
                            case "Promise.prototype.finally$onFinally":
                                prop = undefined;
                                key = TokenListener.CALL_PROMISE_ONFINALLY;
                                break;
                        }
                        // create a new promise
                        const thenPromise = a.canonicalizeToken(new AllocationSiteToken("Promise", p.path.node, p.moduleInfo.packageInfo));
                        p.solver.addInherits(thenPromise, p.globalSpecialNatives.get(PROMISE_PROTOTYPE)!);
                        if (prop) {
                            // assign promise fulfilled/rejected value to the callback parameter
                            p.solver.addSubsetConstraint(vp.objPropVar(bt, prop), vp.nodeVar(param1));
                        }
                        // for all return values of the callback...
                        if (ft instanceof FunctionToken)
                            p.solver.addForAllConstraint(vp.returnVar(ft.fun), key, p.path.node, (t: Token) => {
                                if (t instanceof AllocationSiteToken && t.kind === "Promise") {
                                    // when callback return value is a promise, transfer its values to the new promise
                                    if (kind !== "Promise.prototype.finally$onFinally")
                                        p.solver.addSubsetConstraint(p.solver.varProducer.objPropVar(t, PROMISE_FULFILLED_VALUES), p.solver.varProducer.objPropVar(thenPromise, PROMISE_FULFILLED_VALUES));
                                    p.solver.addSubsetConstraint(p.solver.varProducer.objPropVar(t, PROMISE_REJECTED_VALUES), p.solver.varProducer.objPropVar(thenPromise, PROMISE_REJECTED_VALUES));
                                } else if (kind !== "Promise.prototype.finally$onFinally") {
                                    // callback return value is a non-promise value, assign it to the fulfilled value of the new promise
                                    p.solver.addTokenConstraint(t, p.solver.varProducer.objPropVar(thenPromise, PROMISE_FULFILLED_VALUES));
                                }
                            });
                        // use identity function as onFulfilled handler at catch
                        if (kind === "Promise.prototype.catch$onRejected")
                            p.solver.addSubsetConstraint(vp.objPropVar(bt, PROMISE_FULFILLED_VALUES), vp.objPropVar(thenPromise, PROMISE_FULFILLED_VALUES));
                        // pipe through fulfilled/rejected values at finally
                        else if (kind === "Promise.prototype.finally$onFinally") {
                            p.solver.addSubsetConstraint(vp.objPropVar(bt, PROMISE_FULFILLED_VALUES), vp.objPropVar(thenPromise, PROMISE_FULFILLED_VALUES));
                            p.solver.addSubsetConstraint(vp.objPropVar(bt, PROMISE_REJECTED_VALUES), vp.objPropVar(thenPromise, PROMISE_REJECTED_VALUES));
                        }
                        // TODO: should use identity function for onFulfilled/onRejected in general if funVar is a non-function value
                        // return the new promise
                        p.solver.addTokenConstraint(thenPromise, vp.expVar(p.path.node, p.path));
                        break;
                }
                if (ft instanceof AccessPathToken) {
                    p.solver.fragmentState.registerEscapingToExternal(funVar, funarg);

                    // TODO: see case AccessPathToken in Operations.callFunction
                }
            });
        }
    }
}

/**
 * Models 'call' or 'apply'.
 */
export function invokeCallApply(kind: "Function.prototype.call" | "Function.prototype.apply", p: NativeFunctionParams) {
    const args = p.path.node.arguments;
    const basearg = args[0];
    const bp = getBaseAndProperty(p.path);
    if (bp) {
        const a = p.solver.globalState;
        const funVar = p.solver.varProducer.expVar(bp.base, p.path);
        const caller = a.getEnclosingFunctionOrModule(p.path, p.moduleInfo);
        p.solver.addForAllConstraint(funVar, TokenListener.NATIVE_INVOKE_CALL_APPLY, p.path.node, (ft: Token) => {
            const vp = p.solver.varProducer;
            if (ft instanceof FunctionToken) {
                p.solver.fragmentState.registerCallEdge(getAdjustedCallNodePath(p.path).node, caller, a.functionInfos.get(ft.fun)!, {native: true}); // TODO: call graph edges for promise-related calls?
                if (isExpression(basearg)) { // TODO: SpreadElement? non-MemberExpression?
                    // base value
                    const baseVar = vp.expVar(basearg, p.path);
                    p.solver.addSubsetConstraint(baseVar, vp.thisVar(ft.fun)); // TODO: only bind 'this' if the callback is a proper function (not a lambda?)
                }
                // TODO: also model conversion for basearg to objects, see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/call
                // arguments
                switch (kind) {
                    case "Function.prototype.call":
                        for (let i = 1; i < args.length; i++) {
                            const arg = args[i];
                            const param = ft.fun.params[i - 1];
                            if (isExpression(arg) && isIdentifier(param)) { // TODO: SpreadElement, non-Identifier parameters?
                                const argVar = vp.expVar(arg, p.path);
                                const paramVar = vp.nodeVar(param);
                                p.solver.addSubsetConstraint(argVar, paramVar);
                            }
                        }
                        break;
                    case "Function.prototype.apply":
                        if (args.length >= 2 && isExpression(args[1])) { // TODO: SpreadElement
                            const argVar = vp.expVar(args[1], p.path);
                            p.solver.addForAllConstraint(argVar, TokenListener.NATIVE_INVOKE_CALL_APPLY2, ft.fun, (t: Token) => {
                                if (t instanceof ArrayToken) {
                                    p.solver.addForAllArrayEntriesConstraint(t, TokenListener.NATIVE_INVOKE_CALL_APPLY3, ft.fun, (prop: string) => {
                                        const param = parseInt(prop);
                                        if (param >= 0 && param < ft.fun.params.length) {
                                            const paramVar = p.solver.varProducer.nodeVar(ft.fun.params[param]);
                                            p.solver.addSubsetConstraint(p.solver.varProducer.objPropVar(t, prop), paramVar);
                                        }
                                    });
                                    // TODO: p.solver.addSubsetConstraint(vp.arrayValueVar(t), ...);
                                }
                            });
                        }
                        break;
                }
                // TODO: also model callee 'arguments'
                // return value
                const retVar = vp.returnVar(ft.fun);
                p.solver.addSubsetConstraint(retVar, vp.expVar(p.path.node, p.path));
            } else if (ft instanceof NativeObjectToken && ft.invoke)
                warnNativeUsed(`${kind} with native function`, p); // TODO: call/apply to native function
        });
    }
}

/**
 * Models 'bind'.
 */
export function functionBind(p: NativeFunctionParams) {
    const args = p.path.node.arguments;
    const basearg = args[0];
    const bp = getBaseAndProperty(p.path);
    if (bp) {
        const funVar = p.solver.varProducer.expVar(bp.base, p.path);
        p.solver.addForAllConstraint(funVar, TokenListener.NATIVE_INVOKE_BIND, p.path.node, (ft: Token) => {
            if (ft instanceof FunctionToken) { // TODO: ignoring native functions etc.
                if (isExpression(basearg)) { // TODO:SpreadElement? non-MemberExpression?
                    // base value
                    const baseVar = p.solver.varProducer.expVar(basearg, p.path);
                    p.solver.addSubsetConstraint(baseVar, p.solver.varProducer.thisVar(ft.fun)); // TODO: only bind 'this' if the callback is a proper function (not a lambda?)
                }
                // TODO: also model conversion for basearg to objects, see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/bind
            }
        });
        // return value
        p.solver.addSubsetConstraint(p.solver.varProducer.expVar(bp.base, p.path), p.solver.varProducer.expVar(p.path.node, p.path));
    }
    if (!args.every(arg => isExpression(arg)))
        warnNativeUsed("Function.prototype.bind", p, "with SpreadElement"); // TODO: SpreadElement
    if (args.length > 1)
        warnNativeUsed("Function.prototype.bind", p, "with multiple arguments"); // TODO: bind partial arguments
}

/**
 * Models flow from values of the given iterator's values to the given object property.
 */
export function assignIteratorValuesToProperty(param: number, t: AllocationSiteToken, prop: string, p: NativeFunctionParams) {
    const arg = p.path.node.arguments[param];
    if (isExpression(arg)) { // TODO: non-Expression argument
        const src = p.op.expVar(arg, p.path);
        const dst = p.solver.varProducer.objPropVar(t, prop);
        p.op.readIteratorValue(src, dst, p.path.node);
    }
}

/**
 * Models flow from values of the given iterator's values to unknown values of the given array.
 */
export function assignIteratorValuesToArrayValue(param: number, t: ArrayToken, p: NativeFunctionParams) {
    const arg = p.path.node.arguments[param];
    if (isExpression(arg)) { // TODO: non-Expression argument
        const src = p.op.expVar(arg, p.path);
        const dst = p.solver.varProducer.arrayValueVar(t);
        p.op.readIteratorValue(src, dst, p.path.node);
    }
}

/**
 * Models flow from key-value pairs of the given iterator's values to the given object key and value properties.
 */
export function assignIteratorMapValuePairs(param: number, t: AllocationSiteToken, keys: string | null, values: string, p: NativeFunctionParams) {
    const arg = p.path.node.arguments[param];
    if (isExpression(arg)) { // TODO: non-Expression argument
        const src = p.op.expVar(arg, p.path);
        const dst = p.solver.varProducer.intermediateVar(p.path.node, "assignIteratorValuePairsToProperties");
        p.op.readIteratorValue(src, dst, p.path.node);
        p.solver.addForAllConstraint(dst, TokenListener.NATIVE_8, p.path.node.arguments[param], (t2: Token) => {
            if (t2 instanceof ArrayToken) {
                if (keys)
                    p.solver.addSubsetConstraint(p.solver.varProducer.objPropVar(t2, "0"), p.solver.varProducer.objPropVar(t, keys));
                p.solver.addSubsetConstraint(p.solver.varProducer.objPropVar(t2, "1"), p.solver.varProducer.objPropVar(t, values));
            }
        });
    }
}

/**
 * Models flow from values of the base array to the given array, in unknown order.
 */
export function assignBaseArrayValueToArray(t: ArrayToken, p: NativeFunctionParams) {
    const bp = getBaseAndProperty(p.path);
    if (bp) {
        const baseVar = p.solver.varProducer.expVar(bp.base, p.path);
        const dst = p.solver.varProducer.arrayValueVar(t);
        p.solver.addForAllConstraint(baseVar, TokenListener.NATIVE_9, p.path.node, (t2: Token) => {
            if (t2 instanceof ArrayToken) {
                p.solver.addSubsetConstraint(p.solver.varProducer.arrayValueVar(t2), dst);
                p.solver.addForAllArrayEntriesConstraint(t2, TokenListener.NATIVE_22, p.path.node, (prop: string) =>
                    p.solver.addSubsetConstraint(p.solver.varProducer.objPropVar(t2, prop), dst));
            }
        });
    }
}

/**
 * Models flow from values of array values of the base array to the given array, in unknown order.
 */
export function assignBaseArrayArrayValueToArray(t: ArrayToken, p: NativeFunctionParams) {
    const bp = getBaseAndProperty(p.path);
    if (bp) {
        const baseVar = p.solver.varProducer.expVar(bp.base, p.path);
        const dst = p.solver.varProducer.arrayValueVar(t);
        const fn = (t3: Token) => {
            if (t3 instanceof ArrayToken) {
                p.solver.addSubsetConstraint(p.solver.varProducer.arrayValueVar(t3), dst);
                p.solver.addForAllArrayEntriesConstraint(t3, TokenListener.NATIVE_23, p.path.node, (prop: string) =>
                    p.solver.addSubsetConstraint(p.solver.varProducer.objPropVar(t3, prop), dst));
            }
        };
        p.solver.addForAllConstraint(baseVar, TokenListener.NATIVE_10, p.path.node, (t2: Token) => {
            if (t2 instanceof ArrayToken) {
                p.solver.addForAllConstraint(p.solver.varProducer.arrayValueVar(t2), TokenListener.NATIVE_11, p.path.node, fn);
                p.solver.addForAllArrayEntriesConstraint(t2, TokenListener.NATIVE_24, p.path.node, (prop: string) =>
                    p.solver.addForAllConstraint(p.solver.varProducer.objPropVar(t2, prop), TokenListener.NATIVE_12, p.path.node, fn));
            }
        });
    }
}

/**
 * Models call to a promise executor with resolveFunction and rejectFunction as arguments.
 */
export function callPromiseExecutor(promise: AllocationSiteToken, resolveFunction: AllocationSiteToken, rejectFunction: AllocationSiteToken, p: NativeFunctionParams) {
    const args = p.path.node.arguments;
    if (args.length >= 1 && isExpression(args[0])) { // TODO: SpreadElement? non-MemberExpression?
        const funVar = p.solver.varProducer.expVar(args[0], p.path);
        p.solver.addForAllConstraint(funVar, TokenListener.CALL_PROMISE_EXECUTOR, p.path.node, (t: Token) => {
            if (t instanceof FunctionToken) {
                // TODO: register call and call edge for implicit call to promise executor?
                const param1 = t.fun.params.length > 0 && isIdentifier(t.fun.params[0]) ? t.fun.params[0] : undefined; // TODO: non-Identifier parameters?
                const param2 = t.fun.params.length > 1 && isIdentifier(t.fun.params[1]) ? t.fun.params[1] : undefined;
                p.solver.addTokenConstraint(resolveFunction, p.solver.varProducer.nodeVar(param1));
                p.solver.addTokenConstraint(rejectFunction, p.solver.varProducer.nodeVar(param2));
            }
        });
    }
}

/**
 * Models call to a promise resolve or reject function.
 */
export function callPromiseResolve(t: ObjectToken, args: CallExpression["arguments"], path: NodePath, op: Operations) {
    if (args.length >= 1 && isExpression(args[0])) { // TODO: non-Expression?
        const arg = op.expVar(args[0], path);
        if (arg) {
            // find the current promise
            const promise = op.a.canonicalizeToken(new AllocationSiteToken("Promise", t.allocSite, t.packageInfo));
            switch (t.kind) {
                case "PromiseResolve":
                    // for all argument values...
                    op.solver.addForAllConstraint(arg, TokenListener.CALL_PROMISE_RESOLVE, path.node, (vt: Token) => {
                        if (vt instanceof AllocationSiteToken && vt.kind === "Promise") {
                            // argument is a promise, transfer its values to the current promise
                            op.solver.addSubsetConstraint(op.solver.varProducer.objPropVar(vt, PROMISE_FULFILLED_VALUES), op.solver.varProducer.objPropVar(promise, PROMISE_FULFILLED_VALUES));
                            op.solver.addSubsetConstraint(op.solver.varProducer.objPropVar(vt, PROMISE_REJECTED_VALUES), op.solver.varProducer.objPropVar(promise, PROMISE_REJECTED_VALUES));
                        } else {
                            // argument is a non-promise value, assign it to the fulfilled value of the current promise
                            op.solver.addTokenConstraint(vt, op.solver.varProducer.objPropVar(promise, PROMISE_FULFILLED_VALUES));
                        }
                    });
                    break;
                case "PromiseReject":
                    // assign the argument value to the rejected value of the current promise
                    op.solver.addSubsetConstraint(arg, op.solver.varProducer.objPropVar(promise, PROMISE_REJECTED_VALUES));
                    break;
                default:
                    assert.fail();
            }
        }
    }
}

/**
 * Models a call to Promise.resolve or Promise.reject.
 */
export function returnResolvedPromise(kind: "resolve" | "reject", p: NativeFunctionParams) {
    const args = p.path.node.arguments;
    // make a new promise and return it
    const promise = newObject("Promise", p.globalSpecialNatives.get(PROMISE_PROTOTYPE)!, p);
    p.solver.addTokenConstraint(promise, p.solver.varProducer.expVar(p.path.node, p.path));
    if (args.length >= 1 && isExpression(args[0])) { // TODO: non-Expression?
        const arg = p.op.expVar(args[0], p.path);
        if (arg) {
            let prop: string, key;
            switch (kind) {
                case "resolve":
                    prop = PROMISE_FULFILLED_VALUES;
                    key = TokenListener.MAKE_PROMISE_RESOLVE;
                    break;
                case "reject":
                    prop = PROMISE_REJECTED_VALUES;
                    key = TokenListener.MAKE_PROMISE_REJECT;
                    break;
            }
            p.solver.addForAllConstraint(arg, key, p.path.node, (vt: Token) => {
                if (vt instanceof AllocationSiteToken && vt.kind === "Promise") {
                    // argument is a promise, return it
                    p.solver.addTokenConstraint(vt, p.solver.varProducer.expVar(p.path.node, p.path));
                } else {
                    // argument is a non-promise value, assign it to the fulfilled value of the new promise
                    p.solver.addTokenConstraint(vt, p.solver.varProducer.objPropVar(promise, prop));
                }
            });
        }
    }
}

/**
 * Models a call to Promise.all, Promise.allSettled, Promise.any or Promise.race.
 */
export function returnPromiseIterator(kind: "all" | "allSettled" | "any" | "race", p: NativeFunctionParams) {
    const args = p.path.node.arguments;
    if (args.length >= 1 && isExpression(args[0])) { // TODO: non-Expression?
        const arg = p.op.expVar(args[0], p.path);
        if (arg) {
            // make a new promise and return it
            const promise = newObject("Promise", p.globalSpecialNatives.get(PROMISE_PROTOTYPE)!, p);
            p.solver.addTokenConstraint(promise, p.solver.varProducer.expVar(p.path.node, p.path));
            let array: ArrayToken | undefined;
            if (kind === "all" || kind === "allSettled") {
                // add a new array as fulfilled value
                array = newArray(p);
                p.solver.addTokenConstraint(array, p.solver.varProducer.objPropVar(promise, PROMISE_FULFILLED_VALUES));
            }
            let allSettledObjects: AllocationSiteToken | undefined;
            if (kind === "allSettled") {
                // add a new object to the array
                allSettledObjects = newObject("Object", p.globalSpecialNatives.get(OBJECT_PROTOTYPE)!, p);
                p.solver.addTokenConstraint(allSettledObjects, p.solver.varProducer.arrayValueVar(array!));
            }
            // read the iterator values
            const tmp = p.solver.varProducer.intermediateVar(p.path.node, "returnPromiseIterator");
            p.op.readIteratorValue(arg, tmp, p.path.node);
            let key;
            switch (kind) {
                case "all":
                    key = TokenListener.MAKE_PROMISE_ALL;
                    break;
                case "allSettled":
                    key = TokenListener.MAKE_PROMISE_ALLSETTLED;
                    break;
                case "any":
                    key = TokenListener.MAKE_PROMISE_ANY;
                    break;
                case "race":
                    key = TokenListener.MAKE_PROMISE_RACE;
                    break;
            }
            p.solver.addForAllConstraint(tmp, key, p.path.node, (t: Token) => {
                const vp = p.solver.varProducer;
                switch (kind) {
                    case "all":
                        if (t instanceof AllocationSiteToken && t.kind === "Promise") {
                            // assign fulfilled values to the array and rejected values to the new promise
                            p.solver.addSubsetConstraint(vp.objPropVar(t, PROMISE_FULFILLED_VALUES), vp.arrayValueVar(array!));
                            p.solver.addSubsetConstraint(vp.objPropVar(t, PROMISE_REJECTED_VALUES), vp.objPropVar(promise, PROMISE_REJECTED_VALUES));
                        } else
                            p.solver.addTokenConstraint(t, vp.arrayValueVar(array!));
                        break;
                    case "allSettled":
                        if (t instanceof AllocationSiteToken && t.kind === "Promise") {
                            // assign fulfilled and rejected values to the 'value' and 'reason' properties, respectively
                            p.solver.addSubsetConstraint(vp.objPropVar(t, PROMISE_FULFILLED_VALUES), vp.objPropVar(allSettledObjects!, "value"));
                            p.solver.addSubsetConstraint(vp.objPropVar(t, PROMISE_REJECTED_VALUES), vp.objPropVar(allSettledObjects!, "reason"));
                        } else
                            p.solver.addTokenConstraint(t, vp.objPropVar(allSettledObjects!, "value"));
                        break;
                    case "any":
                        if (t instanceof AllocationSiteToken && t.kind === "Promise") {
                            // assign fulfilled values to the new promise
                            p.solver.addSubsetConstraint(vp.objPropVar(t, PROMISE_FULFILLED_VALUES), vp.objPropVar(promise, PROMISE_FULFILLED_VALUES));
                            // TODO: assign rejected values to an AggregateError object and assign that object to the rejected value of the new promise
                        } else
                            p.solver.addTokenConstraint(t, vp.objPropVar(promise, PROMISE_FULFILLED_VALUES));
                        break;
                    case "race":
                        if (t instanceof AllocationSiteToken && t.kind === "Promise") {
                            // assign fulfilled and rejected values to the new promise
                            p.solver.addSubsetConstraint(vp.objPropVar(t, PROMISE_FULFILLED_VALUES), vp.objPropVar(promise, PROMISE_FULFILLED_VALUES));
                            p.solver.addSubsetConstraint(vp.objPropVar(t, PROMISE_REJECTED_VALUES), vp.objPropVar(promise, PROMISE_REJECTED_VALUES));
                        } else
                            p.solver.addTokenConstraint(t, vp.objPropVar(promise, PROMISE_FULFILLED_VALUES));
                        break;
                }
            });
        }
    }
}
