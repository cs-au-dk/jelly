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
import {FilePath} from "../misc/util";
import traverse, {NodePath} from "@babel/traverse";
import Module from "module";
import {ModuleInfo} from "./infos";
import {FragmentState} from "./fragmentstate";

/**
 * Scans AST for 'require', 'import' and 'export' only (no proper analysis).
 */
export function findModules(ast: File, file: FilePath, f: FragmentState, moduleInfo: ModuleInfo) {

    function requireModule(str: string, path: NodePath) { // see requireModule in operations.ts
        if (!Module.isBuiltin(str))
            f.requireModule(str, path, file, moduleInfo)
    }

    traverse(ast, {

        CallExpression(path: NodePath<CallExpression>) {
            if (((isIdentifier(path.node.callee) &&
                        path.node.callee.name === "require" &&
                        !path.scope.getBinding(path.node.callee.name)) ||
                    isImport(path.node.callee)) &&
                path.node.arguments.length >= 1) {
                const arg = path.node.arguments[0];
                if (isStringLiteral(arg))
                    requireModule(arg.value, path);
                else
                    f.warnUnsupported(path.node, "Unhandled 'require'");
            }
        },

        ImportDeclaration(path: NodePath<ImportDeclaration>) {
            requireModule(path.node.source.value, path);
        },

        ExportAllDeclaration(path: NodePath<ExportAllDeclaration>) {
            requireModule(path.node.source.value, path);
        },

        ExportNamedDeclaration(path: NodePath<ExportNamedDeclaration>) {
            if (path.node.source)
                requireModule(path.node.source.value, path);
        }
    });
}