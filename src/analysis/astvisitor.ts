import traverse, {NodePath} from "@babel/traverse";
import {
    ArrayExpression,
    ArrowFunctionExpression,
    AssignmentExpression,
    AssignmentPattern,
    AwaitExpression,
    CallExpression,
    Class,
    ClassAccessorProperty,
    ClassDeclaration,
    ClassExpression,
    ClassMethod,
    ClassPrivateMethod,
    ClassPrivateProperty,
    ClassProperty,
    ConditionalExpression,
    ExportAllDeclaration,
    ExportDefaultDeclaration,
    ExportNamedDeclaration,
    File,
    ForOfStatement,
    Function,
    FunctionDeclaration,
    FunctionExpression,
    Identifier,
    ImportDeclaration,
    isArrayPattern,
    isArrowFunctionExpression,
    isAssignmentExpression,
    isAssignmentPattern,
    isCallExpression,
    isClassAccessorProperty,
    isClassExpression,
    isClassMethod,
    isClassPrivateMethod,
    isClassPrivateProperty,
    isClassProperty,
    isDeclaration,
    isExportDeclaration,
    isExportDefaultDeclaration,
    isExportDefaultSpecifier,
    isExportNamedDeclaration,
    isExpression,
    isFunction,
    isFunctionDeclaration,
    isFunctionExpression,
    isIdentifier,
    isImportDefaultSpecifier,
    isImportSpecifier,
    isLVal,
    isObjectMethod,
    isObjectPattern,
    isObjectProperty,
    isPattern,
    isRestElement,
    isSpreadElement,
    isStaticBlock,
    isVariableDeclaration,
    JSXElement,
    JSXMemberExpression,
    LogicalExpression,
    LVal,
    MemberExpression,
    NewExpression,
    ObjectExpression,
    ObjectMethod,
    ObjectProperty,
    OptionalCallExpression,
    OptionalMemberExpression,
    RegExpLiteral,
    ReturnStatement,
    SequenceExpression,
    StaticBlock,
    Super,
    TaggedTemplateExpression,
    ThisExpression,
    ThrowStatement,
    VariableDeclarator,
    WithStatement,
    YieldExpression
} from "@babel/types";
import {
    AccessPathToken,
    AllocationSiteToken,
    ClassToken,
    FunctionToken,
    NativeObjectToken,
    ObjectToken,
    PackageObjectToken,
    Token
} from "./tokens";
import {ModuleInfo} from "./infos";
import logger from "../misc/logger";
import {locationToStringWithFile, mapArrayAdd} from "../misc/util";
import assert from "assert";
import {options} from "../options";
import {PropertyAccessPath} from "./accesspaths";
import {ConstraintVar, isObjectPropertyVarObj} from "./constraintvars";
import {
    getClass,
    getEnclosingNonArrowFunction,
    getExportName,
    getImportName,
    getKey,
    getProperty,
    isCalleeExpression,
    isParentExpressionStatement,
    registerArtificialClassPropertyInitializer,
} from "../misc/asthelpers";
import {
    ARRAY_UNKNOWN,
    ASYNC_GENERATOR_PROTOTYPE_NEXT,
    ASYNC_GENERATOR_PROTOTYPE_RETURN,
    ASYNC_GENERATOR_PROTOTYPE_THROW,
    GENERATOR_PROTOTYPE_NEXT,
    GENERATOR_PROTOTYPE_RETURN,
    GENERATOR_PROTOTYPE_THROW,
    INTERNAL_PROTOTYPE,
    PROMISE_FULFILLED_VALUES
} from "../natives/ecmascript";
import {Operations} from "./operations";
import {TokenListener} from "./listeners";
import {JELLY_NODE_ID} from "../parsing/extras";

export const IDENTIFIER_KIND = Symbol();

