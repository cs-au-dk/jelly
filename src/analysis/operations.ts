import {
    CallExpression,
    Expression,
    Function,
    isArrayPattern,
    isAssignmentPattern,
    isExportDeclaration,
    isExpression,
    isIdentifier,
    isImport,
    isLVal,
    isMemberExpression,
    isObjectPattern,
    isParenthesizedExpression,
    isRestElement,
    isStringLiteral,
    JSXIdentifier,
    JSXMemberExpression,
    JSXNamespacedName,
    LVal,
    NewExpression,
    Node,
    OptionalCallExpression,
    ParenthesizedExpression
} from "@babel/types";
import {NodePath} from "@babel/traverse";
import {getKey, getProperty, isMaybeUsedAsPromise, isParentExpressionStatement} from "../misc/asthelpers";
import {
    AccessPathToken,
    AllocationSiteToken,
    ArrayToken,
    ClassToken,
    FunctionToken,
    NativeObjectToken,
    ObjectToken,
    PackageObjectToken,
    Token
} from "./tokens";
import {ArgumentsVar, ConstraintVar, IntermediateVar, NodeVar} from "./constraintvars";
import {
    CallResultAccessPath,
    IgnoredAccessPath,
    ModuleAccessPath,
    PropertyAccessPath,
    UnknownAccessPath
} from "./accesspaths";
import Solver from "./solver";
import {AnalysisState, globalLoc} from "./analysisstate";
import {DummyModuleInfo, FunctionInfo, ModuleInfo, normalizeModuleName, PackageInfo} from "./infos";
import logger from "../misc/logger";
import {requireResolve} from "../misc/files";
import {options} from "../options";
import {FilePath, getOrSet, isArrayIndex, sourceLocationToStringWithFile} from "../misc/util";
import assert from "assert";
import {
    ARRAY_PROTOTYPE,
    FUNCTION_PROTOTYPE,
    MAP_KEYS,
    MAP_VALUES,
    OBJECT_PROTOTYPE,
    PROMISE_FULFILLED_VALUES,
    PROMISE_PROTOTYPE,
    REGEXP_PROTOTYPE,
    SET_VALUES
} from "../natives/ecmascript";
import {SpecialNativeObjects} from "../natives/nativebuilder";
import {ConstraintVarProducer} from "./constraintvarproducer";
import {TokenListener} from "./listeners";
import micromatch from "micromatch";
import {callPromiseResolve} from "../natives/nativehelpers";

/**
 * Models of core JavaScript operations used by astvisitor and nativehelpers.
 */
export class Operations {

    readonly file: FilePath;

    readonly solver: Solver;

    readonly natives: SpecialNativeObjects

    readonly a: AnalysisState; // shortcut to this.solver.analysisState

    readonly varProducer: ConstraintVarProducer; // shortcut to this.solver.analysisState.varProducer

    readonly moduleInfo: ModuleInfo;

    readonly packageInfo: PackageInfo;

    readonly packageObjectToken: PackageObjectToken;

    readonly exportsObjectToken: NativeObjectToken;

    constructor(file: FilePath, solver: Solver, natives: SpecialNativeObjects) {
        this.file = file;
        this.solver = solver;
        this.natives = natives;

        this.a = this.solver.analysisState;
        this.varProducer = this.a.varProducer;

        this.moduleInfo = this.a.getModuleInfo(file);
        this.packageInfo = this.moduleInfo.packageInfo;
        this.packageObjectToken = this.a.canonicalizeToken(new PackageObjectToken(this.packageInfo));
        this.exportsObjectToken = this.a.canonicalizeToken(new NativeObjectToken("exports", this.moduleInfo));
    }

    /**
     * Finds the constraint variable for the given expression in the current module using ConstraintVarProducer.expVar.
     * Also adds @Unknown and a subset constraint for globalThis.E if the given expression E is an implicitly declared global variable.
     */
    expVar(exp: Expression | JSXIdentifier | JSXMemberExpression | JSXNamespacedName, path: NodePath): ConstraintVar | undefined {
        const v = this.varProducer.expVar(exp, path);

        // if the expression is a variable that has not been declared normally...
        if (v instanceof NodeVar && isIdentifier(v.node) && v.node.loc === globalLoc) {

            // the variable may be a property of globalThis
            // constraint: globalThis.X ∈ ⟦X⟧
            this.solver.addSubsetConstraint(this.varProducer.objPropVar(this.natives.get("globalThis")!, v.node.name), v);

            // the variable may be declared explicitly by unknown code
            // constraint: @Unknown ∈ ⟦X⟧
            this.solver.addAccessPath(UnknownAccessPath.instance, v);
        }
        return v;
    }

