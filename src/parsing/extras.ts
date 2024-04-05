import {NodePath, PluginObj} from '@babel/core';
import {TemplateBuilder} from '@babel/template';
import {
    addComment,
    blockStatement,
    BlockStatement,
    callExpression,
    ClassDeclaration,
    ClassExpression,
    ClassMethod,
    classMethod,
    expressionStatement,
    File,
    Identifier,
    identifier,
    isCallExpression,
    isClassMethod,
    isClassPrivateMethod,
    isClassPrivateProperty,
    isClassProperty,
    isIdentifier,
    isImportSpecifier,
    isJSXAttribute,
    isJSXIdentifier,
    isJSXMemberExpression,
    isMemberExpression,
    isObjectMethod,
    isObjectProperty,
    isOptionalMemberExpression,
    isSuper,
    isTSExternalModuleReference,
    Node,
    Program,
    restElement,
    RestElement,
    SourceLocation,
    spreadElement,
    super as _super,
    TSExportAssignment,
    TSImportEqualsDeclaration,
    variableDeclaration,
    variableDeclarator
} from '@babel/types';
import traverse from "@babel/traverse";
import logger from "../misc/logger";
import {getClass} from "../misc/asthelpers";
import assert from "assert";
import {Location} from "../misc/util";
import {ModuleInfo} from "../analysis/infos";

/**
 * Replaces TypeScript "export =" and "import =" syntax and creates default constructors.
 * See https://babeljs.io/docs/en/babel-plugin-transform-typescript/#caveats
 * and https://www.typescriptlang.org/docs/handbook/modules.html#export--and-import--require
 */
export function replaceTypeScriptImportExportAssignmentsAndAddConstructors({ template }: {template: TemplateBuilder<TSExportAssignment>}): PluginObj {
    const moduleExportsDeclaration = template("module.exports = ASSIGNMENT;");
    const moduleImportsDeclaration = template("var ID = require(MODULE);");
    return {
        visitor: {
            TSExportAssignment(path: NodePath<TSExportAssignment>) {
                path.replaceWith(moduleExportsDeclaration({
                    ASSIGNMENT: path.node.expression
                }));
            },
            TSImportEqualsDeclaration(path: NodePath<TSImportEqualsDeclaration>) {
                if (!path.node.isExport && path.node.importKind === "value" && isTSExternalModuleReference(path.node.moduleReference)) {
                    path.replaceWith(moduleImportsDeclaration({
                        ID: path.node.id,
                        MODULE: path.node.moduleReference.expression
                    }));
                    path.scope.registerDeclaration(path);
                }
                // TODO: handle other forms of TSImportEqualsDeclaration?
            },
            Class(path: NodePath<ClassExpression | ClassDeclaration>) {
                for (const b of path.node.body.body)
                    if ((isClassMethod(b) || isClassPrivateMethod(b)) && b.kind === "constructor")
                        return;
                let params: Array<Identifier | RestElement>, body: BlockStatement;
                if (path.node.superClass) {
                    params = [
                        identifier("p1"),
                        identifier("p2"),
                        identifier("p3"),
                        identifier("p4"),
                        identifier("p5"),
                        restElement(identifier("rest"))
                    ];
                    body = blockStatement([expressionStatement(callExpression(_super(), [
                        identifier("p1"),
                        identifier("p2"),
                        identifier("p3"),
                        identifier("p4"),
                        identifier("p5"),
                        spreadElement(identifier("rest"))
                    ]))]);
                } else {
                    params = [];
                    body = blockStatement([]);
                }
                const c = classMethod("constructor", identifier("constructor"), params, body);
                addComment(body, "leading", "JELLY_DEFAULT");
                path.get("body").unshiftContainer("body", c);
            }
        }
    };
}

export function isDummyConstructor(c: Node | undefined): boolean {
    return isClassMethod(c) && c.kind === "constructor" && c.body.leadingComments?.[0].value == "JELLY_DEFAULT";
}

export const JELLY_NODE_ID = Symbol("JELLY_NODE_ID");

