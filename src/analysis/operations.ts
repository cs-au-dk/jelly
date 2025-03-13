import {
    Expression,
    Function,
    isArrayPattern,
    isAssignmentPattern,
    isExportDeclaration,
    isExpression,
    isIdentifier,
    isLVal,
    isMemberExpression,
    isMetaProperty,
    isObjectPattern,
    isOptionalMemberExpression,
    isParenthesizedExpression,
    isRestElement,
    isSpreadElement,
    isStringLiteral,
    isSuper,
    isTSParameterProperty,
    isTypeCastExpression,
    JSXElement,
    JSXIdentifier,
    JSXMemberExpression,
    JSXNamespacedName,
    LVal,
    Node,
    OptionalMemberExpression,
    ParenthesizedExpression,
    TypeCastExpression
} from "@babel/types";
import {NodePath} from "@babel/traverse";
import {
    getAdjustedCallNodePath,
    getEnclosingFunction,
    getEnclosingNonArrowFunction,
    getKey,
    getProperty,
    isInTryBlockOrBranch,
    isMaybeUsedAsPromise,
    isParentExpressionStatement
} from "../misc/asthelpers";
import {
    AccessPathToken,
    AllocationSiteToken,
    ArrayToken,
    ClassToken,
    FunctionToken,
    NativeObjectToken,
    ObjectToken,
    PackageObjectToken,
    PrototypeToken,
    Token
} from "./tokens";
import {
    AccessorType,
    ConstraintVar,
    IntermediateVar,
    isObjectPropertyVarObj,
    NodeVar,
    ObjectPropertyVarObj,
    ReadResultVar
} from "./constraintvars";
import {
    CallResultAccessPath,
    ComponentAccessPath,
    IgnoredAccessPath,
    ModuleAccessPath,
    PropertyAccessPath,
    UnknownAccessPath
} from "./accesspaths";
import Solver, {ListenerKey} from "./solver";
import {GlobalState} from "./globalstate";
import {DummyModuleInfo, FunctionInfo, ModuleInfo, normalizeModuleName, PackageInfo} from "./infos";
import logger from "../misc/logger";
import {isLocalRequire, requireResolve} from "../misc/files";
import {options} from "../options";
import {FilePath, getOrSet, isArrayIndex, Location, locationToString, locationToStringWithFile} from "../misc/util";
import assert from "assert";
import {
    INTERNAL_PROTOTYPE,
    isNativeProperty,
    MAP_KEYS,
    MAP_VALUES,
    OBJECT_PROTOTYPE,
    PROMISE_FULFILLED_VALUES,
    SET_VALUES,
} from "../natives/ecmascript";
import {CallNodePath, SpecialNativeObjects} from "../natives/nativebuilder";
import {TokenListener} from "./listeners";
import micromatch from "micromatch";
import {callPromiseResolve} from "../natives/nativehelpers";
import Module from "module";

/**
 * Models of core JavaScript operations used by astvisitor and nativehelpers.
 */
export class Operations {

    readonly globalSpecialNatives: SpecialNativeObjects; // shortcut to this.solver.globalState.globalSpecialNatives

    readonly a: GlobalState; // shortcut to this.solver.globalState

    readonly moduleInfo: ModuleInfo;

    readonly packageInfo: PackageInfo;

    readonly packageObjectToken: PackageObjectToken;

    readonly exportsObjectToken: NativeObjectToken;

    constructor(
        readonly file: FilePath,
        readonly solver: Solver,
        readonly moduleSpecialNatives: SpecialNativeObjects
    ) {
        this.globalSpecialNatives = this.solver.globalState.globalSpecialNatives!;
        this.a = this.solver.globalState;

        this.moduleInfo = this.a.getModuleInfo(file);
        this.packageInfo = this.moduleInfo.packageInfo;
        this.packageObjectToken = this.a.canonicalizeToken(new PackageObjectToken(this.packageInfo));
        this.exportsObjectToken = this.a.canonicalizeToken(new NativeObjectToken("exports", this.moduleInfo));
        this.a.patching?.registerAllocationSite(this.exportsObjectToken);
    }

    /**
     * Finds the constraint variable for the given expression in the current module using ConstraintVarProducer.expVar.
     * Also adds @Unknown and a subset constraint for globalThis.E if the given expression E is an implicitly declared global variable.
     */
    expVar(exp: Expression | JSXIdentifier | JSXMemberExpression | JSXNamespacedName, path: NodePath): ConstraintVar | undefined {
        const v = this.solver.varProducer.expVar(exp, path);

        // if the expression is a variable that has not been declared normally... (unbound set by preprocessAst)
        if (v instanceof NodeVar && isIdentifier(v.node) && (v.node.loc as Location).unbound) {

            // the variable may be a property of globalThis
            // constraint: globalThis.X ∈ ⟦X⟧
            this.solver.addSubsetConstraint(this.solver.varProducer.objPropVar(this.globalSpecialNatives.get("globalThis")!, v.node.name), v);

            // the variable may be declared explicitly by unknown code
            // constraint: @Unknown ∈ ⟦X⟧
            this.solver.addAccessPath(UnknownAccessPath.instance, v);
        }
        return v;
    }

    private getRequireHints(pars: NodePath): Array<string> | undefined {
        return this.a.patching?.getRequireHints((pars.node.loc as Location).module?.toString(), locationToString(pars.node.loc, false, true));
    }

    /**
     * Models calling a component.
     * @param path path of the call expression
     */
    callComponent(path: NodePath<JSXElement>) {
        const componentVar = this.expVar(path.node.openingElement.name, path);
        if (componentVar) {
            const caller = this.a.getEnclosingFunctionOrModule(path);
            const f = this.solver.fragmentState; // (don't use in callbacks)
            f.registerCall(path.node, caller, componentVar);
            this.solver.addForAllTokensConstraint(componentVar, TokenListener.JSX_ELEMENT, path.node, (t: Token) => {
                if (t instanceof AccessPathToken)
                    this.solver.addAccessPath(new ComponentAccessPath(componentVar), this.solver.varProducer.nodeVar(path.node), path.node, caller, t.ap);
                else if (t instanceof FunctionToken) {
                    const f = this.solver.fragmentState;
                    f.registerCallEdge(path.node, caller, this.a.functionInfos.get(t.fun)!);
                    // TODO: model call using one object that has all attributes as properties, see tests/micro/jsx2.jsx
                }
            });
        }
    }