    /**
     * Models calling a function.
     * @param calleeVar constraint variable describing the callee, undefined if not applicable
     * @param baseVar constraint variable describing the method call base, undefined if not applicable
     * @param args arguments array of arguments
     * @param resultVar constraint variable describing the call result, undefined if not applicable
     * @param isNew true if this is a 'new' call
     * @param path path of the call expression
     */
    callFunction(calleeVar: ConstraintVar | undefined, baseVar: ConstraintVar | undefined, args: CallExpression["arguments"],
                 resultVar: ConstraintVar | undefined, isNew: boolean, path: NodePath<CallExpression | OptionalCallExpression | NewExpression>) {
        const caller = this.a.getEnclosingFunctionOrModule(path, this.moduleInfo);
        let pars: NodePath = path; // (workaround to match dyn.ts which has wrong source location for calls in parenthesized expressions)
        while (isParenthesizedExpression(pars.parentPath!.node))
            pars = pars.parentPath!;
        this.a.registerCall(pars.node, this.moduleInfo);

        // collect special information for pattern matcher
        if (isParentExpressionStatement(pars))
            this.a.registerCallWithUnusedResult(path.node);
        if (isMaybeUsedAsPromise(path))
            this.a.registerCallWithResultMaybeUsedAsPromise(path.node);
        this.a.registerInvokedExpression(path.node.callee);

        const a = this.a;
        function* getStrings(exp: Expression | any): Iterable<string> {
            if (isStringLiteral(exp))
                yield exp.value;
            else // TODO: currently supporting only string literals at 'require' and 'import'
                a.warnUnsupported(path.node, "Unhandled 'require'", true);
        }

        // expression E0(E1,...,En) or new E0(E1,...,En)
        // constraint: ∀ functions t ∈ ⟦E0⟧: ...
        this.solver.addForAllConstraint(calleeVar, TokenListener.CALL_FUNCTION_CALLEE, path.node, (t: Token) => {
            if (t instanceof FunctionToken) {
                this.a.registerCallEdge(pars.node, caller, this.a.functionInfos.get(t.fun)!);
                if (t.moduleInfo !== this.moduleInfo)
                    this.a.registerEscapingArguments(args, path);
                const hasArguments = this.a.functionsWithArguments.has(t.fun);
                const argumentsToken = hasArguments ? this.a.canonicalizeToken(new ArrayToken(t.fun.body, this.packageInfo)) : undefined;
                for (let i = 0; i < args.length; i++) {
                    const arg = args[i];
                    // constraint: ...: ⟦Ei⟧ ⊆ ⟦Xi⟧ for each argument/parameter i (Xi may be a pattern)
                    if (isExpression(arg)) {
                        const argVar = this.expVar(arg, path);
                        if (i < t.fun.params.length) {
                            const param = t.fun.params[i];
                            if (isRestElement(param)) {
                                // read the remaining arguments into a fresh array
                                const rest = args.slice(i);
                                const t = this.newArrayToken(param);
                                for (const [i, arg] of rest.entries())
                                    if (isExpression(arg)) // TODO: SpreadElement in arguments (warning emitted below)
                                        this.solver.addSubsetConstraint(this.expVar(arg, path), this.varProducer.objPropVar(t, String(i)));
                                this.solver.addTokenConstraint(t, this.a.varProducer.nodeVar(param));
                            } else
                                this.solver.addSubsetConstraint(argVar, this.varProducer.nodeVar(param));
                        }
                        // constraint ...: ⟦Ei⟧ ⊆ ⟦t_arguments[i]⟧ for each argument i if the function uses 'arguments'
                        if (hasArguments)
                            this.solver.addSubsetConstraint(argVar, this.varProducer.objPropVar(argumentsToken!, String(i)));
                    } else if (arg)
                        this.a.warnUnsupported(arg, "SpreadElement in arguments", true); // TODO: SpreadElement in arguments
                }
                // constraint: ...: ⟦ret_t⟧ ⊆ ⟦(new) E0(E1,...,En)⟧
                if (!isParentExpressionStatement(pars))
                    this.solver.addSubsetConstraint(this.varProducer.returnVar(t.fun), resultVar);
                // constraint: ...: t_arguments ∈ ⟦t_arguments⟧ if the function uses 'arguments'
                if (hasArguments) {
                    const argumentsVar = this.a.canonicalizeVar(new ArgumentsVar(t.fun));
                    this.solver.addTokenConstraint(argumentsToken!, argumentsVar);
                }

            } else if (t instanceof NativeObjectToken) {
                this.a.registerCall(pars.node, this.moduleInfo, {native: true});
                if (t.invoke && (!isNew || t.constr))
                    t.invoke({path, solver: this.solver, op: this, moduleInfo: this.moduleInfo, natives: this.natives});

                if (t.name === "require" && args.length >= 1) {

                    // require(...)
                    for (const str of getStrings(args[0]))
                        this.requireModule(str, resultVar, path);
                }

            } else if (t instanceof AllocationSiteToken && (t.kind === "PromiseResolve" || t.kind === "PromiseReject") && !isNew) {
                callPromiseResolve(t, args, path, this);

            } else if (t instanceof AccessPathToken) {
                assert(calleeVar);
                this.a.registerCall(pars.node, this.moduleInfo, {external: true});
                this.a.registerEscapingArguments(args, path);

                // constraint: add CallResultAccessPath
                this.solver.addAccessPath(this.a.canonicalizeAccessPath(new CallResultAccessPath(calleeVar)), resultVar, t.ap);

                // constraint: assign UnknownAccessPath to arguments to function arguments for external functions, also add (artificial) call edge
                for (let i = 0; i < args.length; i++) {
                    const arg = args[i];
                    if (isExpression(arg))
                        this.solver.addForAllConstraint(this.expVar(arg, path), TokenListener.CALL_FUNCTION_EXTERNAL, arg, (at: Token) => {
                            if (at instanceof FunctionToken) {
                                this.a.registerCallEdge(pars.node, caller, this.a.functionInfos.get(at.fun)!, {external: true});
                                for (let j = 0; j < at.fun.params.length; j++)
                                    if (isIdentifier(at.fun.params[j])) // TODO: non-identifier parameters?
                                        this.solver.addAccessPath(UnknownAccessPath.instance, this.a.varProducer.nodeVar(at.fun.params[j]));
                            }
                        });
                    else
                        this.a.warnUnsupported(arg, "SpreadElement in arguments to external function"); // TODO: SpreadElement in arguments to external function
                }
                // TODO: also add arguments (and everything reachable from them) to escaping?
                // TODO: also add UnknownAccessPath to properties of object arguments for external functions? (see also TODO at AssignmentExpression)

                // TODO: if caller is MemberExpression with property 'apply', 'call' or 'bind', treat as call to the native function of that name (relevant for lodash/atomizer TAPIR benchmark)
            }

            // if 'new' and not a native object with an invoke function and not an access path token...
            if (isNew && (!(t instanceof NativeObjectToken) || !t.invoke) && !(t instanceof AccessPathToken)) {

                // constraint: t ∈ ⟦new E0(E1,...,En)⟧ where t is the current PackageObjectToken
                this.solver.addTokenConstraint(this.packageObjectToken, resultVar); // TODO: use allocation-site abstraction for 'new'?
            }
        });

        // constraint: if E0 is a member expression E.m: ∀ t ∈ ⟦E⟧, functions f ∈ ⟦E0⟧: if f uses 'this'...
        this.solver.addForAllConstraint(calleeVar, TokenListener.CALL_FUNCTION_BASE_CALLEE, path.node, (ft: Token) => {
            if (ft instanceof FunctionToken && this.a.functionsWithThis.has(ft.fun))

                // constraint: ... ⟦E⟧ ⊆ ⟦this_f⟧
                this.solver.addSubsetConstraint(baseVar, this.varProducer.thisVar(ft.fun)); // TODO: introduce special subset edge that only propagates FunctionToken and AllocationSiteToken?
        });

        // 'import' expression
        if (calleeVar instanceof NodeVar && isImport(calleeVar.node) && args.length >= 1) {
            const v = this.a.canonicalizeVar(new IntermediateVar(path.node, "import"));
            for (const str of getStrings(args[0]))
                this.requireModule(str, v, path);
            const promise = this.newPromiseToken(path.node);
            this.solver.addTokenConstraint(promise, this.expVar(path.node, path));
            this.solver.addSubsetConstraint(v, this.varProducer.objPropVar(promise, PROMISE_FULFILLED_VALUES));
        }
    }

