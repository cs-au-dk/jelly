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
import {FilePath, sourceLocationToStringWithFile} from "../misc/util";
import traverse, {NodePath} from "@babel/traverse";
import logger from "../misc/logger";
import Solver from "./solver";
import {options} from "../options";
import {builtinModules} from "../natives/nodejs";
import {requireResolve} from "../misc/files";

/**
 * Scans AST for 'require', 'import' and 'export' only (no proper analysis).
 */
export function findModules(ast: File, file: FilePath, solver: Solver) {
    const a = solver.analysisState;

    function requireModule(str: string, path: NodePath) { // see requireModule in operations.ts
        if (!(builtinModules.has(str) || (str.startsWith("node:") && builtinModules.has(str.substring(5)))))
            try {
                const filepath = requireResolve(str, file, path.node.loc, a);
                if (filepath)
                    a.reachedFile(filepath, path.getFunctionParent()?.node ?? file);
            } catch {
                if (options.ignoreUnresolved || options.ignoreDependencies) {
                    if (logger.isVerboseEnabled())
                        logger.verbose(`Ignoring unresolved module '${str}' at ${sourceLocationToStringWithFile(path.node.loc)}`);
                } else// TODO: special warning if the require/import is placed in a try-block, an if statement, or a switch case?
                    a.warn(`Unable to resolve module '${str}' at ${sourceLocationToStringWithFile(path.node.loc)}`);
            }
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
                    a.error(`Unhandled 'require' at ${sourceLocationToStringWithFile(path.node.loc)}`);
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