    /**
     * Models calling a function.
     * @param path path of the call expression
     */
    callFunction(path: CallNodePath) {
        const f = this.solver.fragmentState; // (don't use in callbacks)
        const vp = this.solver.varProducer; // (don't use in callbacks)

        const caller = this.a.getEnclosingFunctionOrModule(path);

        let p = path.get("callee");
        while (p.isParenthesizedExpression())
            p = p.get("expression");

        const calleeVar = isExpression(p.node) ? this.expVar(p.node, p) : undefined;

        const pars = getAdjustedCallNodePath(path);
        f.registerCall(pars.node, caller, calleeVar);

        // collect special information for pattern matcher
        if (isParentExpressionStatement(pars))
            f.registerCallWithUnusedResult(path.node);
        if (isMaybeUsedAsPromise(path))
            f.registerCallWithResultMaybeUsedAsPromise(path.node);
        f.registerInvokedExpression(path.node.callee);

        const resultVar = vp.nodeVar(path.node);
        const args = path.node.arguments;
        const argVars = args.map(arg => {
            if (isExpression(arg))
                return this.expVar(arg, path);
            else if (isSpreadElement(arg))
                f.warnUnsupported(arg, "SpreadElement in arguments"); // TODO: SpreadElement in arguments
            return undefined;
        });

        const handleCall = (base: ObjectPropertyVarObj | undefined, t: Token) => {
            this.callFunctionBound(base, t, calleeVar, argVars, resultVar, strings, path);
        };

        const key =
            p.isMemberExpression() || p.isOptionalMemberExpression() ? TokenListener.CALL_METHOD
                : (isIdentifier(path.node.callee) && path.node.callee.name === "require") ? TokenListener.CALL_REQUIRE
                    : TokenListener.CALL_FUNCTION;

        // expression E0(E1,...,En) or new E0(E1,...,En)
        // constraint: ∀ functions t ∈ ⟦E0⟧: ...
        this.solver.addForAllTokensConstraint(calleeVar, key, path.node, (t: Token) => handleCall(undefined, t));
        // this looks odd for method calls (E0.p(E1,...,En)), but ⟦E0.p⟧ is empty for method calls
        // (see the special case for visitMemberExpression in astvisitor.ts)
        // the constraint is used for method calls when:
        // - the property is unknown
        // - the property is known and an access path is found in the base variable (a derived access path is added to calleeVar)
        // - calls are patched by --patch-method-calls

        if (p.isMemberExpression() || p.isOptionalMemberExpression()) {
            // expression E0.p(E1,...,En) or new E0.p(E1,...,En)
            const baseVar = this.expVar(p.node.object, p);
            const prop = getProperty(p.node);

            f.registerPropertyRead("call", undefined, baseVar, this.packageObjectToken, prop, p.node, caller);
            f.registerMethodCall(path.node, baseVar, prop, calleeVar, argVars, caller);

            if (prop === undefined) {
                this.solver.fragmentState.registerEscaping(baseVar); // unknown properties of the base object may escape
                this.solver.addAccessPath(UnknownAccessPath.instance, calleeVar);
            }

            // TODO: this is very similar to Operations.readProperty - refactor?
            // constraint: ∀ objects t ∈ ⟦E0⟧: ...
            this.solver.addForAllTokensConstraint(baseVar, TokenListener.CALL_BASE, path.node, (t: Token) => {
                let callees: ConstraintVar | undefined;

                if (prop !== undefined) {
                    if (isObjectPropertyVarObj(t))
                        callees = this.readPropertyFromChain(t, prop);
                    else {
                        assert(t instanceof AccessPathToken);

                        // constraint: ... if t is access path, @E0.p ∈ ⟦E0.p⟧
                        this.solver.addAccessPath(new PropertyAccessPath(baseVar!, prop), calleeVar, p.node, caller, t.ap);
                    }
                } else if (t instanceof ArrayToken)
                    // TODO: ignoring reads from prototype chain
                    // TODO: assuming dynamic reads from arrays only read array indices
                    callees = this.solver.varProducer.arrayAllVar(t);
                else if (!(t instanceof AccessPathToken)) {
                    // TODO: warn about unhandled dynamic method call?
                }

                if (callees) {
                    assert(isObjectPropertyVarObj(t));
                    this.solver.fragmentState.registerCall(pars.node, caller, callees);
                    // the node parameter is required as it defines the argument variables, result variable,
                    // and various implicit parameters of native calls
                    this.solver.addForAllTokensConstraint(callees, key, {n: path.node, t},
                        (ft: Token) => handleCall(t, ft));
                }

                if (t instanceof AccessPathToken)
                    if (prop === "call" || prop === "apply")
                        this.solver.addAccessPath(new CallResultAccessPath(baseVar!), resultVar, path.node, caller, t.ap);
                    else if (prop === "bind")
                        this.solver.addTokenConstraint(t, resultVar);
            });
        }
        const strings = args.length >= 1 && isStringLiteral(args[0]) ? [args[0].value] : [];

        // 'import' expression
        if (path.get("callee").isImport() && args.length >= 1) {
            const v = this.a.canonicalizeVar(new IntermediateVar(path.node, "import"));
            const ss = strings.length > 0 ? strings : this.getRequireHints(p) ?? [];
            if (ss.length === 0)
                f.warnUnsupported(path.node, `Unhandled 'import'${this.a.patching ? " (no hints found)" : ""}`);
            for (const str of ss)
                this.requireModule(str, v, path);
            const promise = this.newPromiseToken(path.node);
            this.solver.addTokenConstraint(promise, this.expVar(path.node, path));
            this.solver.addSubsetConstraint(v, this.solver.varProducer.objPropVar(promise, PROMISE_FULFILLED_VALUES));
        }
    }