    /**
     * Models reading a property of an object.
     * @param base constraint variable representing the base variable
     * @param prop property name, undefined if unknown
     * @param dst constraint variable for the result, or undefined if not applicable
     * @param node AST node where the operation occurs (used for constraint keys etc.)
     * @param enclosing enclosing function/module of the AST node
     */
    readProperty(base: ConstraintVar | undefined, prop: string | undefined, dst: ConstraintVar | undefined, node: Node, enclosing: FunctionInfo | ModuleInfo) {
        this.solver.collectPropertyRead(dst, base, this.packageObjectToken);

        // expression E.p or E["p"] or E[i]
        if (prop !== undefined) {

            const readFromGetter = (t: Token) => {
                if (t instanceof FunctionToken && t.fun.params.length === 0) {
                    if (dst)
                        this.solver.addSubsetConstraint(this.varProducer.returnVar(t.fun), dst);
                    if (base && this.a.functionsWithThis.has(t.fun))
                        this.solver.addSubsetConstraint(base, this.varProducer.thisVar(t.fun));
                    this.a.registerCall(node, this.moduleInfo, {accessor: true});
                    this.a.registerCallEdge(node, enclosing, this.a.functionInfos.get(t.fun)!, {accessor: true});
                }
            }

            // constraint: ∀ objects t ∈ ⟦E⟧: ...
            this.solver.addForAllConstraint(base, TokenListener.READ_PROPERTY_BASE, node, (t: Token) => {

                // constraint: ... ∀ ancestors t2 of t: ...
                this.solver.addForAllAncestorsConstraint(t, node, (t2: Token) => {

                    if (t2 instanceof AllocationSiteToken || t2 instanceof FunctionToken || t2 instanceof NativeObjectToken || t2 instanceof PackageObjectToken) {

                        // constraint: ... ⟦t2.p⟧ ⊆ ⟦E.p⟧
                        if (dst)
                            this.solver.addSubsetConstraint(this.varProducer.objPropVar(t2, prop), dst); // TODO: exclude AccessPathTokens?

                        // constraint: ... ∀ functions t3 ∈ ⟦(get)t2.p⟧: ⟦ret_t3⟧ ⊆ ⟦E.p⟧
                        this.solver.addForAllConstraint(this.varProducer.objPropVar(t2, prop, "get"), TokenListener.READ_PROPERTY_GETTER, node, readFromGetter);

                        if (t2 instanceof PackageObjectToken) {
                            // TODO: also reading from neighbor packages if t2 is a PackageObjectToken...
                            this.solver.addForAllPackageNeighborsConstraint(t2.packageInfo, node, (neighbor: PackageInfo) => {
                                if (dst)
                                    this.solver.addSubsetConstraint(this.varProducer.packagePropVar(neighbor, prop), dst); // TODO: exclude AccessPathTokens?
                                this.solver.addForAllConstraint(this.varProducer.packagePropVar(neighbor, prop, "get"), TokenListener.READ_PROPERTY_GETTER2, node, readFromGetter);
                            });

                        } else if (t2 instanceof ArrayToken) {
                            if (isArrayIndex(prop)) {

                                // constraint: ... ⟦t2.*⟧ ⊆ ⟦E.p⟧
                                this.solver.addSubsetConstraint(this.varProducer.arrayValueVar(t2), dst);
                            }
                        }

                    } else if (base && t2 instanceof AccessPathToken) {

                        // constraint: ... if t2 is access path, @E.p ∈ ⟦E.p⟧
                        this.solver.addAccessPath(this.a.canonicalizeAccessPath(new PropertyAccessPath(base, prop)), this.a.varProducer.nodeVar(node), t2.ap);
                    }
                });

                if (t instanceof FunctionToken && prop === "prototype") { // FIXME: also model reads from "__proto__"

                    // constraint: ... p="prototype" ∧ t is a function ⇒ k ∈ ⟦E.p⟧ where k represents the package
                    if (dst)
                        this.solver.addTokenConstraint(this.packageObjectToken, dst); // FIXME: use special prototype objects instead of PackageObjectToken!
                }
            });

        } else { // TODO: handle dynamic property reads?

            this.a.registerEscaping(base); // unknown properties of the base object may escape
            this.solver.addAccessPath(UnknownAccessPath.instance, dst);

            // constraint: ∀ arrays t ∈ ⟦E⟧: ...
            if (dst)
                this.solver.addForAllConstraint(base, TokenListener.READ_PROPERTY_BASE_DYNAMIC, node, (t: Token) => {
                    if (t instanceof ArrayToken) {

                        // constraint: ... ⟦t.*⟧ ⊆ ⟦E[i]⟧
                        this.solver.addSubsetConstraint(this.varProducer.arrayValueVar(t), dst);

                        // constraint: ...: ⟦t.p⟧ ⊆ ⟦E[i]⟧ where p is a property of t
                        this.solver.addForAllArrayEntriesConstraint(t, TokenListener.READ_PROPERTY_BASE_DYNAMIC_ARRAY, node, (prop: string) => {
                            this.solver.addSubsetConstraint(this.varProducer.objPropVar(t, prop), dst);
                        });
                        // TODO: ignoring reads from prototype chain

                    } else { // TODO: assuming dynamic reads from arrays only read array indices
                        if (logger.isInfoEnabled())
                            this.a.registerUnhandledDynamicPropertyRead(node);
                    }
                });

            // TODO: PropertyAccessPaths for dynamic property reads?
        }
        // TODO: special treatment for E.prototype? and other standard properties?
        // TODO: computed property assignments (with known prefix/suffix) (also handle PrivateName properties?)
        // TODO: warn at reads from ‘arguments.callee’
    }