/**
 * Preprocesses the given AST.
 */
export function preprocessAst(ast: File, module?: ModuleInfo, globals?: Array<Identifier>, globalsHidden?: Array<Identifier>) {
    let nextNodeID = 0;

    function register(n: Node) {
        (n as any)[JELLY_NODE_ID] = nextNodeID++;
    }

    // assign unique index to each identifier in globals and globalsHidden
    if (globals && globalsHidden)
        for (const n of [...globals, ...globalsHidden])
            register(n);

    // artificially declare all native globals in the program scope (if not already declared)
    if (globals)
        traverse(ast, {
            Program(path: NodePath<Program>) {
                const decls = globals.filter(d => path.scope.getBinding(d.name) === undefined)
                    .map(id => {
                        const d = variableDeclarator(id);
                        d.loc = id.loc;
                        return d;
                    });
                const d = variableDeclaration("var", decls);
                (d.loc as Location) = {start: {line: 0, column: 0}, end: {line: 0, column: 0}, native: "%ecmascript"};
                path.scope.registerDeclaration(path.unshiftContainer("body", d)[0]);
                path.stop();
            }
        });

    traverse(ast, {
        enter(path: NodePath) {
            const n = path.node;

            // assign unique index to each node (globals and globalsHidden are handled above)
            if ((n as any)[JELLY_NODE_ID] === undefined)
                register(n);

            // workaround to ensure that AST nodes with undefined location (caused by desugaring) can be identified uniquely
            if (!n.loc) {
                let p = path;
                while (!p.node.loc) {
                    assert(p.parentPath);
                    p = p.parentPath;
                }
                n.loc = {start: p?.node.loc?.start, end: p?.node.loc?.end, nodeIndex: (n as any)[JELLY_NODE_ID]} as unknown as SourceLocation; // see locationToString
            }

            // set module (if not already set and not native)
            if (module && (n.loc as Location).module === undefined && (n.loc as Location).native === undefined)
                (n.loc as Location).module = module;

            // workarounds to match dyn.ts source locations
            if (((isClassMethod(n) || isClassPrivateMethod(n)) && n.kind === "constructor") ||
                (isCallExpression(n) && isSuper(n.callee) && isDummyConstructor(path.findParent(p =>
                    isClassMethod(p.node))?.node as ClassMethod | undefined))) {
                // for constructors and artificial super calls, use the class source location
                const cls = getClass(path);
                assert(cls);
                n.loc = cls.loc;
            } else if ((isClassMethod(n) || isClassPrivateMethod(n) || isClassPrivateProperty(n)) && n.static) {
                // for static methods and properties, use the identifier start location
                assert(n.loc && n.key.loc);
                n.loc.start = n.key.loc!.start;
            }

            // add bindings in global scope for identifiers with missing binding
            if (module &&
                (isIdentifier(n) || isJSXIdentifier(n)) &&
                n.name !== "arguments" && !path.scope.getBinding(n.name) &&
                !((isMemberExpression(path.parent) || isOptionalMemberExpression(path.parent) || isJSXMemberExpression(path.parent)) &&
                    path.parent.property === path.node) &&
                !(isObjectProperty(path.parent) && path.parent.key === n) &&
                !(isObjectMethod(path.parent) && path.parent.key === n) &&
                !(isClassProperty(path.parent) && path.parent.key === n) &&
                !(isClassMethod(path.parent) && path.parent.key === n) &&
                !isImportSpecifier(path.parent) &&
                !isJSXAttribute(path.parent)) {
                const ps = path.scope.getProgramParent();
                if (!ps.getBinding(n.name)?.identifier) {
                    const d = identifier(n.name);
                    (d.loc as Location) = {start: {line: 0, column: 0}, end: {line: 0, column: 0}, module, unbound: true}; // unbound used by expVar
                    register(d);
                    ps.push({id: d});
                    if (logger.isDebugEnabled())
                        logger.debug(`No binding for identifier ${n.name} (parent: ${path.parent.type}), creating one in program scope`);
                }
            }
        }
    });
}
