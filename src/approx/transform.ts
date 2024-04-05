import {PluginObj, template, transformFromAstSync} from "@babel/core";
import {
    ArrayExpression,
    ArrowFunctionExpression,
    AssignmentExpression,
    BlockStatement,
    blockStatement,
    booleanLiteral,
    CallExpression,
    CatchClause,
    ClassDeclaration,
    ClassExpression,
    ClassMethod,
    ClassPrivateMethod,
    ClassProperty,
    conditionalExpression,
    Expression,
    expressionStatement,
    File,
    Function,
    FunctionDeclaration,
    FunctionExpression,
    identifier,
    Identifier,
    isArrayPattern,
    isArrowFunctionExpression,
    isAssignmentExpression,
    isBlockStatement,
    isClassExpression,
    isClassMethod,
    isClassProperty,
    isExportDeclaration,
    isExportDefaultDeclaration,
    isExpression,
    isIdentifier,
    isImport,
    isMemberExpression,
    isObjectExpression,
    isObjectMethod,
    isObjectPattern,
    isOptionalMemberExpression,
    isPrivateName,
    isStringLiteral,
    isSuper,
    Loop,
    memberExpression,
    MemberExpression,
    NewExpression,
    nullLiteral,
    ObjectExpression,
    ObjectMethod,
    ObjectProperty,
    OptionalCallExpression,
    OptionalMemberExpression,
    Program,
    returnStatement,
    SourceLocation,
    StringLiteral,
    stringLiteral,
    thisExpression,
    variableDeclaration,
    variableDeclarator
} from "@babel/types";
import {NodePath} from "@babel/traverse";
import logger from "../misc/logger";
import {FilePath, locationToString} from "../misc/util";
import {dirname, resolve} from "path";
import Module from "module";
import assert from "assert";

export const PREFIX = "_J$"; // prefix for special global variables

export const SPECIALS =
    new Set(["start", "pw", "dpr", "alloc", "init", "method", "comp", "new", "enter", "catch", "loop", "eval", "cr"]
        .map(s => PREFIX + s));

const START_CJS = template.statements(
    `const ${PREFIX}mod = MODULE; module = ${PREFIX}start(${PREFIX}mod, typeof module !== 'undefined' && module); Object.freeze(require.extensions)`
);
const START_ESM = template.statements(
    `const ${PREFIX}mod = MODULE; ${PREFIX}start(${PREFIX}mod); ` +
    `import {createRequire as ${PREFIX}cr} from 'node:module'; ` +
    `import {dirname as ${PREFIX}dirname} from 'node:path';` +
    `var require = ${PREFIX}cr(import.meta.url), module = ${PREFIX}proxy, exports = ${PREFIX}proxy, ` +
    `__filename = import.meta.url.startsWith("file://") ? import.meta.url.substring(7) : undefined, ` +
    `__dirname = import.meta.url.startsWith("file://") ? ${PREFIX}dirname(import.meta.url.substring(7)) : undefined;`
);
const OBJCLS = template.expression(`(${PREFIX}init(), ${PREFIX}alloc(${PREFIX}mod, LOC, BODY, true, CLS))`);
const FUNARRAY = template.expression(`${PREFIX}alloc(${PREFIX}mod, LOC, BODY)`);
const FUNDECL = template.statement(`${PREFIX}alloc(${PREFIX}mod, LOC, VAL)`);
const INIT = template.statement(`${PREFIX}init()`);
const ALLOC = template.statements(`${PREFIX}alloc(${PREFIX}mod, LOC, VAL, true, true)`);
const PW = template.expression(`${PREFIX}pw(${PREFIX}mod, LOC, BASE, PROP, VAL, DYN)`);
const DPR = template.expression(`${PREFIX}dpr(${PREFIX}mod, LOC, BASE, PROP)`);
const NEW = template.expression(`${PREFIX}new(${PREFIX}mod, LOC, FUN, ARGS)`);
const FUNCALL = template.expression(`${PREFIX}fun(${PREFIX}mod, LOC, FUN, OPTCALL, ARGS)`);
const EVAL = template.expression(`${PREFIX}eval(${PREFIX}mod, LOC, STR)`);
const REQUIRE = template.expression(`${PREFIX}require(${PREFIX}mod, LOC, STR)`);
const METHODCALL = template.expression(`${PREFIX}method(${PREFIX}mod, LOC, BASE, PROP, DYN, OPTMEMBER, OPTCALL, ARGS)`);
const COMP = template.expression(`${PREFIX}comp(${PREFIX}mod, LOC, BODY, KIND, STATIC, DYN)`);
const ENTER = template.expression(`${PREFIX}enter(${PREFIX}mod, LOC)`);
const SUPER = template.expression(`${PREFIX}this(${PREFIX}mod, LOC, SUPER)`);
const THIS = template.expression(`${PREFIX}this(${PREFIX}mod, LOC, NEWTARGET)`);
const CATCH = template.statement(`${PREFIX}catch(ID)`);
const LOOP = template.statement(`{${PREFIX}loop();BODY}`);