    /**
     * Models 'require' and 'import'.
     * If path denotes an ExportDeclaration, no constraints are generated.
     * Returns the module info object, or undefined if not available.
     */
    requireModule(str: string, resultVar: ConstraintVar | undefined, path: NodePath): ModuleInfo | DummyModuleInfo | undefined { // see requireModule in modulefinder.ts
        const reexport = isExportDeclaration(path.node);
        let m: ModuleInfo | DummyModuleInfo | undefined;
        try {

            // try to locate the module
            const filepath = requireResolve(str, this.file, path.node.loc, this.a);
            if (filepath) {

                // register that the module is reached
                m = this.a.reachedFile(filepath, path.getFunctionParent()?.node ?? this.file);

                if (!reexport) {
                    // constraint: ⟦module_m.exports⟧ ⊆ ⟦require(...)⟧ where m denotes the module being loaded
                    this.solver.addSubsetConstraint(this.varProducer.objPropVar(this.a.canonicalizeToken(new NativeObjectToken("module", m)), "exports"), resultVar);
                }
            }
        } catch {
            if (options.ignoreUnresolved || options.ignoreDependencies) {
                if (logger.isVerboseEnabled())
                    logger.verbose(`Ignoring unresolved module '${str}' at ${sourceLocationToStringWithFile(path.node.loc)}`);
            } else // TODO: special warning if the require/import is placed in a try-block, an if statement, or a switch case?
                this.a.warn(`Unable to resolve module '${str}' at ${sourceLocationToStringWithFile(path.node.loc)}`); // TODO: may report duplicate error messages

            // couldn't find module file (probably hasn't been installed), use a DummyModuleInfo if absolute module name
            if (!"./#".includes(str[0]))
                m = getOrSet(this.a.dummyModuleInfos, str, () => new DummyModuleInfo(str));
        }

        if (m) {

            // add access path token
            const analyzed = m instanceof ModuleInfo && (!options.ignoreDependencies || this.a.entryFiles.has(m.path));
            if (!analyzed || options.vulnerabilities) {
                const s = normalizeModuleName(str);
                const tracked = options.trackedModules && options.trackedModules.find(e =>
                    micromatch.isMatch(m!.getOfficialName(), e) || micromatch.isMatch(s, e))
                this.solver.addAccessPath(tracked ?
                        this.a.canonicalizeAccessPath(new ModuleAccessPath(m, s)) :
                        IgnoredAccessPath.instance,
                    resultVar);
            }

            this.a.registerRequireCall(path.node, this.a.getEnclosingFunctionOrModule(path, this.moduleInfo), m);
        }

        return m;
    }