    callFunctionBound(
        base: ObjectPropertyVarObj | undefined,
        t: Token,
        calleeVar: ConstraintVar | undefined,
        argVars: Array<ConstraintVar | undefined>,
        resultVar: ConstraintVar | undefined,
        strings: Array<string>,
        path: CallNodePath,
    ) {
        const f = this.solver.fragmentState; // (don't use in callbacks)
        const caller = this.a.getEnclosingFunctionOrModule(path);
        const pars = getAdjustedCallNodePath(path);
        const args = path.node.arguments;
        const isNew = path.isNewExpression();
        if (base)
            base = f.maybeWidened(base);
        if (t instanceof FunctionToken)
            this.callFunctionTokenBound(t, base, caller, argVars, resultVar, isNew, path);
        else if (t instanceof NativeObjectToken) {
            f.registerCall(pars.node, caller, undefined, {native: true});
            if (options.ignoreImpreciseNativeCalls && calleeVar && f.getTokensSize(f.getRepresentative(calleeVar))[0] > 2)
                f.warnUnsupported(path.node, `Ignoring imprecise call to ${t}`);
            else if (t.invoke && (!isNew || t.constr))
                t.invoke({
                    base,
                    path,
                    solver: this.solver,
                    op: this,
                    moduleInfo: this.moduleInfo,
                    moduleSpecialNatives: this.moduleSpecialNatives,
                    globalSpecialNatives: this.globalSpecialNatives,
                });

            if (t.name === "require") {

                // require(...)
                const ss = strings.length > 0 ? strings : this.getRequireHints(pars) ?? [];
                if (ss.length === 0)
                    f.warnUnsupported(path.node, `Unhandled 'require'${this.a.patching ? " (no hints found)" : ""}`);
                for (const str of ss)
                    this.requireModule(str, resultVar, path);
            }

        } else if (t instanceof AllocationSiteToken && (t.kind === "PromiseResolve" || t.kind === "PromiseReject") && !isNew) {
            callPromiseResolve(t, path.node.arguments, path, this);

        } else if (t instanceof AccessPathToken) {
            f.registerCall(pars.node, caller, undefined, {external: true});
            for (const arg of args)
                if (isExpression(arg)) // TODO: handle non-Expression arguments?
                    f.registerEscaping(f.varProducer.expVar(arg, path));

            // constraint: add CallResultAccessPath
            assert(calleeVar);
            this.solver.addAccessPath(new CallResultAccessPath(calleeVar), resultVar, path.node, caller, t.ap);

            for (let i = 0; i < argVars.length; i++) {
                const argVar = argVars[i];
                if (argVar) {
                    // constraint: assign UnknownAccessPath to arguments to function arguments for external functions, also add (artificial) call edge
                    this.solver.addForAllTokensConstraint(argVar, TokenListener.CALL_EXTERNAL, pars.node, (at: Token) =>
                        this.invokeExternalCallback(at, pars.node, caller));
                    f.registerEscapingToExternal(argVar, args[i], caller);
                } else if (isSpreadElement(args[i]))
                    f.warnUnsupported(args[i], "SpreadElement in arguments to external function"); // TODO: SpreadElement in arguments to external function
            }
            // TODO: also add arguments (and everything reachable from them) to escaping?
            // TODO: also add UnknownAccessPath to properties of object arguments for external functions? (see also TODO at AssignmentExpression)

            // TODO: if caller is MemberExpression with property 'apply', 'call' or 'bind', treat as call to the native function of that name (relevant for lodash/atomizer TAPIR benchmark)
        }

        if (!options.oldobj) {
            // if 'new' and function...
            if (isNew && t instanceof FunctionToken) {

                // constraint: q ∈ ⟦new E0(E1,...,En)⟧ where q is the instance object
                const q = this.newObjectToken(t.fun);
                this.solver.addTokenConstraint(q, resultVar);

                // ... q ∈ ⟦this_f⟧
                this.solver.addTokenConstraint(q, this.solver.varProducer.thisVar(t.fun));

                // constraint: ⟦t.prototype⟧ ⊆ ⟦q.[[Prototype]]⟧
                this.solver.addInherits(q, this.solver.varProducer.objPropVar(t, "prototype"));
            }
        } else {

            // if 'new' and function...
            if (isNew && (t instanceof FunctionToken || t instanceof ClassToken)) {

                // constraint: t ∈ ⟦new E0(E1,...,En)⟧ where t is the current PackageObjectToken
                this.solver.addTokenConstraint(this.packageObjectToken, resultVar);
            }
        }
    }

    callFunctionTokenBound(
        t: FunctionToken,
        base: ConstraintVar | ObjectPropertyVarObj | undefined,
        caller: FunctionInfo | ModuleInfo,
        args: Array<Token | ConstraintVar | undefined>,
        resultVar: ConstraintVar | undefined,
        isNew: boolean,
        path: CallNodePath,
        kind: {native?: boolean, accessor?: boolean, external?: boolean} = {},
    ) {
        // helper function for adding a token or subset constraint
        const addInclusionConstraint = (from: Token | ConstraintVar, to: ConstraintVar) => {
            if (from instanceof Token)
                this.solver.addTokenConstraint(from, to);
            else
                this.solver.addSubsetConstraint(from, to);
        };

        const f = this.solver.fragmentState; // (don't use in callbacks)
        const vp = f.varProducer;
        const pars = getAdjustedCallNodePath(path);
        f.registerCallEdge(pars.node, caller, this.a.functionInfos.get(t.fun)!, kind);
        const argumentsToken = f.functionsWithArguments.has(t.fun) ? this.a.canonicalizeToken(new ArrayToken(t.fun.body)) : undefined;
        for (const [i, arg] of args.entries()) {
            // constraint: ...: ⟦Ei⟧ ⊆ ⟦Xi⟧ for each argument/parameter i (Xi may be a pattern)
            if (i < t.fun.params.length) {
                const param = t.fun.params[i];
                if (isRestElement(param)) {
                    // read the remaining arguments into a fresh array
                    const rest = args.slice(i);
                    const t = this.newArrayToken(param);
                    for (const [i, rarg] of rest.entries())
                        if (rarg) // TODO: SpreadElement in arguments (warning emitted below)
                            addInclusionConstraint(rarg, vp.objPropVar(t, String(i)));
                    this.solver.addTokenConstraint(t, vp.nodeVar(param));
                } else if (arg)
                    addInclusionConstraint(arg, vp.nodeVar(param));
            }
            // constraint ...: ⟦Ei⟧ ⊆ ⟦t_arguments[i]⟧ for each argument i if the function uses 'arguments'
            if (argumentsToken && arg)
                addInclusionConstraint(arg, vp.objPropVar(argumentsToken, String(i)));
        }
        // constraint: ...: t_arguments ∈ ⟦t_arguments⟧ if the function uses 'arguments'
        if (argumentsToken)
            this.solver.addTokenConstraint(argumentsToken, vp.argumentsVar(t.fun));
        // constraint: if non-'new', E0 is a member expression E.m, then ⟦E⟧ ⊆ ⟦this_f⟧
        if (!isNew) {
            // ...except if E or E0 is 'super'
            const sup = isSuper(path.node.callee);
            if (sup || (isMemberExpression(path.node.callee) && isSuper(path.node.callee.object))) {
                const fun = getEnclosingNonArrowFunction(path);
                if (fun) {
                    // ... ⟦this_g⟧ ⊆ ⟦this_f⟧ where g is the current function
                    addInclusionConstraint(vp.thisVar(fun), vp.thisVar(t.fun));

                    if (sup) {
                        // ... ⟦return_f⟧ ⊆ ⟦return_g⟧
                        this.solver.addSubsetConstraint(vp.returnVar(t.fun), vp.returnVar(fun));
                    }
                }
            } else if (base)
                addInclusionConstraint(base, vp.thisVar(t.fun));
        }
        // constraint: ...: ⟦ret_t⟧ ⊆ ⟦(new) E0(E1,...,En)⟧
        if (!isParentExpressionStatement(pars))
            this.solver.addSubsetConstraint(vp.returnVar(t.fun), resultVar);
    }

