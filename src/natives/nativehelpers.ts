import {CallExpression, Expression, isExpression, isIdentifier, isObjectExpression, isObjectProperty} from "@babel/types";
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
import {getBaseAndProperty, getKey, isParentExpressionStatement} from "../misc/asthelpers";
import {Node} from "@babel/core";
import {
    ARRAY_PROTOTYPE,
    FUNCTION_PROTOTYPE,
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
import {AccessorType, ConstraintVar, IntermediateVar, ObjectPropertyVarObj, isObjectPropertyVarObj} from "../analysis/constraintvars";
import {Location} from "../misc/util";

/**
 * Models an assignment from a function parameter (0-based indexing) to a property of the base object.
 */
export function assignParameterToThisProperty(param: number, prop: string, p: NativeFunctionParams) {
    if (p.path.node.arguments.length > param) {
        const bp = getBaseAndProperty(p.path);
        const arg = p.path.node.arguments[param];
        const argVar = isExpression(arg) ? p.solver.varProducer.expVar(arg, p.path) : undefined;
        if (argVar && bp) { // TODO: non-expression arguments?
            const baseVar = p.solver.varProducer.expVar(bp.base, p.path);
            p.solver.addForAllTokensConstraint(baseVar, TokenListener.NATIVE_1, arg, (t: Token) => {
                if (t instanceof NativeObjectToken || t instanceof AllocationSiteToken || t instanceof FunctionToken || t instanceof PackageObjectToken) {
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
    p.solver.addSubsetConstraint(argVar, p.solver.varProducer.arrayUnknownVar(t));
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
            p.solver.addForAllTokensConstraint(baseVar, TokenListener.NATIVE_2, arg, (t: Token) => {
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
        p.solver.addForAllTokensConstraint(baseVar, TokenListener.NATIVE_3, p.path.node, (t: Token) => {
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
        p.solver.addForAllTokensConstraint(baseVar, TokenListener.NATIVE_4, p.path.node, (t: Token) => {
            if (t instanceof ArrayToken)
                p.solver.addSubsetConstraint(p.solver.varProducer.arrayAllVar(t), p.solver.varProducer.nodeVar(p.path.node));
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
        const resVar = p.solver.varProducer.arrayUnknownVar(res);
        const baseVar = p.solver.varProducer.expVar(bp.base, p.path);
        p.solver.addForAllTokensConstraint(baseVar, TokenListener.NATIVE_5, p.path.node, (t: Token) => {
            if (t instanceof ArrayToken)
                p.solver.addSubsetConstraint(p.solver.varProducer.arrayAllVar(t), resVar);
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
        p.solver.addForAllTokensConstraint(baseVar, TokenListener.NATIVE_6, p.path.node, (t: Token) => {
            if (t instanceof ArrayToken)
                p.solver.addSubsetConstraint(p.solver.varProducer.arrayAllVar(t), baseVar);
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
export function returnPackageObject(p: NativeFunctionParams, kind: ObjectKind = "Object") {
    p.solver.addTokenConstraint(p.solver.globalState.canonicalizeToken(new PackageObjectToken(p.moduleInfo.packageInfo, kind)), p.solver.varProducer.expVar(p.path.node, p.path));
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
export function newObject(kind: ObjectKind, proto: NativeObjectToken | PackageObjectToken | Expression, p: NativeFunctionParams): AllocationSiteToken | PackageObjectToken {
    const t: AllocationSiteToken | PackageObjectToken = p.solver.globalState.canonicalizeToken(
        kind ==="Object" ? new ObjectToken(p.path.node) :
            kind === "Array" ? new ArrayToken(p.path.node) :
                new AllocationSiteToken(kind, p.path.node));
    if (proto instanceof Token)
        p.solver.addInherits(p.solver.fragmentState.maybeWidened(t), proto);
    else
        p.solver.addForAllTokensConstraint(p.op.expVar(proto, p.path), TokenListener.NATIVE_25, p.path.node, (pt: Token) => {
            if (isObjectPropertyVarObj(pt))
                p.solver.addInherits(p.solver.fragmentState.maybeWidened(t), pt);
        });
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
    const t = a.canonicalizeToken(new ArrayToken(p.path.node));
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
        p.solver.addForAllTokensConstraint(baseVar, TokenListener.NATIVE_7, p.path.node, (t: Token) => {
            const vp = p.solver.varProducer; // (don't use in callbacks)
            if (t instanceof AllocationSiteToken) {
                const iter = a.canonicalizeToken(new AllocationSiteToken("Iterator", t.allocSite));
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
                        p.solver.addSubsetConstraint(vp.arrayAllVar(t), iterValue);
                        break;
                    }
                    case "ArrayEntries": {
                        if (t.kind !== "Array")
                            break;
                        const pair = a.canonicalizeToken(new ArrayToken(p.path.node)); // TODO: see newArrayToken
                        p.solver.addInherits(t, p.globalSpecialNatives.get(ARRAY_PROTOTYPE)!);
                        p.solver.addTokenConstraint(pair, iterValue);
                        const oneVar = vp.objPropVar(pair, "1");
                        p.solver.addSubsetConstraint(vp.arrayAllVar(t), oneVar);
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
                        const pair = a.canonicalizeToken(new ArrayToken(p.path.node)); // TODO: see newArrayToken
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
                        const pair = a.canonicalizeToken(new ArrayToken(p.path.node)); // TODO: see newArrayToken
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
    "new Promise" |
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
            // const a = p.solver.globalState;
            const baseVar = p.solver.varProducer.expVar(bp.base, p.path);
            const funVar = p.solver.varProducer.expVar(funarg, p.path);
            // const caller = a.getEnclosingFunctionOrModule(p.path, p.moduleInfo);
            p.solver.addForAllTokenPairsConstraint(baseVar, funVar, key, funarg, kind, (bt: AllocationSiteToken, ft: FunctionToken | AccessPathToken) => { // TODO: ignoring native functions etc.
                invokeCallbackBound(kind, p, bt, ft, baseVar!);
                if (ft instanceof AccessPathToken) {
                    p.solver.fragmentState.registerEscapingToExternal(funVar, funarg);

                    // TODO: see case AccessPathToken in Operations.callFunction
                }
            });
        }
    }
}

export function invokeCallbackBound(kind: CallbackKind, p: NativeFunctionParams, bt: AllocationSiteToken | PackageObjectToken, ft: FunctionToken | AccessPathToken, pBaseVar: ConstraintVar | undefined) {
    const solver = p.solver;
    const f = solver.fragmentState;
    const vp = f.varProducer;
    const a = solver.globalState;
    const args = p.path.node.arguments;
    const arg1Var = isExpression(args[1]) ? vp.expVar(args[1], p.path) : undefined;
    const pResultVar = vp.expVar(p.path.node, p.path);
    const caller = a.getEnclosingFunctionOrModule(p.path, p.moduleInfo);

    const modelCall = (argVars: Array<ConstraintVar | undefined>, baseVar?: ConstraintVar, resultVar?: ConstraintVar) => {
        assert(ft instanceof FunctionToken);
        p.op.callFunctionTokenBound(ft, baseVar, caller, argVars, resultVar, false, p.path, {native: true});
    };

    // helper for constructing unique intermediate variables
    const iVarKey = `NativeCallback(${kind},${bt},${ft})`;
    const iVar = (label: string) => vp.intermediateVar(p.path.node, `${iVarKey}: ${label}`); // TODO: necessary to use such a long label?

    switch (kind) {
        case "Array.prototype.forEach":
        case "Array.prototype.every":
        case "Array.prototype.filter":
        case "Array.prototype.find":
        case "Array.prototype.findIndex":
        case "Array.prototype.flatMap":
        case "Array.prototype.map":
        case "Array.prototype.some": {
            let resultVar;

            switch (kind) {
                case "Array.prototype.map": {
                    // return new array with elements from the callback return values
                    const t = newArray(p);
                    resultVar = vp.arrayUnknownVar(t);
                    returnToken(t, p);
                    break;
                }
                case "Array.prototype.flatMap":
                    warnNativeUsed(kind, p, "(return value ignored)"); // TODO: return value...
                    break;
            }

            if (ft instanceof FunctionToken)
                // write array elements to param1
                modelCall([bt instanceof ArrayToken ? vp.arrayAllVar(bt) : undefined, undefined, pBaseVar], arg1Var, resultVar);

            // TODO: array functions are generic (can be applied to any array-like object, including strings), can also be sub-classed
            break;
        }
        case "Array.prototype.reduce":
        case "Array.prototype.reduceRight":
            if (ft instanceof FunctionToken) {
                // TODO: maybe independent of kind?
                const accVar = iVar("accumulator");

                if (args.length > 1) {
                    // bind initialValue to previousValue and resultVar
                    solver.addSubsetConstraint(arg1Var, accVar);
                    solver.addSubsetConstraint(arg1Var, pResultVar);
                } else if (args.length === 1 && bt instanceof ArrayToken) {
                    solver.addSubsetConstraint(vp.arrayUnknownVar(bt), accVar);
                    solver.addSubsetConstraint(vp.arrayUnknownVar(bt), pResultVar);

                    if (kind === "Array.prototype.reduce")
                        // initialValue is bt[0]
                        solver.addSubsetConstraint(vp.objPropVar(bt, "0"), accVar);
                    else // kind === "Array.prototype.reduceRight"
                        // initialValue is the last element
                        solver.addSubsetConstraint(vp.arrayAllVar(bt), accVar);

                    // works for both reduce and reduceRight as the initialValue only goes to the result if the array has length 1
                    solver.addSubsetConstraint(vp.objPropVar(bt, "0"), pResultVar);
                }

                // connect callback return value to previousValue
                const retVar = vp.returnVar(ft.fun);
                solver.addSubsetConstraint(retVar, accVar);

                // write array elements to currentValue
                modelCall([accVar, bt instanceof ArrayToken ? vp.arrayAllVar(bt) : undefined, undefined, pBaseVar], undefined, pResultVar);
            }
            break;
        case "Array.prototype.sort":
            if (bt instanceof ArrayToken && ft instanceof FunctionToken) { // TODO: currently limited support for generic array methods
                const btVar = vp.arrayAllVar(bt);
                p.solver.addSubsetConstraint(btVar, vp.arrayUnknownVar(bt));  // smash array
                // TODO: also change known entries
                modelCall([btVar, btVar]);
            }
            solver.addSubsetConstraint(pBaseVar, pResultVar);
            break;
        case "Map.prototype.forEach":
            if (bt.kind === "Map" && ft instanceof FunctionToken)
                modelCall([vp.objPropVar(bt, MAP_VALUES), vp.objPropVar(bt, MAP_KEYS), pBaseVar], arg1Var);
            break;
        case "Set.prototype.forEach":
            if (bt.kind === "Set" && ft instanceof FunctionToken)
                // TODO: what if called via e.g. bind? (same for other baseVar constraints above)
                modelCall([vp.objPropVar(bt, SET_VALUES), vp.objPropVar(bt, SET_VALUES), pBaseVar], arg1Var);
            break;
        case "new Promise": {
            // use labels that are independent of bt and ft to reduce number of variables
            const resolveFunVar = vp.intermediateVar(p.path.node, `NativeCallback(${kind}): resolve`);
            solver.addTokenConstraint(newObject("PromiseResolve", p.globalSpecialNatives.get(FUNCTION_PROTOTYPE)!, p), resolveFunVar);
            const rejectFunVar = vp.intermediateVar(p.path.node, `NativeCallback(${kind}): reject`);
            solver.addTokenConstraint(newObject("PromiseReject", p.globalSpecialNatives.get(FUNCTION_PROTOTYPE)!, p), rejectFunVar);
            modelCall([resolveFunVar, rejectFunVar]);
            break;
        }
        case "Promise.prototype.then$onFulfilled":
        case "Promise.prototype.then$onRejected":
        case "Promise.prototype.catch$onRejected":
        case "Promise.prototype.finally$onFinally": {
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
            const thenPromise = a.canonicalizeToken(new AllocationSiteToken("Promise", p.path.node));
            solver.addInherits(thenPromise, p.globalSpecialNatives.get(PROMISE_PROTOTYPE)!);

            if (ft instanceof FunctionToken) {
                // assign promise fulfilled/rejected value to the callback parameter and add call edge
                modelCall([prop !== undefined ? vp.objPropVar(bt, prop) : undefined]);

                // for all return values of the callback...
                solver.addForAllTokensConstraint(vp.returnVar(ft.fun), key, p.path.node, (t: Token) => {
                    if (t instanceof AllocationSiteToken && t.kind === "Promise") {
                        // when callback return value is a promise, transfer its values to the new promise
                        if (kind !== "Promise.prototype.finally$onFinally")
                            solver.addSubsetConstraint(solver.varProducer.objPropVar(t, PROMISE_FULFILLED_VALUES), solver.varProducer.objPropVar(thenPromise, PROMISE_FULFILLED_VALUES));
                        solver.addSubsetConstraint(solver.varProducer.objPropVar(t, PROMISE_REJECTED_VALUES), solver.varProducer.objPropVar(thenPromise, PROMISE_REJECTED_VALUES));
                    } else if (kind !== "Promise.prototype.finally$onFinally") {
                        // callback return value is a non-promise value, assign it to the fulfilled value of the new promise
                        solver.addTokenConstraint(t, solver.varProducer.objPropVar(thenPromise, PROMISE_FULFILLED_VALUES));
                    }
                });
            }
            // use identity function as onFulfilled handler at catch
            if (kind === "Promise.prototype.catch$onRejected")
                solver.addSubsetConstraint(vp.objPropVar(bt, PROMISE_FULFILLED_VALUES), vp.objPropVar(thenPromise, PROMISE_FULFILLED_VALUES));
            // pipe through fulfilled/rejected values at finally
            else if (kind === "Promise.prototype.finally$onFinally") {
                solver.addSubsetConstraint(vp.objPropVar(bt, PROMISE_FULFILLED_VALUES), vp.objPropVar(thenPromise, PROMISE_FULFILLED_VALUES));
                solver.addSubsetConstraint(vp.objPropVar(bt, PROMISE_REJECTED_VALUES), vp.objPropVar(thenPromise, PROMISE_REJECTED_VALUES));
            }
            // TODO: should use identity function for onFulfilled/onRejected in general if funVar is a non-function value
            // return the new promise
            returnToken(thenPromise, p);
            break;
        }
        default:
            kind satisfies never; // ensure that switch is exhaustive
    }
}

type CallApplyKind = "Function.prototype.call" | "Function.prototype.apply";

/**
 * Models 'call' or 'apply'.
 */
export function invokeCallApply(kind: CallApplyKind, p: NativeFunctionParams) {
    const bp = getBaseAndProperty(p.path);
    if (bp) {
        const funVar = p.solver.varProducer.expVar(bp.base, p.path);
        p.solver.addForAllTokensConstraint(funVar, TokenListener.NATIVE_INVOKE_CALL_APPLY, p.path.node, (ft: Token) => {
            if (ft instanceof FunctionToken || ft instanceof NativeObjectToken)
                invokeCallApplyBound(kind, p, ft);
        });
    }
}

export function invokeCallApplyBound(kind: CallApplyKind, p: NativeFunctionParams, ft: FunctionToken | NativeObjectToken) {
    if (ft instanceof NativeObjectToken) {
        if (ft.invoke)
            warnNativeUsed(`${kind} with native function`, p); // TODO: call/apply to native function
        return;
    }

    const a = p.solver.globalState;
    const vp = p.solver.varProducer;
    const args = p.path.node.arguments;
    const basearg = args[0];
    const caller = a.getEnclosingFunctionOrModule(p.path, p.moduleInfo);

    let argVars: Array<ConstraintVar | undefined> = [];
    // TODO: also model conversion for basearg to objects, see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/call
    // arguments
    switch (kind) {
        case "Function.prototype.call":
            // TODO: SpreadElement
            argVars = args.slice(1).map(arg => isExpression(arg) ? vp.expVar(arg, p.path) : undefined);
            break;
        case "Function.prototype.apply": {
            if (args.length >= 2 && isExpression(args[1])) { // TODO: SpreadElement
                const escapes = (ft.fun.loc as Location).module !== p.moduleInfo;
                const argVar = vp.expVar(args[1], p.path);
                // model dynamic parameter passing like 'callFunctionTokenBound'
                p.solver.addForAllTokensConstraint(argVar, TokenListener.NATIVE_INVOKE_CALL_APPLY2, ft.fun, (t: Token) => {
                    if (t instanceof ArrayToken) {
                        p.solver.addForAllArrayEntriesConstraint(t, TokenListener.NATIVE_INVOKE_CALL_APPLY3, ft.fun, (prop: string) => {
                            const param = parseInt(prop);
                            if (param >= 0 && param < ft.fun.params.length && isIdentifier(ft.fun.params[param])) { // TODO: non-Identifier parameters?
                                const opv = p.solver.varProducer.objPropVar(t, prop);
                                const paramVar = p.solver.varProducer.nodeVar(ft.fun.params[param]);
                                p.solver.addSubsetConstraint(opv, paramVar);
                            }
                            if (escapes) {
                                const opv = p.solver.varProducer.objPropVar(t, prop);
                                p.solver.fragmentState.registerEscapingFromModule(opv);
                            }
                        });
                        // TODO: p.solver.addSubsetConstraint(vp.arrayValueVar(t), ...);
                    }
                });
            }
            break;
        }
    }

    // base value
    // TODO: SpreadElement? non-MemberExpression?
    const baseVar = isExpression(basearg) ? vp.expVar(basearg, p.path) : undefined;
    const resultVar = vp.expVar(p.path.node, p.path);
    p.op.callFunctionTokenBound(ft, baseVar, caller, argVars, resultVar, false, p.path, {native: true});
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
        p.solver.addForAllTokensConstraint(funVar, TokenListener.NATIVE_INVOKE_BIND, p.path.node, (ft: Token) => {
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
export function assignIteratorValuesToProperty(param: number, t: AllocationSiteToken | PackageObjectToken, prop: string, p: NativeFunctionParams) {
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
        const dst = p.solver.varProducer.arrayUnknownVar(t);
        p.op.readIteratorValue(src, dst, p.path.node);
    }
}

/**
 * Models flow from key-value pairs of the given iterator's values to the given object key and value properties.
 */
export function assignIteratorMapValuePairs(param: number, t: AllocationSiteToken | PackageObjectToken, keys: string | null, values: string, p: NativeFunctionParams) {
    const arg = p.path.node.arguments[param];
    if (isExpression(arg)) { // TODO: non-Expression argument
        const src = p.op.expVar(arg, p.path);
        const dst = p.solver.varProducer.intermediateVar(p.path.node, "assignIteratorValuePairsToProperties");
        p.op.readIteratorValue(src, dst, p.path.node);
        p.solver.addForAllTokensConstraint(dst, TokenListener.NATIVE_8, p.path.node.arguments[param], (t2: Token) => {
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
        const dst = p.solver.varProducer.arrayUnknownVar(t);
        p.solver.addForAllTokensConstraint(baseVar, TokenListener.NATIVE_9, p.path.node, (t2: Token) => {
            if (t2 instanceof ArrayToken)
                p.solver.addSubsetConstraint(p.solver.varProducer.arrayAllVar(t2), dst);
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
        const dst = p.solver.varProducer.arrayUnknownVar(t);
        p.solver.addForAllTokensConstraint(baseVar, TokenListener.NATIVE_10, p.path.node, (t2: Token) => {
            if (t2 instanceof ArrayToken)
                p.solver.addForAllTokensConstraint(p.solver.varProducer.arrayAllVar(t2), TokenListener.NATIVE_11, p.path.node, (t3: Token) => {
                    if (t3 instanceof ArrayToken)
                        p.solver.addSubsetConstraint(p.solver.varProducer.arrayAllVar(t3), dst);
                });
        });
    }
}

/**
 * Models call to a promise executor.
 */
export function callPromiseExecutor(promise: AllocationSiteToken | PackageObjectToken, p: NativeFunctionParams) {
    const args = p.path.node.arguments;
    if (args.length >= 1 && isExpression(args[0])) { // TODO: SpreadElement? non-MemberExpression?
        const funVar = p.solver.varProducer.expVar(args[0], p.path);
        p.solver.addForAllTokensConstraint(funVar, TokenListener.CALL_PROMISE_EXECUTOR, p.path.node, (t: Token) => {
            if (t instanceof FunctionToken)
                invokeCallbackBound("new Promise", p, promise, t, undefined);
        });
    }
}

/**
 * Models call to a promise resolve or reject function.
 */
export function callPromiseResolve(t: AllocationSiteToken, args: CallExpression["arguments"], path: NodePath, op: Operations) {
    if (args.length >= 1 && isExpression(args[0])) { // TODO: non-Expression?
        const arg = op.expVar(args[0], path);
        if (arg) {
            // find the current promise
            const promise = op.a.canonicalizeToken(new AllocationSiteToken("Promise", t.allocSite));
            switch (t.kind) {
                case "PromiseResolve":
                    // for all argument values...
                    op.solver.addForAllTokensConstraint(arg, TokenListener.CALL_PROMISE_RESOLVE, path.node, (vt: Token) => {
                        const vp = op.solver.varProducer;
                        if (vt instanceof AllocationSiteToken && vt.kind === "Promise") {
                            // argument is a promise, transfer its values to the current promise
                            op.solver.addSubsetConstraint(vp.objPropVar(vt, PROMISE_FULFILLED_VALUES), vp.objPropVar(promise, PROMISE_FULFILLED_VALUES));
                            op.solver.addSubsetConstraint(vp.objPropVar(vt, PROMISE_REJECTED_VALUES), vp.objPropVar(promise, PROMISE_REJECTED_VALUES));
                        } else {
                            // argument is a non-promise value, assign it to the fulfilled value of the current promise
                            op.solver.addTokenConstraint(vt, vp.objPropVar(promise, PROMISE_FULFILLED_VALUES));
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
            p.solver.addForAllTokensConstraint(arg, key, p.path.node, (vt: Token) => {
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
            let allSettledObjects: AllocationSiteToken | PackageObjectToken | undefined;
            if (kind === "allSettled") {
                // add a new object to the array
                allSettledObjects = newObject("Object", p.globalSpecialNatives.get(OBJECT_PROTOTYPE)!, p);
                p.solver.addTokenConstraint(allSettledObjects, p.solver.varProducer.arrayUnknownVar(array!));
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
            p.solver.addForAllTokensConstraint(tmp, key, p.path.node, (t: Token) => {
                const vp = p.solver.varProducer;
                switch (kind) {
                    case "all":
                        if (t instanceof AllocationSiteToken && t.kind === "Promise") {
                            // assign fulfilled values to the array and rejected values to the new promise
                            p.solver.addSubsetConstraint(vp.objPropVar(t, PROMISE_FULFILLED_VALUES), vp.arrayUnknownVar(array!));
                            p.solver.addSubsetConstraint(vp.objPropVar(t, PROMISE_REJECTED_VALUES), vp.objPropVar(promise, PROMISE_REJECTED_VALUES));
                        } else
                            p.solver.addTokenConstraint(t, vp.arrayUnknownVar(array!));
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

type PreparedDefineProperty = {
    prop: string,
    ac: AccessorType,
    ivar: IntermediateVar
};

/*
 * Reads values from a property descriptor into intermediate constraint variables
 * that can be assigned (via subset edges) to properties of objects.
 * @param name the name of the native function that is modeled
 * @param prop the property name associated with the property descriptor
 * @param descriptor expression for the property descriptor object
 * @param nodes 3 unique AST nodes to attach property reads to
 */
export function prepareDefineProperty(
    name: "Object.defineProperty" | "Object.defineProperties" | "Object.create",
    prop: string,
    descriptor: ConstraintVar | undefined,
    nodes: [Node, Node, Node],
    p: NativeFunctionParams,
): Array<PreparedDefineProperty> {
    if (!descriptor)
        return [];

    // FIXME: we want to read 3 properties from the descriptor object at the same AST node.
    // this is not possible as the (constraintvar, listenerID, AST node) tuple needs to be
    // unique for each readProperty operation.
    // as a hacky work-around the caller must supply 3 unique AST nodes
    const enclosing = p.solver.globalState.getEnclosingFunctionOrModule(p.path, p.moduleInfo);
    return (["value", "get", "set"] as const).map((descriptorProp, i) => {
        const ivar = p.solver.varProducer.intermediateVar(p.path.node, `${name} (${prop}.${descriptorProp})`);
        p.op.readProperty(descriptor, descriptorProp, ivar, nodes[i], enclosing);
        return {prop, ac: descriptorProp === "value"? "normal" : descriptorProp, ivar};
    });
}

/*
 * Reads values from an object literal containing property descriptors as values into
 * intermediate constraint variables that can be assigned (via subset edges) to
 * properties of objects.
 * @param name the name of the native function that is modeled
 * @param props AST node of the object literal containing property descriptors
 * @param nodes see above
 */
export function prepareDefineProperties(
    name: "Object.defineProperties" | "Object.create",
    props: Expression,
    p: NativeFunctionParams,
): Array<PreparedDefineProperty> {
    // TODO: modeling this operation for non-literal expressions requires
    // either a new kind of pair constraint or a way to generate listener IDs
    // based on the property that is defined. currently we can have at most
    // one for-all constraint on obj at this node, but we need N where N is the
    // number of (unique) properties on objects flowing to the props expression
    if (!isObjectExpression(props)) {
        warnNativeUsed(name, p, "with non-object expression");
        return [];
    }

    // get the canonicalized object token for the object expression
    const pobj = p.op.newObjectToken(props);

    return props.properties.flatMap((oprop) => {
        if (!isObjectProperty(oprop)) {
            warnNativeUsed(name, p, `with property kind: '${oprop.type}'`);
            return [];
        }

        const key = getKey(oprop);
        if (!key) {
            warnNativeUsed(name, p, "with dynamic property name");
            return [];
        }

        const dvar = p.solver.varProducer.objPropVar(pobj, key);
        return prepareDefineProperty(name, key, dvar, [oprop, oprop.key, oprop.value], p);
    });
}

/*
 * Assigns values collected from property descriptors to the objects in the given constraint variable.
 * @param obj the object token or the expression that holds objects that properties should be written to
 * @param key TokenListener to use for the constraint
 * @param ivars prepared values from property descriptors
 */
export function defineProperties(
    obj: Expression | ObjectPropertyVarObj,
    key: TokenListener,
    ivars: Array<PreparedDefineProperty>,
    p: NativeFunctionParams,
) {
    if (ivars.length === 0)
        return;

    const enclosing = p.solver.globalState.getEnclosingFunctionOrModule(p.path, p.moduleInfo);

    function write(t: Token, lVar?: ConstraintVar) {
        for (const {prop, ac, ivar} of ivars)
            p.op.writeProperty(ivar, lVar, t, prop, p.path.node, enclosing, undefined, ac, false);
    }

    if (obj instanceof Token)
        write(obj);
    else {
        const lVar = p.op.expVar(obj, p.path);
        p.solver.addForAllTokensConstraint(lVar, key, p.path.node, (t: Token) => write(t, lVar));
    }
}