export function visit(ast: File, op: Operations) {
    const solver = op.solver;
    const a = solver.globalState;
    const f = solver.fragmentState; // (don't use in callbacks)
    const vp = f.varProducer; // (don't use in callbacks)
    const class2constructor = new Map<Class, ClassMethod>();

    // traverse the AST and extend the analysis result with information about the current module
    if (logger.isVerboseEnabled())
        logger.verbose(`Traversing AST of ${op.file}`);
    traverse(ast, {

        ThisExpression(path: NodePath<ThisExpression>) {

            // this
            const encl = path.findParent((p: NodePath) =>
                isFunction(p.node) || isStaticBlock(p.node) || isClassProperty(p.node) || isClassPrivateProperty(p.node));
            if (encl && (isStaticBlock(encl.node) || ((isClassProperty(encl.node) || isClassPrivateProperty(encl.node)) && encl.node.static))) {
                // in static block or static field initializer
                // constraint: c ∈ ⟦this⟧ where c is the constructor of the enclosing class
                const cls = encl.parentPath?.parentPath?.node as Class;
                assert(cls);
                const constr = class2constructor.get(cls);
                assert(constr);
                solver.addTokenConstraint(op.newFunctionToken(constr), vp.nodeVar(path.node));
            } else {
                const fun = getEnclosingNonArrowFunction(path);
                if (fun) {
                    // in constructor or method
                    // constraint: ⟦this_f⟧ ⊆ ⟦this⟧ where f is the enclosing function (excluding arrow functions)
                    solver.addSubsetConstraint(vp.thisVar(fun), vp.nodeVar(path.node));
                } else {
                    // constraint %globalThis ∈ ⟦this⟧
                    solver.addTokenConstraint(op.globalSpecialNatives.get("globalThis")!, vp.nodeVar(path.node));
                }
            }
            if (options.oldobj) {
                // constraint: t ∈ ⟦this⟧ where t denotes the package
                solver.addTokenConstraint(op.packageObjectToken, vp.nodeVar(path.node));
            }
        },

        Super(path: NodePath<Super>) {

            // super
            const encl = path.findParent((p: NodePath) =>
                isFunction(p.node) || isStaticBlock(p.node) || isClassProperty(p.node) || isClassPrivateProperty(p.node));
            if (!encl) {
                f.error("'super' keyword unexpected", path.node);
                return;
            }
            let src;
            if (isObjectMethod(encl.node)) { // in object expression
                // super ~ this.[[Prototype]]
                src = op.newObjectToken(encl.parent);
            } else {
                const cls = getClass(path);
                assert(cls);
                const constr = class2constructor.get(cls);
                assert(constr);
                if (isCallExpression(path.parent) ||
                    isStaticBlock(encl.node) ||
                    ((isClassMethod(encl.node) || isClassPrivateMethod(encl.node) || isClassProperty(encl.node) || isClassPrivateProperty(encl.node)) &&
                        encl.node.static)) { // in super-constructor call, static method, static field initializer or static block
                    // super ~ ct.[[Prototype]] where ct is the constructor of the enclosing class
                    src = op.newFunctionToken(constr);
                } else { // in constructor or non-static method
                    // super ~ pt.[[Prototype]] where pt is the prototype object of the constructor of the enclosing class
                    src = op.newPrototypeToken(constr);
                }
            }
            solver.addSubsetConstraint(vp.objPropVar(src, INTERNAL_PROTOTYPE()), vp.nodeVar(path.node));
        },

        Identifier(path: NodePath<Identifier>) {
            if (path.node.name === "arguments") // registers use of 'arguments'
                vp.identVar(path.node, path); // FIXME: registerArguments may be called too late if the function is recursive

            if (options.variableKinds) {
                const binding = path.scope.getBinding(path.node.name);
                if (binding)
                    (binding.identifier as any)[IDENTIFIER_KIND] = binding.kind;
            }
        },

        MemberExpression: { // TODO: actually more efficient to visit nodes bottom-up? (if not, most rules don't need to use 'exit')
            exit(path: NodePath<MemberExpression>) {
                visitMemberExpression(path);
            }
        },

        OptionalMemberExpression: {
            exit(path: NodePath<OptionalMemberExpression>) {
                visitMemberExpression(path);
            }
        },

        JSXMemberExpression: {
            exit(path: NodePath<JSXMemberExpression>) {
                visitMemberExpression(path);
            }
        },

        ReturnStatement: {
            exit(path: NodePath<ReturnStatement>) {
                if (path.node.argument) {
                    const fun = path.getFunctionParent()?.node;
                    if (fun) {
                        const expVar = op.expVar(path.node.argument, path);

                        // return E
                        let resVar;
                        if (fun.generator) {
                            // find the iterator object (it is returned via Function)
                            // constraint: ... ⊆ ⟦i.value⟧ where i is the iterator object for the function
                            const iter = a.canonicalizeToken(new AllocationSiteToken("Iterator", fun));
                            resVar = vp.objPropVar(iter, "value");
                        } else {
                            // constraint: ... ⊆ ⟦ret_f⟧ where f is the enclosing function (ignoring top-level returns)
                            resVar = vp.returnVar(fun);
                        }

                        if (fun.async && !fun.generator) {
                            // make a new promise with the fulfilled value being the return value
                            const promise = op.newPromiseToken(fun);
                            solver.addSubsetConstraint(expVar, vp.objPropVar(promise, PROMISE_FULFILLED_VALUES));
                            solver.addTokenConstraint(promise!, resVar);
                        } else
                            solver.addSubsetConstraint(expVar, resVar);
                    }
                }
            }
        },

        Function: { // FunctionDeclaration | FunctionExpression | ObjectMethod | ArrowFunctionExpression | ClassMethod | ClassPrivateMethod
            enter(path: NodePath<Function>) {

                // record that a function/method/constructor/getter/setter has been reached, connect to its enclosing function or module
                const fun = path.node;
                let cls: Class | undefined;
                if (isClassMethod(fun) && fun.kind === "constructor")
                    cls = getClass(path);
                const name = isFunctionDeclaration(path.node) || isFunctionExpression(path.node) ? path.node.id?.name :
                    (isObjectMethod(path.node) || isClassMethod(path.node)) ? getKey(path.node) :
                        cls ? cls.id?.name : undefined;// for constructors, use the class name if present
                const anon = isFunctionDeclaration(path.node) || isFunctionExpression(path.node) ? path.node.id === null : isArrowFunctionExpression(path.node);
                const msg = cls ? "constructor" : `${name ?? (anon ? "<anonymous>" : "<computed>")}`;
                if (logger.isVerboseEnabled())
                    logger.verbose(`Reached function ${msg} at ${locationToStringWithFile(fun.loc)}`);
                if (!cls) // FunctionInfos for constructors need to be generated early, see Class
                    a.registerFunctionInfo(op.file, path, name);
                if (!name && !anon)
                    f.warnUnsupported(fun, `Dynamic ${isFunctionDeclaration(path.node) || isFunctionExpression(path.node) ? "function" : "method"} name`); // TODO: handle functions/methods with unknown name?

                // process destructuring for parameters and register identifier parameters
                for (const param of fun.params) {
                    const paramVar = op.solver.varProducer.nodeVar(param);
                    if (isIdentifier(param))
                        f.registerFunctionParameter(paramVar, path.node);
                    else
                        op.assign(paramVar, param, path);
                }

                if (!options.oldobj) {
                    if (isFunctionDeclaration(path.node) || isFunctionExpression(path.node) || isClassMethod(path.node) || isClassPrivateMethod(path.node)) {

                        // connect function object and its prototype object
                        const ft = op.newFunctionToken(fun);
                        const pt = op.newPrototypeToken(fun);
                        solver.addTokenConstraint(pt, vp.objPropVar(ft, "prototype"));
                        solver.addTokenConstraint(ft, vp.objPropVar(pt, "constructor"));
                    }
                }

                if (fun.generator) {

                    // function*

                    // constraint: %(Async)Generator.prototype.next ⊆ ⟦i.next⟧ where i is the iterator object for the function
                    const iter = a.canonicalizeToken(new AllocationSiteToken("Iterator", fun));
                    const iterNext = vp.objPropVar(iter, "next"); // TODO: inherit from Generator.prototype or AsyncGenerator.prototype instead of copying properties
                    solver.addTokenConstraint(op.globalSpecialNatives.get(fun.async ? ASYNC_GENERATOR_PROTOTYPE_NEXT : GENERATOR_PROTOTYPE_NEXT)!, iterNext);
                    const iterReturn = vp.objPropVar(iter, "return");
                    solver.addTokenConstraint(op.globalSpecialNatives.get(fun.async ? ASYNC_GENERATOR_PROTOTYPE_RETURN : GENERATOR_PROTOTYPE_RETURN)!, iterReturn);
                    const iterThrow = vp.objPropVar(iter, "throw");
                    solver.addTokenConstraint(op.globalSpecialNatives.get(fun.async ? ASYNC_GENERATOR_PROTOTYPE_THROW : GENERATOR_PROTOTYPE_THROW)!, iterThrow);

                    // constraint i ∈ ⟦ret_f⟧ where i is the iterator object for the function
                    solver.addTokenConstraint(iter, vp.returnVar(fun));
                }
            }
        },

        FunctionDeclaration: {
            exit(path: NodePath<FunctionDeclaration>) {
                // function f(...) {...}  (as declaration)
                // constraint: t ∈ ⟦f⟧ where t denotes the function
                const to = path.node.id ? path.node.id : path.node; // export default functions may not have names, use the FunctionDeclaration node as constraint variable in that situation
                solver.addTokenConstraint(op.newFunctionToken(path.node), vp.nodeVar(to));
            }
        },

        FunctionExpression: {
            exit(path: NodePath<FunctionExpression>) {
                // function f(...) {...} (as expression, possibly without name)
                // constraint: t ∈ ⟦function f(...) {...}⟧ where t denotes the function
                if (!isParentExpressionStatement(path))
                    solver.addTokenConstraint(op.newFunctionToken(path.node), vp.nodeVar(path.node));
                // constraint: t ∈ ⟦f⟧ (if the function is named) where t denotes the function
                if (path.node.id)
                    solver.addTokenConstraint(op.newFunctionToken(path.node), vp.nodeVar(path.node.id));
            }
        },

        ArrowFunctionExpression: {
            exit(path: NodePath<ArrowFunctionExpression>) {
                // constraint: ⟦E⟧ ⊆ ⟦ret_f⟧ where f is the function
                if (isExpression(path.node.body))
                    solver.addSubsetConstraint(op.expVar(path.node.body, path), vp.returnVar(path.node));

                // (...) => E
                // constraint: t ∈ ⟦(...) => E⟧ where t denotes the function
                if (!isParentExpressionStatement(path))
                    solver.addTokenConstraint(op.newFunctionToken(path.node), vp.nodeVar(path.node));
            }
        },

        CallExpression: {
            exit(path: NodePath<CallExpression>) {

                // E0(E1,...)
                op.callFunction(path);
            }
        },

        OptionalCallExpression: {
            exit(path: NodePath<OptionalCallExpression>) {

                // E?.E0(E1,...)
                op.callFunction(path);
            }
        },

        NewExpression: {
            exit(path: NodePath<NewExpression>) {

                // new E0(E1,...)
                op.callFunction(path);
            }
        },

        AssignmentExpression: {
            exit(path: NodePath<AssignmentExpression>) {
                const oper = path.node.operator;
                if (oper === '=' || oper === '||=' || oper === '&&=' || oper === '??=') {
                    const eVar = op.expVar(path.node.right, path);
                    op.assign(eVar, path.node.left, path);

                    // constraint: ⟦E⟧ ⊆ ⟦... = E⟧
                    if (!isParentExpressionStatement(path))
                        solver.addSubsetConstraint(eVar, vp.nodeVar(path.node));
                }
            }
        },

        AssignmentPattern: {
            exit(path: NodePath<AssignmentPattern>) {

                // X = E (as default value)
                // constraint: ⟦E⟧ ⊆ ⟦X⟧ (if X is a simple identifier...)
                op.assign(op.expVar(path.node.right, path), path.node.left, path);
            }
        },

        VariableDeclarator: { // handles VariableDeclaration
            exit(path: NodePath<VariableDeclarator>) {
                if (path.node.init) {

                    // var/let/const X = E
                    // constraint: ⟦E⟧ ⊆ ⟦X⟧ (if X is a simple identifier...)
                    op.assign(op.expVar(path.node.init, path), path.node.id, path);
                }
            }
        },

        ConditionalExpression: {
            exit(path: NodePath<ConditionalExpression>) {

                // E1 ? E2 : E3
                // constraints: ⟦E2⟧ ⊆ ⟦E1 ? E2 : E3⟧, ⟦E3⟧ ⊆ ⟦E1 ? E2 : E3⟧
                if (!isParentExpressionStatement(path)) {
                    solver.addSubsetConstraint(op.expVar(path.node.consequent, path), vp.nodeVar(path.node));
                    solver.addSubsetConstraint(op.expVar(path.node.alternate, path), vp.nodeVar(path.node));
                }
            }
        },

        LogicalExpression: {
            exit(path: NodePath<LogicalExpression>) {

                // E1 op E2 where op is ||, && or ??
                // constraints: ⟦E1⟧ ⊆ ⟦E1 op E2⟧, ⟦E2⟧ ⊆ ⟦E1 op E2⟧
                // (the former can safely be omitted for && when only tracking functions and objects)
                if (!isParentExpressionStatement(path)) {
                    if (path.node.operator !== "&&")
                        solver.addSubsetConstraint(op.expVar(path.node.left, path), vp.nodeVar(path.node));
                    solver.addSubsetConstraint(op.expVar(path.node.right, path), vp.nodeVar(path.node));
                }
            }
        },

        SequenceExpression: {
            exit(path: NodePath<SequenceExpression>) { // TODO: handle in expVar (like ParenthesizedExpression) to reduce size of constraint graph?

                // (..., ..., E)
                // constraint: ⟦E⟧ ⊆ ⟦(..., ..., E)⟧
                if (!isParentExpressionStatement(path))
                    solver.addSubsetConstraint(op.expVar(path.node.expressions[path.node.expressions.length - 1], path), vp.nodeVar(path.node));
            }
        },

        Property: {
            exit(path: NodePath<ObjectProperty | ClassProperty | ClassAccessorProperty | ClassPrivateProperty>) {
                if (isPattern(path.parent))
                    return; // pattern properties are handled at assign
                if (isClassAccessorProperty(path.node))
                    assert.fail(`Encountered ClassAccessorProperty at ${locationToStringWithFile(path.node.loc)}`); // https://github.com/tc39/proposal-grouped-and-auto-accessors
                const key = getKey(path.node);
                if (key) {
                    if (path.node.value) {
                        if (!isExpression(path.node.value)) { // TODO: see test262-main/test and TypeScript-main/tests/cases
                            f.error(`Unexpected Property value type ${path.node.value?.type} at ${locationToStringWithFile(path.node.loc)}`);
                            return;
                        }

                        if (!options.oldobj) {

                            // {..., p: E, ...} or class... {...; p = E; ...} (static or non-static, private or public)
                            const rightvar = op.expVar(path.node.value, path);
                            if (rightvar)
                                if (isObjectProperty(path.node)) {
                                    // constraint: ⟦E⟧ ⊆ ⟦i.p⟧ where i is the object literal
                                    const dst = vp.objPropVar(op.newObjectToken(path.parentPath.node), key);
                                    solver.addSubsetConstraint(rightvar, dst);
                                } else {
                                    const cls = getClass(path);
                                    assert(cls);
                                    const constr = class2constructor.get(cls);
                                    assert(constr);
                                    if (path.node.static) {
                                        // constraint: ⟦E⟧ ⊆ ⟦c.p⟧ where c is the constructor function
                                        const t = op.newFunctionToken(constr);
                                        const dst = vp.objPropVar(t, key);
                                        solver.addSubsetConstraint(rightvar, dst);
                                    } else {
                                        // constraint: ∀ t ∈ ⟦this_c⟧: ⟦E⟧ ⊆ ⟦t.p⟧ where c is the constructor function
                                        solver.addForAllTokensConstraint(vp.thisVar(constr), TokenListener.CLASS_FIELD, path.node, (t: Token) => {
                                            if (isObjectPropertyVarObj(t)) {
                                                const dst = vp.objPropVar(t, key);
                                                solver.addSubsetConstraint(rightvar, dst);
                                            }
                                        });
                                    }
                                }

                        } else {

                            // {..., p: E, ...} or class... {...; p = E; ...} (static or non-static, private or public)
                            const rightvar = op.expVar(path.node.value, path);
                            let dst;
                            if (options.alloc && isObjectProperty(path.node)) {
                                // constraint: ⟦E⟧ ⊆ ⟦i.p⟧ where i is the object literal
                                dst = vp.objPropVar(a.canonicalizeToken(new ObjectToken(path.parentPath.node)), key);
                            } else if (options.alloc && (isClassProperty(path.node) || isClassAccessorProperty(path.node) || isClassPrivateProperty(path.node)) && path.node.static) {
                                // constraint: ⟦E⟧ ⊆ ⟦c.p⟧ where c is the class
                                const cls = getClass(path);
                                assert(cls);
                                dst = vp.objPropVar(a.canonicalizeToken(new ClassToken(cls)), key);
                            } else {
                                // constraint: ⟦E⟧ ⊆ ⟦k.p⟧ where k is the current package
                                dst = vp.packagePropVar(op.file, key);
                            }
                            solver.addSubsetConstraint(rightvar, dst);
                        }
                    }
                } else // TODO: only warn if not patched?
                    f.warnUnsupported(path.node, "Dynamic property name"); // TODO: nontrivial computed property name
                registerArtificialClassPropertyInitializer(f, path);
            },
        },

        Method: {
            exit(path: NodePath<ObjectMethod | ClassMethod | ClassPrivateMethod>) {
                switch (path.node.kind) {
                    case "method":
                    case "get":
                    case "set":
                        const key = getKey(path.node);
                        if (key) {

                            if (!options.oldobj) {

                                // [class C...] {... p(..) {...} ...}  (static or non-static, private or public)
                                const t = op.newFunctionToken(path.node);
                                const ac = path.node.kind === "method" ? "normal" : path.node.kind;
                                if (isObjectMethod(path.node)) {
                                    // constraint: t ∈ ⟦(ac)i.p⟧ where t denotes the function, i is the object literal,
                                    // and (ac) specifies whether it is a getter, setter or normal property
                                    const it = op.newObjectToken(path.parentPath.node);
                                    const dst = vp.objPropVar(it, key, ac);
                                    solver.addTokenConstraint(t, dst);
                                    // constraint: i ∈ ⟦this_t⟧
                                    solver.addTokenConstraint(it, vp.thisVar(path.node));
                                } else {
                                    const cls = getClass(path);
                                    assert(cls);
                                    const constr = class2constructor.get(cls);
                                    assert(constr);
                                    if (path.node.static) {
                                        // constraint: t ∈ ⟦(ac)ct.p⟧ where t denotes the function,
                                        // ct is the constructor function,
                                        // and (ac) specifies whether it is a getter, setter or normal property
                                        const ct = op.newFunctionToken(constr);
                                        const dst = vp.objPropVar(ct, key, ac);
                                        solver.addTokenConstraint(t, dst);
                                    } else {
                                        // constraint: t ∈ ⟦(ac)pt.p⟧ where t denotes the function,
                                        // pt is the prototype object of the constructor function,
                                        // and (ac) specifies whether it is a getter, setter or normal property
                                        const pt = op.newPrototypeToken(constr);
                                        const dst = vp.objPropVar(pt, key, ac);
                                        solver.addTokenConstraint(t, dst);
                                        // constraint: ⟦this_c⟧ ∈ ⟦this_t⟧
                                        solver.addSubsetConstraint(vp.thisVar(constr), vp.thisVar(path.node));
                                    }
                                }

                            }  else {

                                // [class C...] {... p(..) {...} ...}  (static or non-static, private or public)
                                const t = op.newFunctionToken(path.node);
                                const ac = path.node.kind === "method" ? "normal" : path.node.kind;
                                let dst;
                                if (options.alloc && isObjectMethod(path.node)) {
                                    // constraint: t ∈ ⟦(ac)i.p⟧ where t denotes the function, i is the object literal,
                                    // and (ac) specifies whether it is a getter, setter or normal property
                                    dst = vp.objPropVar(a.canonicalizeToken(new ObjectToken(path.parentPath.node)), key, ac);
                                } else if (options.alloc && (isClassMethod(path.node) || isClassPrivateMethod(path.node)) && path.node.static) {
                                    // constraint: t ∈ ⟦(ac)c.p⟧ where t denotes the function, c is the class,
                                    // and (ac) specifies whether it is a getter, setter or normal property
                                    const cls = getClass(path);
                                    assert(cls);
                                    dst = vp.objPropVar(a.canonicalizeToken(new ClassToken(cls)), key, ac);

                                } else {
                                    // constraint: t ∈ ⟦(ac)k.p⟧ where t denotes the function and k is the current package,
                                    // and (ac) specifies whether it is a getter, setter or normal property
                                    dst = vp.packagePropVar(op.file, key, ac);
                                }
                                solver.addTokenConstraint(t, dst);
                            }
                        } else {
                            if (!options.oldobj && (options.approx || options.approxLoad))
                                op.newFunctionToken(path.node); // need to register the allocation site for patching

                            // TODO: only warn if not patched?
                            f.warnUnsupported(path.node, "Dynamic method name"); // TODO: nontrivial computed method name
                        }
                        break;
                    case "constructor":

                        // class C... {... constructor(..) {...} ...}
                        // constraint: t ∈ ⟦C⟧ where t denotes the constructor function
                        const cls = getClass(path);
                        if (cls && cls.id) // note: to match dyn.ts, the FunctionToken uses the actual constructor location, but the FunctionInfo uses the location of the class
                            solver.addTokenConstraint(op.newFunctionToken(path.node), vp.nodeVar(cls.id));
                        break;
                }
                // TODO: currently ignoring generator, async, static (often easy to resolve!), override, optional, abstract
            }
        },

        Class(path: NodePath<ClassExpression | ClassDeclaration>) {

            let constructor: NodePath<ClassMethod> | undefined;
            for (const b of path.get("body.body") as Array<NodePath>)
                if (isClassMethod(b.node) && b.node.kind === "constructor") {
                    constructor = b as NodePath<ClassMethod>;
                    break;
                }
            assert(constructor); // see extras.ts
            class2constructor.set(path.node, constructor.node);
            a.registerFunctionInfo(op.file, constructor, path.node?.id?.name); // for constructors, use the class name if present

            const exported = isExportDeclaration(path.parent);

            if (!options.oldobj) {

                const ct = op.newFunctionToken(constructor.node);

                if (isClassExpression(path.node) || exported) {

                    // class ... {...}
                    // constraint: ct ∈ ⟦class ... {...}⟧ where ct is the constructor function
                    if (!isParentExpressionStatement(path) || exported)
                        solver.addTokenConstraint(ct, vp.nodeVar(path.node));
                }

                // constraint: ct ∈ ⟦C⟧ where ct is the constructor function
                if (path.node.id)
                    solver.addTokenConstraint(ct, vp.nodeVar(path.node.id));

                if (path.node.superClass) {

                    // class C extends E {...}
                    // constraint: ∀ functions w ∈ ⟦E⟧: ...
                    const eVar = op.expVar(path.node.superClass, path);
                    solver.addForAllTokensConstraint(eVar, TokenListener.EXTENDS, path.node, (w: Token) => {

                        // ... w ∈ ⟦ct.[[Prototype]]⟧ (allows inheritance of static properties)
                        solver.addInherits(ct, w);

                        if (w instanceof FunctionToken || w instanceof AccessPathToken) {
                            const pt = op.newPrototypeToken(constructor.node);

                            if (w instanceof FunctionToken) {

                                // ... ⟦w.prototype⟧ ⊆ ⟦ct.prototype.[[Prototype]]⟧ (allows inheritance of instance properties)
                                solver.addInherits(pt, solver.varProducer.objPropVar(w, "prototype"));

                            } else {

                                const p = a.canonicalizeToken(new AccessPathToken(a.canonicalizeAccessPath(new PropertyAccessPath(eVar!, "prototype"))));
                                solver.addInherits(pt, p);
                            }
                        }
                    });
                }

            } else {
                if (constructor) {
                    if (isClassExpression(path.node) || exported) {

                        // class ... {...}
                        // constraint: t ∈ ⟦class ... {...}⟧ where t denotes the constructor function
                        if (!isParentExpressionStatement(path) || exported)
                            solver.addTokenConstraint(op.newFunctionToken(constructor.node), vp.nodeVar(path.node));
                    }
                } else // no explicit constructor (dyn.ts records a call to an implicit constructor)
                    f.registerArtificialFunction(op.moduleInfo, path.node.loc);

                // class ... {...}
                // constraint: c ∈ ⟦class ... {...}⟧ where c is the ClassToken
                const ct = op.newClassToken(path.node);
                if (isClassExpression(path.node) || exported)
                    solver.addTokenConstraint(ct, vp.nodeVar(path.node));

                // constraint: c ∈ ⟦C⟧ where c is the ClassToken
                if (path.node.id)
                    solver.addTokenConstraint(ct, vp.nodeVar(path.node.id));
            }
        },

        ObjectExpression(path: NodePath<ObjectExpression>) {

            // {...}
            if (!isParentExpressionStatement(path)) {

                // constraint: t ∈ ⟦{...}⟧ where t is the object for this allocation site
                const ot = op.newObjectToken(path.node);
                solver.addTokenConstraint(ot, vp.nodeVar(path.node));
                // TODO: fall back to field-based if an object token appears in a constraint variable together with >k other object tokens?

                for (const p of path.node.properties)
                    if (isSpreadElement(p)) {
                        if (options.objSpread) {
                            // it's enticing to rewrite the AST to use Object.assign, but assign invokes setters on the target object
                            const enclosing = a.getEnclosingFunctionOrModule(path);
                            const argVar = vp.expVar(p.argument, path);
                            solver.addForAllTokensConstraint(argVar, TokenListener.OBJECT_SPREAD, p, (t: Token) => {
                                if (isObjectPropertyVarObj(t)) {
                                    solver.addForAllObjectPropertiesConstraint(t, TokenListener.OBJECT_SPREAD, path.node, (prop: string) => {
                                        solver.fragmentState.registerPropertyRead("read", undefined, argVar, undefined, prop, path.node, enclosing);
                                        op.readPropertyBound(t, prop, vp.objPropVar(ot, prop), {t: ot, s: prop});
                                    });
                                }
                            });
                        } else
                            f.warnUnsupported(p, "SpreadElement in ObjectExpression (use --obj-spread)");
                    } // (ObjectProperty and ObjectMethod are handled at rules Property and Method respectively)
            }
        },

        ArrayExpression(path: NodePath<ArrayExpression>) {

            // [...]
            if (!isParentExpressionStatement(path)) {

                // constraint: t ∈ ⟦{...}⟧ where t is the array for this allocation site
                const t = op.newArrayToken(path.node);
                solver.addTokenConstraint(t, vp.nodeVar(path.node));

                let indexKnown = path.node.elements.length <= 10; // using ARRAY_UNKNOWN if more than 10 elements
                for (const [index, e] of path.node.elements.entries())
                    if (isExpression(e)) {

                        // constraint: ⟦E⟧ ⊆ ⟦t.i⟧ for each array element E with index i
                        const prop = indexKnown ? String(index) : ARRAY_UNKNOWN;
                        solver.addSubsetConstraint(op.expVar(e, path), vp.objPropVar(t, prop));
                    } else if (isSpreadElement(e)) {
                        indexKnown = false;
                        op.readIteratorValue(op.expVar(e.argument, path), vp.arrayUnknownVar(t), path.node);
                    } else
                        e satisfies null;
            }
        },

        StaticBlock(path: NodePath<StaticBlock>) {
            f.registerArtificialFunction(op.moduleInfo, path.node.loc); // dyn.ts treats static blocks as functions
        },

        ThrowStatement: {
            exit(path: NodePath<ThrowStatement>) {
                f.registerEscaping(op.expVar(path.node.argument, path));
            }
        },

        CatchClause: {
            // TODO: CatchClause
        },

        ImportDeclaration(path: NodePath<ImportDeclaration>) {

            // model 'import' like 'require'
            op.requireModule(path.node.source.value, vp.nodeVar(path.node), path); // TODO: see TODO in requireResolve about using import.meta.resolve

            let any = false;
            for (const imp of path.node.specifiers) {
                switch (imp.type) {
                    case "ImportNamespaceSpecifier":

                        // bind the module export object to the namespace identifier
                        solver.addSubsetConstraint(vp.nodeVar(path.node), vp.nodeVar(imp.local));
                        break;

                    case "ImportSpecifier":
                    case "ImportDefaultSpecifier":
                        any = true;
                        break;
                }
                // record identifier uses for pattern matcher
                const refs = path.scope.getBinding(imp.local.name)?.referencePaths;
                if (refs)
                    for (const ref of refs)
                        if ((ref.node as any)[JELLY_NODE_ID]) // @babel/plugin-transform-typescript removes type annotations, so skip identifier uses with no JELLY_NODE_ID
                            mapArrayAdd(imp.local, ref.node, f.importDeclRefs);
            }
            // bind each module export object property to the local identifier
            if (any) {

                // constraint: ∀ objects t ∈ ⟦import...⟧: ⟦t.p⟧ ⊆ ⟦x⟧ where p is the property and x is the local identifier
                // for each import specifier
                const encl = a.getEnclosingFunctionOrModule(path);
                solver.addForAllTokensConstraint(vp.nodeVar(path.node), TokenListener.IMPORT_BASE, path.node, (t: Token) => {
                    for (const imp of path.node.specifiers)
                        if (isImportSpecifier(imp) || isImportDefaultSpecifier(imp)) {
                            const prop = getImportName(imp);
                            const dst = solver.varProducer.nodeVar(imp.local);
                            if (t instanceof AllocationSiteToken || t instanceof FunctionToken || t instanceof NativeObjectToken || t instanceof PackageObjectToken)
                                solver.addSubsetConstraint(solver.varProducer.objPropVar(t, prop), dst);
                            else if (t instanceof AccessPathToken) // TODO: treat as object along with other tokens above?
                                solver.addAccessPath(new PropertyAccessPath(solver.varProducer.nodeVar(path.node), prop), dst, imp.local, encl, t.ap); // TODO: describe this constraint...
                        }
                });
            }
        },

        ExportDeclaration(path: NodePath<ExportAllDeclaration | ExportDefaultDeclaration | ExportNamedDeclaration>) {
            switch (path.node.type) {
                case "ExportNamedDeclaration": // examples: export const { prop: name } = { prop: ... }, export { x as y }
                case "ExportDefaultDeclaration": // example: export default E;
                    if (path.node.declaration) {
                        assert(!isExportNamedDeclaration(path.node) || path.node.specifiers.length === 0, "Unexpected specifiers at ExportNamedDeclaration with declaration");
                        assert(!isExportNamedDeclaration(path.node) || !path.node.source, "Unexpected source at ExportNamedDeclaration with declaration");
                        const decl = path.node.declaration;
                        switch (decl.type) {
                            case "FunctionDeclaration": // example: export function x() {...}
                            case "ClassDeclaration": { // example: export class x {...}
                                const from = decl.id ? decl.id : decl; // using the declaration node as constraint variable for anonymous functions and classes
                                assert(isExportDefaultDeclaration(path.node) || decl.id, "Unexpected missing id");
                                const prop = isExportDefaultDeclaration(path.node) ? "default" : decl.id!.name;
                                solver.addSubsetConstraint(vp.nodeVar(from), vp.objPropVar(op.exportsObjectToken, prop));
                                break;
                            }
                            case "VariableDeclaration": { // example: export var x = ... (local declaration and init value handled at rule VariableDeclarator)
                                function exportDeclared(lval: LVal) {
                                    if (isIdentifier(lval))
                                        solver.addSubsetConstraint(vp.nodeVar(lval), vp.objPropVar(op.exportsObjectToken, lval.name));
                                    else if (isAssignmentPattern(lval))
                                        exportDeclared(lval.left);
                                    else if (isObjectPattern(lval)) {
                                        for (const p of lval.properties)
                                            if (isRestElement(p))
                                                exportDeclared(p.argument);
                                            else {
                                                if (!isLVal(p.value))
                                                    assert.fail(`Unexpected expression ${p.value.type}, expected LVal`);
                                                exportDeclared(p.value);
                                            }
                                    } else if (isArrayPattern(lval)) {
                                        for (const p of lval.elements)
                                            if (p)
                                                if (isRestElement(p))
                                                    exportDeclared(p.argument);
                                                else
                                                    exportDeclared(p);
                                    } else
                                        assert.fail(`Unexpected LVal type ${lval.type}`);
                                }
                                for (const decl2 of decl.declarations)
                                    exportDeclared(decl2.id);
                                break;
                            }
                            default: {
                                if (isDeclaration(decl))
                                    assert.fail(`Unexpected declaration type ${decl.type} in ExportDeclaration`);
                                if (isExpression(decl))
                                    solver.addSubsetConstraint(op.expVar(decl, path), vp.objPropVar(op.exportsObjectToken, "default"));
                                break;
                            }
                        }
                    } else {
                        if (!isExportNamedDeclaration(path.node))
                            assert.fail(`Unexpected node type ${path.node.type}`);
                        const node = path.node;
                        function getExportVar(name: string): ConstraintVar | undefined {
                            const m = node.source ? op.requireModule(node.source.value, vp.nodeVar(node), path) : undefined;
                            return m instanceof ModuleInfo ? vp.objPropVar(a.canonicalizeToken(new NativeObjectToken("exports", m)), name) : undefined;
                        }
                        for (const spec of path.node.specifiers)
                            switch (spec.type) {
                                case "ExportSpecifier": // example: export {x as y} ...
                                case "ExportDefaultSpecifier": // example: export x from "m"
                                    const from = isExportDefaultSpecifier(spec) ? getExportVar("default") : node.source ? getExportVar(spec.local.name) : vp.identVar(spec.local, path);
                                    solver.addSubsetConstraint(from, vp.objPropVar(op.exportsObjectToken, getExportName(spec.exported)));
                                    break;
                                case "ExportNamespaceSpecifier": // example: export * as x from "m"
                                    f.warnUnsupported(spec); // TODO: ExportNamespaceSpecifier, see https://babeljs.io/docs/en/babel-plugin-proposal-export-namespace-from
                                    break;
                            }
                    }
                    break;
                case "ExportAllDeclaration": // example: export * from "m"
                    const m = op.requireModule(path.node.source.value, vp.nodeVar(path.node), path);
                    if (m instanceof ModuleInfo) {
                        const t = a.canonicalizeToken(new NativeObjectToken("exports", m));
                        solver.addForAllObjectPropertiesConstraint(t, TokenListener.EXPORT_BASE, path.node, (prop: string) => // TODO: only exporting explicitly defined properties, not unknown computed
                            solver.addSubsetConstraint(solver.varProducer.objPropVar(t, prop), solver.varProducer.objPropVar(op.exportsObjectToken, prop)));
                    }
                    break;
            }
        },

        ForOfStatement(path: NodePath<ForOfStatement>) {
            // read iterator using path.node for the temporary result
            op.readIteratorValue(op.expVar(path.node.right, path), vp.nodeVar(path.node), path.node);
            // assign the temporary result to the l-value
            const lval = isVariableDeclaration(path.node.left) ? path.node.left.declarations.length === 1 ? path.node.left.declarations[0]?.id : undefined : path.node.left;
            assert(lval, "Unexpected number of declarations at for-of");
            op.assign(vp.nodeVar(path.node), lval, path);
            // note: 'for await' is handled trivially because the same abstract object is used for the AsyncGenerator and the iterator objects
        },

        YieldExpression(path: NodePath<YieldExpression>) {
            const fun = path.getFunctionParent()?.node;
            assert(fun, "yield not in function?!");
            const iter = a.canonicalizeToken(new AllocationSiteToken("Iterator", fun));
            const iterValue = vp.objPropVar(iter, "value");
            if (path.node.argument) {
                if (path.node.delegate) {
                    // yield* E
                    // constraint: ∀ i2 ∈ ⟦iterators(E)⟧: ⟦i2.value⟧ ⊆ ⟦i.value⟧ where i is the iterator object for the function
                    op.readIteratorValue(op.expVar(path.node.argument, path), iterValue, fun.body);
                } else {
                    // yield E
                    // constraint: ⟦E⟧ ⊆ ⟦i.value⟧ where i is the iterator object for the function
                    solver.addSubsetConstraint(op.expVar(path.node.argument, path), iterValue);
                }
            }
            // constraint: ⟦i.value⟧ ⊆ ⟦yield(*) E⟧ where i is the iterator object for the function
            if (!isParentExpressionStatement(path))
                solver.addSubsetConstraint(iterValue, vp.nodeVar(path.node));
        },

        AwaitExpression(path: NodePath<AwaitExpression>) {
            op.awaitPromise(op.expVar(path.node.argument, path), op.expVar(path.node, path), path.node);
        },

        TaggedTemplateExpression(_path: NodePath<TaggedTemplateExpression>) {
            assert.fail("TaggedTemplateExpression should be handled by @babel/plugin-transform-template-literals");
        },

        RegExpLiteral(path: NodePath<RegExpLiteral>) {
            solver.addTokenConstraint(op.newRegExpToken(), vp.nodeVar(path.node));
        },

        WithStatement(path: NodePath<WithStatement>) {
            f.warnUnsupported(path.node);
        },

        JSXElement(path: NodePath<JSXElement>) {
            op.callComponent(path);
        }
    });

    /**
     * Visits a MemberExpression or OptionalMemberExpression.
     */
    function visitMemberExpression(path: NodePath<MemberExpression | OptionalMemberExpression | JSXMemberExpression>) {
        const dstVar = isParentExpressionStatement(path) ? undefined : vp.nodeVar(path.node);
        // Record dynamic read for approximate interpretation
        a.patching?.recordDynamicRead(path.node, dstVar);
        if (isAssignmentExpression(path.parent) && path.parent.left === path.node)
            return; // don't treat left-hand-sides of assignments as expressions
        if (isCalleeExpression(path))
            return; // don't perform a property read for method calls

        op.readProperty(op.expVar(path.node.object, path), getProperty(path.node), dstVar, path.node, a.getEnclosingFunctionOrModule(path));
    }
}