    /**
     * Models callback for external function.
     */
    invokeExternalCallback(at: Token, node: Node, caller: ModuleInfo | FunctionInfo) {
        if (at instanceof FunctionToken) {
            const f = this.solver.fragmentState;
            f.registerCall(node, caller, undefined, {external: true});
            f.registerCallEdge(node, caller, this.a.functionInfos.get(at.fun)!, {external: true});
            if (!f.externalCallbacksProcessed.has(at)) {
                f.externalCallbacksProcessed.add(at);
                for (let j = 0; j < at.fun.params.length; j++)
                    if (isIdentifier(at.fun.params[j])) // TODO: non-identifier parameters?
                        this.solver.addAccessPath(UnknownAccessPath.instance, f.varProducer.nodeVar(at.fun.params[j]));
                this.solver.addAccessPath(UnknownAccessPath.instance, f.varProducer.thisVar(at.fun));
                // TODO: handle 'this' under --newobj?
            }
        }
    }

    /**
     * Models reading a property of all objects in a constraint variable.
     * @param base constraint variable representing the base variable
     * @param prop property name, undefined if unknown
     * @param dst constraint variable for the result, or undefined if not applicable
     * @param node AST node where the operation occurs (used for constraint keys etc.)
     * @param enclosing enclosing function/module of the AST node
     * @param extrakey is included as the str parameter when computing listener IDs
     */
    readProperty(base: ConstraintVar | undefined, prop: string | undefined, dst: ConstraintVar | undefined, node: Node, enclosing: FunctionInfo | ModuleInfo, extrakey = "") {
        this.solver.fragmentState.registerPropertyRead("read", dst, base, this.packageObjectToken, prop, node, enclosing);
        const lopts = {n: node, s: extrakey};

        // expression E.p or E["p"] or E[i]
        if (prop !== undefined) {

            // constraint: ∀ objects t ∈ ⟦E⟧: ...
            this.solver.addForAllTokensConstraint(base, TokenListener.READ_BASE, lopts, (t: Token) => {
                if (isObjectPropertyVarObj(t)) {

                    this.solver.addSubsetConstraint(this.readPropertyFromChain(t, prop), dst);

                    if (options.oldobj) {
                        if ((t instanceof FunctionToken || t instanceof ClassToken) && prop === "prototype") {
                            // constraint: ... p="prototype" ∧ t is a function or class ⇒ k ∈ ⟦E.p⟧ where k represents the package
                            if (dst)
                                this.solver.addTokenConstraint(this.packageObjectToken, dst);
                        }
                    }

                } else if (t instanceof AccessPathToken) {

                    // constraint: ... if t is access path, @E.p ∈ ⟦E.p⟧
                    this.solver.addAccessPath(new PropertyAccessPath(base!, prop), this.solver.varProducer.nodeVar(node), node, enclosing, t.ap);

                }
            });
        } else {

            this.solver.fragmentState.registerEscaping(base); // unknown properties of the base object may escape
            this.solver.addAccessPath(UnknownAccessPath.instance, dst);

            // constraint: ∀ arrays t ∈ ⟦E⟧: ...
            if (dst)
                this.solver.addForAllTokensConstraint(base, TokenListener.READ_BASE_DYNAMIC, lopts, (t: Token) => {
                    if (t instanceof ArrayToken) {

                        // constraint: ...: ⟦t.p⟧ ⊆ ⟦E[i]⟧ where p is a property of t
                        this.solver.addSubsetConstraint(this.solver.varProducer.arrayAllVar(t), dst);

                        // TODO: ignoring reads from prototype chain

                    } else if (!(t instanceof AccessPathToken)) { // TODO: assuming dynamic reads from arrays only read array indices
                        if (logger.isInfoEnabled() || options.approx || options.approxLoad)
                            this.solver.fragmentState.registerUnhandledDynamicPropertyRead(node);
                    }
                });

            // TODO: PropertyAccessPaths for dynamic property reads?
        }
        // TODO: computed property assignments (with known prefix/suffix) (also handle PrivateName properties?)
        // TODO: warn at reads from ‘arguments.callee’
    }

