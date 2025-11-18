import {
    CallExpression,
    ExportAllDeclaration,
    ExportNamedDeclaration,
    File,
    ImportDeclaration,
    isIdentifier,
    isImport,
    isStringLiteral
} from "@babel/types";
import traverse, {NodePath} from "@babel/traverse";
import Module from "module";
import {ModuleInfo} from "./infos";
import {FragmentState} from "./fragmentstate";

/**
 * Scans AST for 'require', 'import' and 'export' only (no proper analysis).
 */
export function findModules(ast: File, f: FragmentState, moduleInfo: ModuleInfo) {

    function loadModule(mode: "commonjs" | "module", str: string, path: NodePath) { // see loadModule in operations.ts
        if (!Module.isBuiltin(str))
            f.loadModule(mode, str, path, moduleInfo);
    }

    traverse(ast, {

        CallExpression(path: NodePath<CallExpression>) {
            const imp = isImport(path.node.callee);
            if ((imp || (isIdentifier(path.node.callee) &&
                    path.node.callee.name === "require" &&
                    !path.scope.getBinding(path.node.callee.name))) &&
                path.node.arguments.length >= 1) {
                const arg = path.node.arguments[0];
                if (isStringLiteral(arg))
                    loadModule(imp ? "module" : "commonjs", arg.value, path);
                else
                    f.warnUnsupported(path.node, "Unhandled 'require'");
            }
        },

        ImportDeclaration(path: NodePath<ImportDeclaration>) {
            loadModule("module", path.node.source.value, path);
        },

        ExportAllDeclaration(path: NodePath<ExportAllDeclaration>) {
            loadModule("module", path.node.source.value, path);
        },

        ExportNamedDeclaration(path: NodePath<ExportNamedDeclaration>) {
            if (path.node.source)
                loadModule("module", path.node.source.value, path);
        }
    });
}