    /**
     * Models an assignment from a constraint variable to an l-value.
     */
    assign(src: ConstraintVar | undefined, dst: LVal | ParenthesizedExpression, path: NodePath) {
        while (isParenthesizedExpression(dst))
            dst = dst.expression as LVal | ParenthesizedExpression; // for parenthesized expressions, use the inner expression (the definition of LVal in @babel/types misses ParenthesizedExpression)
        if (isIdentifier(dst)) {

            // X = E
            // constraint: ⟦E⟧ ⊆ ⟦X⟧
            const lVar = this.varProducer.identVar(dst, path);
            this.solver.addSubsetConstraint(src, lVar);

        } else if (isMemberExpression(dst)) {
            const lVar = this.expVar(dst.object, path);
            const prop = getProperty(dst);
            if (prop !== undefined) {

                // E1.p = E2

                const writeToSetter = (t: Token) => {
                    if (t instanceof FunctionToken && t.fun.params.length === 1) {
                        this.solver.addSubsetConstraint(src, this.varProducer.nodeVar(t.fun.params[0]));
                        if (this.a.functionsWithThis.has(t.fun))
                            this.solver.addSubsetConstraint(lVar, this.varProducer.thisVar(t.fun));
                        this.a.registerCall(path.node, this.moduleInfo, {accessor: true});
                        this.a.registerCallEdge(path.node, this.a.getEnclosingFunctionOrModule(path, this.moduleInfo), this.a.functionInfos.get(t.fun)!, {accessor: true});
                    }
                }

                // constraint: ∀ objects t ∈ ⟦E1⟧: ...
                this.solver.addForAllConstraint(lVar, TokenListener.ASSIGN_MEMBER_BASE, path.node, (t: Token) => {
                    if (t instanceof AllocationSiteToken || t instanceof FunctionToken || t instanceof NativeObjectToken || t instanceof PackageObjectToken) {

                        // FIXME: special treatment of writes to "prototype" and "__proto__"

                        // constraint: ...: ⟦E2⟧ ⊆ ⟦t.p⟧
                        this.solver.addSubsetConstraint(src, this.varProducer.objPropVar(t, prop));

                        // constraint: ...: ∀ functions t2 ∈ ⟦(set)t.p⟧: ⟦E2⟧ ⊆ ⟦x⟧ where x is the parameter of t2
                        this.solver.addForAllConstraint(this.varProducer.objPropVar(t, prop, "set"), TokenListener.ASSIGN_SETTER, path.node, writeToSetter);

                    } else if (lVar && t instanceof AccessPathToken) {

                        // constraint: ...: ⟦E2⟧ ⊆ ⟦k.p⟧ where k is the current PackageObjectToken
                        this.solver.addSubsetConstraint(src, this.varProducer.packagePropVar(this.packageInfo, prop));

                        // collect property write operation @E1.p
                        this.solver.addAccessPath(this.a.canonicalizeAccessPath(new PropertyAccessPath(lVar, prop)), this.a.varProducer.nodeVar(path.node), t.ap);

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
                });

                // TODO: special treatment for E.prototype? and other standard properties?

            } else {

                // E1[...] = E2
                this.solver.collectDynamicPropertyWrite(lVar);
                this.a.registerEscaping(src);

                // constraint: ∀ arrays t ∈ ⟦E1⟧: ...
                this.solver.addForAllConstraint(lVar, TokenListener.ASSIGN_DYNAMIC_BASE, path.node, (t: Token) => {
                    if (t instanceof ArrayToken) {

                        // constraint: ...: ⟦E2⟧ ⊆ ⟦t.*⟧
                        this.solver.addSubsetConstraint(src, this.varProducer.arrayValueVar(t));

                        // TODO: write to array setters also?

                    } else {
                        if (logger.isInfoEnabled() && src)
                            this.a.registerUnhandledDynamicPropertyWrite(path.node, src, options.warningsUnsupported && logger.isVerboseEnabled() ? path.getSource() : undefined);
                    }
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
                    this.solver.addForAllConstraint(src, TokenListener.ASSIGN_OBJECT_PATTERN_REST, p, (t2: Token) => {
                        if (t2 instanceof AllocationSiteToken || t2 instanceof FunctionToken || t2 instanceof NativeObjectToken || t2 instanceof PackageObjectToken) {
                            this.solver.addForAllObjectPropertiesConstraint(t2, TokenListener.ASSIGN_OBJECT_PATTERN_REST_PROPERTIES, p, (prop: string) => { // TODO: only copying explicit properties, not unknown computed
                                if (!matched.has(prop))
                                    this.solver.addSubsetConstraint(this.varProducer.objPropVar(t2, prop), this.varProducer.objPropVar(t, prop));
                                // TODO: PropertyAccessPaths for rest elements in destructuring assignments for objects?
                            });
                        }
                    });
                    this.solver.addTokenConstraint(t, this.a.varProducer.nodeVar(p));
                    // assign the object to the sub-l-value
                    this.assign(this.a.varProducer.nodeVar(p), p.argument, path);
                } else {
                    const prop = getKey(p);
                    if (prop) {
                        matched.add(prop);
                        // read the property using p for the temporary result
                        this.readProperty(src, prop, this.a.varProducer.nodeVar(p), p, this.a.getEnclosingFunctionOrModule(path, this.moduleInfo));
                        // assign the temporary result at p to the locations represented by p.value
                        if (!isLVal(p.value))
                            assert.fail(`Unexpected expression ${p.value.type}, expected LVal at ${sourceLocationToStringWithFile(p.value.loc)}`);
                        this.assign(this.a.varProducer.nodeVar(p), p.value, path);
                    }
                }
        } else if (isArrayPattern(dst)) {
            for (const [i, p] of dst.elements.entries())
                if (p)
                    if (isRestElement(p)) {
                        // read the remaining array elements of src into a fresh array at p
                        const t = this.newArrayToken(p);
                        this.solver.addForAllConstraint(src, TokenListener.ASSIGN_ARRAY_PATTERN_REST, p, (t2: Token) => {
                            if (t2 instanceof ArrayToken) {
                                this.solver.addForAllArrayEntriesConstraint(t2, TokenListener.ASSIGN_ARRAY_PATTERN_REST_ARRAY, p, (prop: string) => {
                                    const newprop = parseInt(prop) - i;
                                    if (newprop >= 0)
                                        this.solver.addSubsetConstraint(this.varProducer.objPropVar(t2, prop), this.varProducer.objPropVar(t, String(newprop)));
                                });
                                this.solver.addSubsetConstraint(this.varProducer.arrayValueVar(t2), this.varProducer.arrayValueVar(t));
                            } // TODO: PropertyAccessPaths for rest elements in destructuring assignments for arrays?
                        });
                        this.solver.addTokenConstraint(t, this.a.varProducer.nodeVar(p));
                        // assign the array to the sub-l-value
                        this.assign(this.a.varProducer.nodeVar(p), p.argument, path);
                    } else {
                        // read the property using p for the temporary result
                        this.readProperty(src, String(i), this.a.varProducer.nodeVar(p), p, this.a.getEnclosingFunctionOrModule(path, this.moduleInfo));
                        // assign the temporary result at p to the locations represented by p
                        this.assign(this.a.varProducer.nodeVar(p), p, path);
                    }
        } else {
            if (!isRestElement(dst))
                assert.fail(`Unexpected LVal type ${dst.type} at ${sourceLocationToStringWithFile(dst.loc)}`);
            // assign the array generated at callFunction to the sub-l-value
            this.assign(this.a.varProducer.nodeVar(dst), dst.argument, path);
        }
    }

    /**
     * Models reading an iterator value.
     * @param src source expression evaluating to iterable
     * @param dst destination constraint variable
     * @param node node used for constraint keys and array allocation site
     */
    readIteratorValue(src: ConstraintVar | undefined, dst: ConstraintVar, node: Node) {
        this.solver.addForAllConstraint(src, TokenListener.READ_ITERATOR_VALUE, node, (t: Token) => {
            if (t instanceof AllocationSiteToken)
                switch (t.kind) {
                    case "Array":
                        this.solver.addSubsetConstraint(this.varProducer.arrayValueVar(t), dst);
                        this.solver.addForAllArrayEntriesConstraint(t, TokenListener.READ_ITERATOR_VALUE_ARRAY, node, (prop: string) => {
                            this.solver.addSubsetConstraint(this.varProducer.objPropVar(t, prop), dst);
                        });
                        break;
                    case "Set":
                        this.solver.addSubsetConstraint(this.varProducer.objPropVar(t, SET_VALUES), dst);
                        break;
                    case "Map":
                        const pair = this.newArrayToken(node);
                        this.solver.addTokenConstraint(pair, dst);
                        this.solver.addSubsetConstraint(this.varProducer.objPropVar(t, MAP_KEYS), this.varProducer.objPropVar(pair, "0"));
                        this.solver.addSubsetConstraint(this.varProducer.objPropVar(t, MAP_VALUES), this.varProducer.objPropVar(pair, "1"));
                        break;
                    case "Iterator":
                        this.solver.addSubsetConstraint(this.varProducer.objPropVar(t, "value"), dst);
                        break;
                } // TODO: also handle TypedArray (see also nativebuilder.ts:returnIterator)
            // TODO: also handle user-defined...
        });
    }

    /**
     * Creates a new ObjectToken that inherits from Object.prototype
     * (or, if allocation site is disabled or the token has been widened, returns the current PackageObjectToken).
     */
    newObjectToken(n: Node): ObjectToken | PackageObjectToken {
        if (options.alloc) {
            const t = this.a.canonicalizeToken(new ObjectToken(n, this.packageInfo));
            if (!(this.a.widened && this.a.widened.has(t))) {
                this.solver.addInherits(t, this.natives.get(OBJECT_PROTOTYPE)!);
                return t;
            }
        }
        return this.packageObjectToken;
    }

    /**
     * Creates a new ArrayToken that inherits from Array.prototype.
     */
    newArrayToken(n: Node): ArrayToken {
        const t = this.a.canonicalizeToken(new ArrayToken(n, this.packageInfo));
        this.solver.addInherits(t, this.natives.get(ARRAY_PROTOTYPE)!);
        return t;
    }

    /**
     * Creates a new ClassToken that inherits from Function.prototype.
     */
    newClassToken(n: Node): ClassToken {
        const t = this.a.canonicalizeToken(new ClassToken(n, this.packageInfo));
        this.solver.addInherits(t, this.natives.get(FUNCTION_PROTOTYPE)!);
        return t;
    }

    /**
     * Creates a new FunctionToken that inherits from Function.prototype.
     */
    newFunctionToken(fun: Function): FunctionToken {
        const t = this.a.canonicalizeToken(new FunctionToken(fun, this.moduleInfo));
        this.solver.addInherits(t, this.natives.get(FUNCTION_PROTOTYPE)!);
        return t;
    }

    /**
     * Creates a PackageObjectToken of kind RegExp that inherits from RegExp.prototype.
     */
    newRegExpToken(): PackageObjectToken {
        const t = this.a.canonicalizeToken(new PackageObjectToken(this.packageInfo, "RegExp"));
        this.solver.addInherits(t, this.natives.get(REGEXP_PROTOTYPE)!);
        return t;
    }

    /**
     * Creates a AllocationSiteToken of kind Promise that inherits from Promise.prototype.
     */
    newPromiseToken(n: Node): AllocationSiteToken {
        const t = this.a.canonicalizeToken(new AllocationSiteToken("Promise", n, this.packageInfo));
        this.solver.addInherits(t, this.natives.get(PROMISE_PROTOTYPE)!);
        return t;
    }

    /**
     * Models 'await'.
     */
    awaitPromise(arg: ConstraintVar | undefined, res: ConstraintVar | undefined, node: Node) {
        if (!arg || !res)
            return;
        this.solver.addForAllConstraint(arg, TokenListener.AWAIT, node, (t: Token) => {
            if (t instanceof AllocationSiteToken && t.kind === "Promise")
                this.solver.addSubsetConstraint(this.varProducer.objPropVar(t, PROMISE_FULFILLED_VALUES), res);
            else
                this.solver.addTokenConstraint(t, res);
        });
    }
}