    /**
     * Models reading a property on the object and its prototype chain.
     * The returned constraint variable holds the result of the read operation and is
     * re-used across all calls to this function for the same base and property.
     */
    readPropertyFromChain(base: ObjectPropertyVarObj, prop: string): ReadResultVar | undefined {
        if (base instanceof ArrayToken && prop === "length")
            return undefined;
        const dst = this.solver.varProducer.readResultVar(base, prop);
        if (base instanceof FunctionToken && prop === "prototype") // function objects always have 'prototype', no need to consult prototype chain
            this.readPropertyBound(base, prop, dst, {t: base, s: prop}, base);
        else {
            const nativeProperty = isNativeProperty(base, prop);
            const objProto = this.globalSpecialNatives?.get(OBJECT_PROTOTYPE);
            // constraint: ... ∀ ancestors t2 of t: ...
            this.solver.addForAllAncestorsConstraint(base, TokenListener.READ_ANCESTORS, {s: prop}, (t2: Token) => {
                if (nativeProperty && t2 !== base && t2 === objProto)
                    return; // safe to skip properties at Object.prototype that are in {base.kind}.prototype
                if (isObjectPropertyVarObj(t2))
                    this.readPropertyBound(t2, prop, dst, {t: base, s: prop}, base);
            });
        }
        return dst;
    }

    /**
     * Models reading a property of an object.
     * @param t token to read from
     * @param prop property name
     * @param dst constraint variable for the result
     * @param dstkey listener key identifying dst
     * @param thist token to use for 'this' when invoking getters
     */
    readPropertyBound(
        t: ObjectPropertyVarObj,
        prop: string,
        dst: ConstraintVar,
        dstkey: Omit<ListenerKey, "l">,
        thist: Token = t
    ) {
        const readFromGetter = (t: Token) => {
            if (t instanceof FunctionToken && t.fun.params.length === 0)
                this.solver.addSubsetConstraint(this.solver.varProducer.returnVar(t.fun), dst);
        };

        const bindGetterThis = (baset: Token, t: Token) => {
            if (t instanceof FunctionToken && t.fun.params.length === 0)
                this.solver.addTokenConstraint(this.solver.fragmentState.maybeWidened(baset), this.solver.varProducer.thisVar(t.fun));
        };

        // constraint: ... ⟦t.p⟧ ⊆ ⟦E.p⟧
        this.solver.addSubsetConstraint(this.solver.varProducer.objPropVar(t, prop), dst); // TODO: exclude AccessPathTokens?

        // constraint: ... ∀ functions t3 ∈ ⟦(get)t.p⟧: ⟦ret_t3⟧ ⊆ ⟦E.p⟧ (unless global native, [[Prototype]], "prototype", "toString", or array index)
        if (!(t instanceof NativeObjectToken && !t.moduleInfo) && prop !== INTERNAL_PROTOTYPE() && prop !== "prototype" && prop !== "toString" && !isArrayIndex(prop)) {
            const getter = this.solver.varProducer.objPropVar(t, prop, "get");
            this.solver.addForAllTokensConstraint(getter, TokenListener.READ_GETTER, dstkey,
                (t3: Token) => readFromGetter(t3));
            this.solver.addForAllTokensConstraint(getter, TokenListener.READ_GETTER_THIS, {t: thist},
                (t3: Token) => bindGetterThis(thist, t3));
        }

        if (t instanceof PackageObjectToken && t.kind === "Object") {
            // TODO: also reading from neighbor packages if t is a PackageObjectToken...
            if (options.readNeighbors)
                this.solver.addForAllPackageNeighborsConstraint(t.packageInfo, {t, s: prop}, (neighbor: PackageInfo) => { // FIXME: opts?
                    if (dst)
                        this.solver.addSubsetConstraint(this.solver.varProducer.packagePropVar(neighbor, prop), dst); // TODO: exclude AccessPathTokens?
                    if (prop !== "prototype") {
                        const nt = this.a.canonicalizeToken(new PackageObjectToken(neighbor));
                        const getter = this.solver.varProducer.packagePropVar(neighbor, prop, "get");
                        this.solver.addForAllTokensConstraint(getter, TokenListener.READ_GETTER2, dstkey,
                                                              (t3: Token) => readFromGetter(t3));
                        this.solver.addForAllTokensConstraint(getter, TokenListener.READ_GETTER_THIS2, {t: nt},
                                                              (t3: Token) => bindGetterThis(nt, t3));
                    }
                });

        } else if (t instanceof ArrayToken) {
            if (isArrayIndex(prop)) {

                // constraint: ... ⟦t.*⟧ ⊆ ⟦E.p⟧
                this.solver.addSubsetConstraint(this.solver.varProducer.arrayUnknownVar(t), dst);
            }
        }
    }