const JELLY_HOME = dirname(dirname(__dirname));

/**
 * Throws exception if the given file is part of Jelly runtime.
 * (This avoids problems with instrumenting files that are also used by the analysis itself.)
 */
export function checkFile(file: string) {
    if (file.startsWith(resolve(JELLY_HOME, "node_modules")) || file.startsWith(resolve(JELLY_HOME, "lib")))
        throw new Error(`Error: Cannot analyze Jelly runtime file ${file}`);
}

/**
 * Transform the given code for approximate interpretation.
 * @param ast the AST
 * @param str the textual code
 * @param file the name (file path, possibly with ":eval[...]" blocks)
 * @param mode CommonJS or ESM module
 * @return {transformed: transformed code or undefined if transformation failed, staticRequires: static requires, numFunctions: number of functions}
 */
export function approxTransform(ast: File, str: string, file: string, mode: "commonjs" | "module"): {
    transformed: string | undefined,
    staticRequires: Set<string>,
    numStaticFunctions: number
} {
    let numStaticFunctions = 0;
    const staticRequires = new Set<string>();
    const t = transformFromAstSync(ast, str, {
        plugins: [
            transform
        ],
        cwd: __dirname,
        configFile: false,
        compact: str.length > 1048576,
        code: true
    });
    if (t?.code) {
        if (logger.isDebugEnabled())
            logger.debug("Transformed for approximate interpretation:\n" + t.code);
        return {transformed: t.code, staticRequires, numStaticFunctions};
    } else {
        logger.error(`Error: Transformation failed for ${file}`);
        return {transformed: undefined, staticRequires, numStaticFunctions};
    }

    function transform(): PluginObj {
        return {
            visitor: {
                Program: {
                    exit(path: NodePath<Program>) {
                        visitProgram(path, file);
                    }
                },
                ObjectExpression: {
                    exit(path: NodePath<ObjectExpression>) {
                        visitObjectOrClassExpression(path);
                    }
                },
                ArrayExpression: {
                    exit(path: NodePath<ArrayExpression>) {
                        visitFunctionOrArrayExpression(path);
                    }
                },
                ClassExpression: {
                    exit(path: NodePath<ClassExpression>) {
                        visitClass(path);
                        visitObjectOrClassExpression(path);
                    }
                },
                FunctionExpression: {
                    exit(path: NodePath<FunctionExpression>) {
                        visitFunction(path);
                        visitFunctionOrArrayExpression(path);
                    }
                },
                ArrowFunctionExpression: {
                    exit(path: NodePath<ArrowFunctionExpression>) {
                        visitFunction(path);
                        visitFunctionOrArrayExpression(path);
                    }
                },
                FunctionDeclaration: {
                    exit(path: NodePath<FunctionDeclaration>) {
                        visitFunction(path);
                        if (path.node.id)
                            visitFunctionDeclaration(path, path.node.id.name);
                    }
                },
                ClassDeclaration: {
                    exit(path: NodePath<ClassDeclaration>) {
                        visitClass(path);
                        if (path.node.id)
                            visitClassDeclaration(path, path.node.id.name);
                    }
                },
                AssignmentExpression: {
                    exit(path: NodePath<AssignmentExpression>) {
                        if ((isMemberExpression(path.node.left) || isOptionalMemberExpression(path.node.left)) &&
                            !isPrivateName(path.node.left.property) && !isSuper(path.node.left.object)) // TODO: currently not producing hints for super[...] = ...
                            visitPropertyWrite(path, path.node.left.object, path.node.left.property, path.node.right, path.node.left.computed);
                    }
                },
                MemberExpression: {
                    exit(path: NodePath<MemberExpression>) {
                        visitPropertyRead(path);
                    }
                },
                OptionalMemberExpression: {
                    exit(path: NodePath<OptionalMemberExpression>) {
                        visitPropertyRead(path);
                    }
                },
                CallExpression: {
                    exit(path: NodePath<CallExpression>) {
                        if (isImport(path.node.callee) && path.node.arguments.length >= 1)
                            visitRequireOrImport(path);
                        else if (isSuper(path.node.callee))
                            visitSuperCall(path);
                        else
                            visitCall(path);
                    }
                },
                OptionalCallExpression: {
                    exit(path: NodePath<OptionalCallExpression>) {
                        visitCall(path);
                    }
                },
                NewExpression: {
                    exit(path: NodePath<NewExpression>) {
                        visitNew(path);
                    }
                },
                ObjectProperty: {
                    exit(path: NodePath<ObjectProperty>) {
                        if (isObjectExpression(path.parent) && !isPrivateName(path.node.key)) // TODO: object locations for private methods currently not supported
                            visitPropertyOrMethod(path);
                    }
                },
                ObjectMethod: {
                    exit(path: NodePath<ObjectMethod>) {
                        visitFunction(path);
                        visitPropertyOrMethod(path);
                    }
                },
                ClassProperty: {
                    exit(path: NodePath<ClassProperty>) {
                        visitPropertyOrMethod(path);
                    }
                },
                ClassMethod: {
                    exit(path: NodePath<ClassMethod>) {
                        visitFunction(path);
                        if (path.node.kind !== "constructor")
                            visitPropertyOrMethod(path);
                    }
                },
                ClassPrivateMethod: {
                    exit(path: NodePath<ClassPrivateMethod>) {
                        visitFunction(path);
                        // TODO: object locations for private methods currently not supported
                    }
                },
                CatchClause: {
                    exit(path: NodePath<CatchClause>) {
                        visitCatch(path);
                    }
                },
                Loop: {
                    exit(path: NodePath<Loop>) {
                        visitLoop(path);
                    }
                },
                ObjectPattern: {
                    // TODO: ObjectProperty (see @babel/plugin-transform-destructuring)
                },
            }
        };
    }
    
    function getLoc(loc: SourceLocation | null | undefined): StringLiteral {
        return stringLiteral(locationToString(loc, false, true));
    }

    function visitProgram(path: NodePath<Program>, file: FilePath) {
        path.scope.registerDeclaration(path.unshiftContainer("body", (mode === "commonjs" ? START_CJS : START_ESM)({
            MODULE: stringLiteral(file)
        }))[0]);
    }

    function visitObjectOrClassExpression(path: NodePath<ObjectExpression | ClassExpression>) {
        path.replaceWith(OBJCLS({
            LOC: getLoc(path.node.loc),
            BODY: path.node,
            CLS: booleanLiteral(isClassExpression(path.node))
        }));
        path.skip();
    }

    function visitFunctionOrArrayExpression(path: NodePath<FunctionExpression | ArrowFunctionExpression | ArrayExpression>) {
        path.replaceWith(FUNARRAY({
            LOC: getLoc(path.node.loc),
            BODY: path.node
        }));
        path.skip();
    }

    function visitFunctionDeclaration(path: NodePath<FunctionDeclaration>, id: string) {
        (isExportDefaultDeclaration(path.parent) ? path.parentPath.getSibling(0) : path.getSibling(0)).insertBefore(FUNDECL({ // placing at top to account for hoisting
            LOC: getLoc(path.node.loc),
            VAL: identifier(id)
        }));
    }

    function visitClass(path: NodePath<ClassExpression | ClassDeclaration>) {
        for (const m of path.node.body.body)
            if (isClassMethod(m) && m.kind === "constructor")
                return;
        numStaticFunctions++; // a dummy constructor is made for classes without explicit construct
    }

    function visitClassDeclaration(path: NodePath<ClassDeclaration>, id: string) {
        const p = isExportDeclaration(path.parent) ? path.parentPath : path;
        p.insertBefore(INIT());
        p.insertAfter(ALLOC({
            LOC: getLoc(path.node.loc),
            VAL: identifier(id)
        }));
    }

    function visitPropertyWrite(path: NodePath<AssignmentExpression>, base: Expression, prop: Expression | Identifier, val: Expression, isDynamic: boolean) {
        path.replaceWith(PW({
            LOC: getLoc(path.node.loc),
            BASE: base,
            PROP: isDynamic ? prop : stringLiteral((prop as Identifier).name),
            VAL: val,
            DYN: booleanLiteral(isDynamic)
        }));
        path.skip();
    }

    function visitPropertyRead(path: NodePath<MemberExpression | OptionalMemberExpression>) {
        if (path.node.computed && !isPrivateName(path.node.property) && !isSuper(path.node.object) && // TODO: currently not producing hints for super[...]
            !(isAssignmentExpression(path.parent) && path.parent.left === path.node))
            visitDynamicPropertyRead(path, path.node.object, path.node.property);
    }

    function visitDynamicPropertyRead(path: NodePath<MemberExpression | OptionalMemberExpression>, base: Expression, prop: Expression | Identifier) {
        path.replaceWith(DPR({
            LOC: getLoc(path.node.loc),
            BASE: base,
            PROP: prop
        }));
        path.skip();
    }

    function visitCall(path: NodePath<CallExpression | OptionalCallExpression>) {
        if (isMemberExpression(path.node.callee) || isOptionalMemberExpression(path.node.callee)) {
            if (!isPrivateName(path.node.callee.property) && !isSuper(path.node.callee.object)) // TODO: currently not producing hints for super[...](...)
                visitMethodCall(path, path.node.callee.object, path.node.callee.property, Boolean(path.node.callee.computed), Boolean(path.node.callee.optional));
        } else if (isExpression(path.node.callee))
            visitFunctionCall(path);
    }

    function visitNew(path: NodePath<NewExpression>) {
        path.replaceWith(NEW({
            LOC: getLoc(path.node.loc),
            FUN: path.node.callee,
            ARGS: path.node.arguments
        }));
        path.skip();
    }

    function visitFunctionCall(path: NodePath<CallExpression | OptionalCallExpression>) {
        const fun = path.node.callee;
        if (isIdentifier(fun)) {
            if (SPECIALS.has(fun.name))
                return;
            if (fun.name === "eval" && !path.scope.getBinding(fun.name) && !path.node.optional) { // direct eval
                if (path.node.arguments.length >= 1)
                    path.get("arguments")[0].replaceWith(EVAL({
                        LOC: getLoc(path.node.loc),
                        STR: path.node.arguments[0]
                    }));
                return;
            }
            if (fun.name === "require" && !path.scope.getBinding(fun.name) && path.node.arguments.length >= 1)
                visitRequireOrImport(path); // TODO: not producing hints for aliases of 'require'
        }
        path.replaceWith(FUNCALL({
            LOC: getLoc(path.node.loc),
            FUN: fun,
            OPTCALL: booleanLiteral(Boolean(path.node.optional)),
            ARGS: path.node.arguments
        }));
        path.skip();
    }

    function visitMethodCall(path: NodePath<CallExpression | OptionalCallExpression>, base: Expression, prop: Expression | Identifier, isDynamic: boolean, isOptMember: boolean) {
        path.replaceWith(METHODCALL({
            LOC: getLoc(path.node.loc),
            BASE: base,
            PROP: isDynamic ? prop : stringLiteral((prop as Identifier).name),
            DYN: booleanLiteral(isDynamic),
            OPTMEMBER: booleanLiteral(isOptMember),
            OPTCALL: booleanLiteral(Boolean(path.node.optional)),
            ARGS: path.node.arguments
        }));
        path.skip();
    }

    function visitSuperCall(path: NodePath<CallExpression>) {
        const constr = path.findParent(p => isClassMethod(p.node) && p.node.kind === "constructor");
        assert(constr);
        path.replaceWith(SUPER({
            LOC: getLoc(constr.node.loc),
            SUPER: path.node
        }));
        path.skip();

    }

    function visitPropertyOrMethod(path: NodePath<ObjectProperty | ObjectMethod | ClassProperty | ClassMethod>) {
        const computed = path.node.computed;
        if (!computed) {
            path.node.computed = true;
            if (isIdentifier(path.node.key))
                path.node.key = stringLiteral(path.node.key.name);
        }
        path.get("key").replaceWith(COMP({
            LOC: getLoc(path.node.loc),
            BODY: path.node.key,
            KIND: stringLiteral(isObjectMethod(path.node) || isClassMethod(path.node) ? path.node.kind : "field"),
            STATIC: booleanLiteral(isClassMethod(path.node) || isClassProperty(path.node) ? path.node.static : false),
            DYN: booleanLiteral(computed)
        }));
        path.skip();
    }

    function visitFunction(path: NodePath<Function>) {
        numStaticFunctions++;
        const isConstructor = isClassMethod(path.node) && path.node.kind === "constructor";
        const loc = isConstructor ? path.parentPath.parent.loc : path.node.loc;
        const e = ENTER({
            LOC: getLoc(loc)
        });
        if (isArrowFunctionExpression(path.node) && !isBlockStatement(path.node.body))
            path.get("body").replaceWith(blockStatement([expressionStatement(e), returnStatement(path.node.body)]));
        else {
            const body = (path.node.body as BlockStatement).body;
            if ((!isConstructor || !(path.parentPath?.parent as ClassDeclaration)?.superClass) && !isArrowFunctionExpression(path.node))
                body.unshift(expressionStatement(THIS({
                    LOC: getLoc(loc),
                    NEWTARGET: conditionalExpression(memberExpression(identifier("new"), identifier("target")), thisExpression(), nullLiteral())
                })));
            body.unshift(expressionStatement(e));
        }
    }

    function visitCatch(path: NodePath<CatchClause>) {
        let p: Identifier;
        if (isIdentifier(path.node.param))
            p = path.node.param;
        else {
            p = path.scope.generateUidIdentifier();
            if (isArrayPattern(path.node.param) || isObjectPattern(path.node.param))
                path.get("body").unshiftContainer("body", variableDeclaration("const", [variableDeclarator(path.node.param, identifier(p.name))]));
            path.node.param = p;
        }
        path.get("body").unshiftContainer("body", CATCH({
            ID: identifier(p.name)
        }));
    }

    function visitLoop(path: NodePath<Loop>) {
        path.get("body").replaceWith(LOOP({
            BODY: path.node.body
        }));
    }

    function visitRequireOrImport(path: NodePath<CallExpression | OptionalCallExpression>) {
        const arg = path.node.arguments[0];
        if (isStringLiteral(arg) && !Module.isBuiltin(arg.value)) // static require/import (excl. aliases)
            staticRequires?.add(arg.value);
        else { // dynamic require/import (excl. aliases)
            path.get("arguments")[0].replaceWith(REQUIRE({
                LOC: getLoc(path.node.loc),
                STR: arg
            }));
            path.skip();
        }
    }
}