    /**
     * Models writing a property to an object.
     * @param src constraint variable representing the value to be written
     * @param lVar constraint variable for the object that is written to (for access paths)
     * @param base token representing the object that is written to
     * @param prop property name
     * @param node AST node where the operation occurs (used for constraint keys etc.)
     * @param enclosing enclosing function/module of the AST node
     * @param escapeNode AST node for 'registerEscapingToExternal' (defaults to node)
     * @param ac describes the type of property that is written to
     * @param invokeSetters if true, models invocation of setters (i.e. the [[Set]] internal method is modeled instead of [[DefineOwnProperty]])
     */
    writeProperty(
        src: ConstraintVar | undefined, lVar: ConstraintVar | undefined, base: Token, prop: string,
        node: Node, enclosing: FunctionInfo | ModuleInfo, escapeNode: Node = node,
        ac: AccessorType = "normal", invokeSetters: boolean = true,
    ) {
        const writeToSetter = (t: Token) => {
            if (t instanceof FunctionToken && t.fun.params.length === 1) {
                this.solver.addSubsetConstraint(src, this.solver.varProducer.nodeVar(t.fun.params[0]));
                this.solver.fragmentState.registerCall(node, enclosing, undefined, {accessor: true});
                this.solver.fragmentState.registerCallEdge(node, enclosing, this.a.functionInfos.get(t.fun)!, {accessor: true});
            }
        };

        const bindSetterThis = (t: Token) => {
            if (t instanceof FunctionToken && t.fun.params.length === 1)
                this.solver.addTokenConstraint(this.solver.fragmentState.maybeWidened(base), this.solver.varProducer.thisVar(t.fun));
        };

        if (isObjectPropertyVarObj(base)) {

            if (!options.nativeOverwrites && prop !== "toString" && isNativeProperty(base, prop)) {
                this.solver.fragmentState.warnUnsupported(node, `Ignoring write to native property ${base}.${prop}`);
                return;
            }

            // constraint: ...: ⟦E2⟧ ⊆ ⟦base.p⟧
            if (src)
                this.solver.addSubsetConstraint(src, this.solver.varProducer.objPropVar(base, prop, ac));

            if (invokeSetters)
                // constraint: ... ∀ ancestors anc of base: ... (unless global native, [[Prototype]], "prototype", "toString" or array index)
                if (!(base instanceof NativeObjectToken && !base.moduleInfo) && prop !== INTERNAL_PROTOTYPE() && prop !== "prototype" && prop !== "toString" && !isArrayIndex(prop))
                    this.solver.addForAllAncestorsConstraint(base, TokenListener.WRITE_ANCESTORS, {n: node, s: prop}, (anc: Token) => {
                        if (isObjectPropertyVarObj(anc)) {
                            // constraint: ...: ∀ functions t2 ∈ ⟦(set)anc.p⟧: ⟦E2⟧ ⊆ ⟦x⟧ where x is the parameter of t2
                            const setter = this.solver.varProducer.objPropVar(anc, prop, "set");
                            this.solver.addForAllTokensConstraint(setter, TokenListener.WRITE_SETTER, {n: node, s: prop}, writeToSetter);
                            this.solver.addForAllTokensConstraint(setter, TokenListener.WRITE_SETTER_THIS, {t: base}, bindSetterThis);
                        }
                    });

            // values written to native object escape
            if (base instanceof NativeObjectToken && (base.moduleInfo || base.name === "globalThis")) // TODO: other natives? packageObjectTokens?
                this.solver.fragmentState.registerEscapingToExternal(src, escapeNode, enclosing);

            // if writing to module.exports, also write to %exports.default
            if (base instanceof NativeObjectToken && base.name === "module" && prop === "exports")
                this.solver.addSubsetConstraint(src, this.solver.varProducer.objPropVar(this.moduleSpecialNatives.get("exports")!, "default", ac));

        } else if (lVar && base instanceof AccessPathToken) {
            // constraint: ...: ⟦E2⟧ ⊆ ⟦k.p⟧ where k is the current PackageObjectToken
            // if (src)
            //     this.solver.addSubsetConstraint(src, this.solver.varProducer.packagePropVar(this.packageInfo, prop));

            // collect property write operation @E1.p
            this.solver.addAccessPath(new PropertyAccessPath(lVar, prop), this.solver.varProducer.nodeVar(escapeNode), escapeNode, enclosing, base.ap);

            // values written to external objects escape
            this.solver.fragmentState.registerEscapingToExternal(src, escapeNode, enclosing);

            // TODO: the following apparently has no effect on call graph or pattern matching...
            // // constraint: assign UnknownAccessPath to arguments to function values for external functions
            // this.solver.addForAllConstraint2(eVar, TokenListener.ASSIGN_..., path.node, (at: Token) => {
            //     if (at instanceof FunctionToken) {
            //         for (let j = 0; j < at.fun.params.length; j++)
            //             if (isIdentifier(at.fun.params[j])) // TODO: non-identifier parameters?
            //                 this.solver.addAccessPath(theUnknownAccessPath, at.fun.params[j]);
            //     }
            // });
            // TODO: also add the assigned value (and everything reachable from it) to escaping?
        }
    }

    /**
     * Models 'require' and 'import'.
     * If path denotes an ExportDeclaration, no constraints are generated.
     * Returns the module info object, or undefined if not available.
     */
    requireModule(str: string, resultVar: ConstraintVar | undefined, path: NodePath): ModuleInfo | DummyModuleInfo | undefined { // see requireModule in modulefinder.ts
        const f = this.solver.fragmentState; // (don't use in callbacks)
        const reexport = isExportDeclaration(path.node);
        let m: ModuleInfo | DummyModuleInfo | undefined;
        if (Module.isBuiltin(str)) {

            if (!reexport) {
                // standard library module: model with UnknownAccessPath
                // constraint: @Unknown ∈ ⟦require(...)⟧
                this.solver.addAccessPath(UnknownAccessPath.instance, resultVar);
                // TODO: models for parts of the standard library
            } else
                f.warnUnsupported(path.node, `Ignoring re-export from built-in module '${str}'`); // TODO: re-exporting from built-in module
        } else {
            try {

                // try to locate the module
                const filepath = requireResolve(str, this.file, f.a, path.node, f);
                if (filepath) {

                    // register that the module is reached
                    m = this.a.reachedFile(filepath, false, this.moduleInfo, isLocalRequire(str));

                    // extend the require graph
                    const fp = getEnclosingFunction(path);
                    const from = fp ? this.a.functionInfos.get(fp)! : this.moduleInfo;
                    const to = this.a.moduleInfosByPath.get(filepath)!;
                    f.registerRequireEdge(from, to);

                    if (!reexport) {
                        // constraint: ⟦module_m.exports⟧ ⊆ ⟦require(...)⟧ where m denotes the module being loaded
                        this.solver.addSubsetConstraint(this.solver.varProducer.objPropVar(this.a.canonicalizeToken(new NativeObjectToken("module", m)), "exports"), resultVar);
                    }
                }
            } catch (e: any) {
                const ex = e.message ? ` (${e.message})` : "";
                if (options.ignoreUnresolved || options.ignoreDependencies) {
                    if (logger.isVerboseEnabled())
                        logger.verbose(`Ignoring unresolved module '${str}' at ${locationToStringWithFile(path.node.loc)}`);
                } else if (isInTryBlockOrBranch(path))
                    f.warn(`Unable to resolve conditionally loaded module '${str}'${ex}`, path.node);
                else if (path.isCallExpression() && !(isIdentifier(path.node.callee) && path.node.callee.name === "require"))
                    f.warn(`Unable to resolve module '${str}' at indirect require call${ex}`, path.node);
                else
                    f.error(`Unable to resolve module '${str}'${ex}`, path.node);

                // couldn't find module file (probably hasn't been installed), use a DummyModuleInfo if absolute module name
                if (!"./#".includes(str[0]))
                    m = getOrSet(this.a.dummyModuleInfos, str, () => new DummyModuleInfo(str));
            }

            if (m) {

                // add access path token
                const analyzed = m instanceof ModuleInfo && m.isIncluded;
                if (!analyzed || options.vulnerabilities) {
                    const s = normalizeModuleName(str);
                    const tracked = options.trackedModules && options.trackedModules.find(e =>
                        micromatch.isMatch(m!.getOfficialName(), e) || micromatch.isMatch(s, e));
                    this.solver.addAccessPath(tracked ? new ModuleAccessPath(m, s) : IgnoredAccessPath.instance, resultVar, path.node, this.a.getEnclosingFunctionOrModule(path));
                }

                f.registerRequireCall(path.node, this.a.getEnclosingFunctionOrModule(path), m);
            }
        }
        return m;
    }

    /**
     * Models an assignment from a constraint variable to an l-value.
     */
    assign(src: ConstraintVar | undefined, dst: LVal | ParenthesizedExpression | OptionalMemberExpression, path: NodePath) {
        const vp = this.solver.varProducer; // (don't use in callbacks)
        while (isParenthesizedExpression(dst))
            dst = dst.expression as LVal | ParenthesizedExpression | OptionalMemberExpression; // for parenthesized expressions, use the inner expression (the definition of LVal in @babel/types misses ParenthesizedExpression)
        if (isIdentifier(dst)) {

            // X = E
            // constraint: ⟦E⟧ ⊆ ⟦X⟧
            const lVar = vp.identVar(dst, path);
            this.solver.addSubsetConstraint(src, lVar);

            // if the variable has not been declared normally... (unbound set by preprocessAst)
            if (lVar instanceof NodeVar && (lVar.node.loc as Location).unbound) {

                // constraint: ⟦E⟧ ⊆ ⟦globalThis.X⟧
                this.solver.addSubsetConstraint(src, this.solver.varProducer.objPropVar(this.globalSpecialNatives.get("globalThis")!, dst.name));
            }

        } else if (isMemberExpression(dst) || isOptionalMemberExpression(dst)) {
            const e = getEnclosingFunction(path);
            const lVar = isSuper(dst.object) ? e ? this.solver.varProducer.thisVar(e) : undefined : this.expVar(dst.object, path);
            if (!lVar)
                return;
            const prop = getProperty(dst);
            const enclosing = this.a.getEnclosingFunctionOrModule(path);

            const assignRequireExtensions = (t: Token) => {
                if (t instanceof NativeObjectToken && t.name === "require.extensions")
                    // when a function is assigned to require.extensions, add an external call edge
                    this.solver.addForAllTokensConstraint(src, TokenListener.WRITE_REQUIRE_EXTENSIONS, path.node, (ft: Token) =>
                        this.invokeExternalCallback(ft, path.node, enclosing));
            };

            if (prop !== undefined) {
                // E1.prop = E2

                // constraint: ∀ objects t ∈ ⟦E1⟧: ...
                this.solver.addForAllTokensConstraint(lVar, TokenListener.WRITE_BASE, dst, (t: Token) => {
                    this.writeProperty(src, lVar, t, prop, dst, enclosing, path.node);
                    assignRequireExtensions(t);
                });

            } else {

                // E1[...] = E2
                this.solver.fragmentState.registerDynamicPropertyWrite(lVar);
                this.solver.fragmentState.registerEscaping(src);

                // constraint: ∀ arrays t ∈ ⟦E1⟧: ...
                if (src)
                    this.solver.addForAllTokensConstraint(lVar, TokenListener.WRITE_BASE_DYNAMIC, dst, (t: Token) => {
                        if (t instanceof ArrayToken) {

                            // constraint: ...: ⟦E2⟧ ⊆ ⟦t.*⟧
                            this.solver.addSubsetConstraint(src, this.solver.varProducer.arrayUnknownVar(t));

                            // TODO: write to array setters also?

                        } else if (!(t instanceof AccessPathToken)) {
                            if (logger.isInfoEnabled())
                                this.solver.fragmentState.registerUnhandledDynamicPropertyWrite(path.node, src, options.warningsUnsupported && logger.isVerboseEnabled() ? path.getSource() : undefined);
                        }

                        assignRequireExtensions(t);
                    });
                // TODO: computed property assignments (with known prefix/suffix)

                // TODO: PropertyAccessPath for dynamic property writes?
            }
            // TODO: warn at writes to properties of ‘arguments’

        } else if (isAssignmentPattern(dst))
            // delegate to dst.left (the default value dst.right is handled at AssignmentPattern)
            this.assign(src, dst.left, path);
        else if (isObjectPattern(dst)) {
            const matched = new Set<string>();
            for (const p of dst.properties)
                if (isRestElement(p)) {
                    // read the remaining object properties of src into a fresh object at p
                    const t = this.newObjectToken(p);
                    this.solver.addForAllTokensConstraint(src, TokenListener.WRITE_OBJECT_PATTERN_REST, p, (t2: Token) => {
                        if (t2 instanceof AllocationSiteToken || t2 instanceof FunctionToken || t2 instanceof NativeObjectToken || t2 instanceof PackageObjectToken) {
                            this.solver.addForAllObjectPropertiesConstraint(t2, TokenListener.WRITE_OBJECT_PATTERN_REST_PROPERTIES, p, (prop: string) => { // TODO: only copying explicit properties, not unknown computed
                                if (!matched.has(prop))
                                    this.solver.addSubsetConstraint(this.solver.varProducer.objPropVar(t2, prop), this.solver.varProducer.objPropVar(t, prop));
                                // TODO: PropertyAccessPaths for rest elements in destructuring assignments for objects?
                            });
                        }
                    });
                    this.solver.addTokenConstraint(t, vp.nodeVar(p));
                    // assign the object to the sub-l-value
                    this.assign(vp.nodeVar(p), p.argument, path);
                } else {
                    const prop = getKey(p);
                    if (prop) {
                        matched.add(prop);
                        // read the property using p for the temporary result
                        this.readProperty(src, prop, vp.nodeVar(p), p, this.a.getEnclosingFunctionOrModule(path));
                        // assign the temporary result at p to the locations represented by p.value
                        if (isLVal(p.value))
                            this.assign(vp.nodeVar(p), p.value, path);
                        else // TODO: see test262-main/test and TypeScript-main/tests/cases
                            this.solver.fragmentState.error(`Unexpected expression ${p?.value?.type}, expected LVal at ${locationToStringWithFile(p?.value?.loc)}`);
                    }
                }
        } else if (isArrayPattern(dst)) {
            for (const [i, p] of dst.elements.entries())
                if (p)
                    if (isRestElement(p)) {
                        // read the remaining array elements of src into a fresh array at p
                        const t = this.newArrayToken(p);
                        this.solver.addForAllTokensConstraint(src, TokenListener.WRITE_ARRAY_PATTERN_REST, p, (t2: Token) => {
                            if (t2 instanceof ArrayToken) {
                                this.solver.addForAllArrayEntriesConstraint(t2, TokenListener.WRITE_ARRAY_PATTERN_REST_ARRAY, p, (prop: string) => {
                                    const newprop = parseInt(prop) - i;
                                    if (newprop >= 0)
                                        this.solver.addSubsetConstraint(this.solver.varProducer.objPropVar(t2, prop), this.solver.varProducer.objPropVar(t, String(newprop)));
                                });
                                this.solver.addSubsetConstraint(this.solver.varProducer.arrayUnknownVar(t2), this.solver.varProducer.arrayUnknownVar(t));
                            } // TODO: PropertyAccessPaths for rest elements in destructuring assignments for arrays?
                        });
                        this.solver.addTokenConstraint(t, vp.nodeVar(p));
                        // assign the array to the sub-l-value
                        this.assign(vp.nodeVar(p), p.argument, path);
                    } else {
                        // read the property using p for the temporary result
                        this.readProperty(src, String(i), vp.nodeVar(p), p, this.a.getEnclosingFunctionOrModule(path));
                        // assign the temporary result at p to the locations represented by p
                        this.assign(vp.nodeVar(p), p, path);
                    }
        } else if (isTSParameterProperty(dst))
            this.assign(src, dst.parameter, path);
        else if (isTypeCastExpression(dst))
            this.assign(src, (dst as TypeCastExpression).expression as any, path);
        else if (isMetaProperty(dst))
            this.solver.fragmentState.warnUnsupported(dst, "MetaProperty"); // TODO: MetaProperty, e.g. new.target
        else if (isRestElement(dst)) {
            // assign the array generated at callFunction to the sub-l-value
            this.assign(vp.nodeVar(dst), dst.argument, path);
        } else // TODO: see test262-main/test and TypeScript-main/tests/cases
           this.solver.fragmentState.error(`Unexpected LVal type ${dst.type} at ${locationToStringWithFile(dst.loc)}`);
    }

    /**
     * Models reading an iterator value.
     * @param src source expression evaluating to iterable
     * @param dst destination constraint variable
     * @param node node used for constraint keys and array allocation site
     */
    readIteratorValue(src: ConstraintVar | undefined, dst: ConstraintVar, node: Node) {
        this.solver.addForAllTokensConstraint(src, TokenListener.READ_ITERATOR_VALUE, node, (t: Token) => {
            const vp = this.solver.varProducer;
            if (t instanceof AllocationSiteToken)
                switch (t.kind) {
                    case "Array":
                        this.solver.addSubsetConstraint(vp.arrayAllVar(t), dst);
                        break;
                    case "Set":
                        this.solver.addSubsetConstraint(vp.objPropVar(t, SET_VALUES), dst);
                        break;
                    case "Map":
                        const pair = this.newArrayToken(node);
                        this.solver.addTokenConstraint(pair, dst);
                        this.solver.addSubsetConstraint(vp.objPropVar(t, MAP_KEYS), vp.objPropVar(pair, "0"));
                        this.solver.addSubsetConstraint(vp.objPropVar(t, MAP_VALUES), vp.objPropVar(pair, "1"));
                        break;
                    case "Iterator":
                    case "Generator":
                        this.solver.addSubsetConstraint(vp.objPropVar(t, "value"), dst);
                        break;
                } // TODO: also handle TypedArray (see also nativebuilder.ts:returnIterator)
            // TODO: also handle user-defined...
        });
    }

    /**
     * Creates a new ObjectToken
     * (or, if allocation site is disabled or the token has been widened, returns the current PackageObjectToken).
     */
    newObjectToken(n: Node): ObjectToken | PackageObjectToken {
        if (options.alloc) {
            const t = this.a.canonicalizeToken(new ObjectToken(n));
            if (!options.widening || !this.solver.fragmentState.widened.has(t)) {
                this.a.patching?.registerAllocationSite(t);
                return t;
            }
        }
        return this.packageObjectToken;
    }

    /**
     * Creates a new PrototypeToken.
     */
    newPrototypeToken(fun: Function): PrototypeToken {
        const t = this.a.canonicalizeToken(new PrototypeToken(fun));
        this.a.patching?.registerAllocationSite(t);
        return t;
    }

    /**
     * Creates a new ArrayToken.
     */
    newArrayToken(n: Node): ArrayToken {
        const t = this.a.canonicalizeToken(new ArrayToken(n));
        this.a.patching?.registerAllocationSite(t);
        return t;
    }

    /**
     * Creates a new ClassToken.
     */
    newClassToken(n: Node): ClassToken { // XXX: only used if options.oldobj enabled
        return this.a.canonicalizeToken(new ClassToken(n));
    }

    /**
     * Creates a new FunctionToken.
     */
    newFunctionToken(fun: Function): FunctionToken {
        const t = this.a.canonicalizeToken(new FunctionToken(fun));
        this.a.patching?.registerAllocationSite(t);
        return t;
    }

    /**
     * Creates a PackageObjectToken of kind RegExp.
     */
    newRegExpToken(): PackageObjectToken {
        return this.a.canonicalizeToken(new PackageObjectToken(this.packageInfo, "RegExp"));
    }

    /**
     * Creates a AllocationSiteToken of kind Promise.
     */
    newPromiseToken(n: Node): AllocationSiteToken {
        return this.a.canonicalizeToken(new AllocationSiteToken("Promise", n));
    }

    /**
     * Models 'await'.
     */
    awaitPromise(arg: ConstraintVar | undefined, res: ConstraintVar | undefined, node: Node) {
        if (!arg || !res)
            return;
        this.solver.addForAllTokensConstraint(arg, TokenListener.AWAIT, node, (t: Token) => {
            if (t instanceof AllocationSiteToken && t.kind === "Promise")
                this.solver.addSubsetConstraint(this.solver.varProducer.objPropVar(t, PROMISE_FULFILLED_VALUES), res);
            else
                this.solver.addTokenConstraint(t, res);
        });
    }
}
