import {File} from "@babel/types";
import logger from "../misc/logger";
import {transformFromAstSync} from "@babel/core";
import {parse, ParserOptions} from "@babel/parser";
import {replaceTypeScriptImportExportAssignmentsAndAddConstructors} from "./extras";
import {FragmentState} from "../analysis/fragmentstate";

/**
 * Parses and desugars the given file.
 * @param str the contents of the file
 * @param file the name of the file
 * @param f analysis state object (if undefined then onlyRemoveTypeImports and allowDeclareFields are disabled)
 * @return AST, or null if error occurred
 */
export function parseAndDesugar(str: string, file: string, f?: FragmentState): File | null {

    // parse the file
    let originalAst: File;
    try {
        const options: ParserOptions = {
            sourceFilename: file,
            allowImportExportEverywhere: true,
            allowAwaitOutsideFunction: true,
            allowReturnOutsideFunction: true,
            allowSuperOutsideMethod: true,
            allowUndeclaredExports: true,
            errorRecovery: true,
            attachComment: false,
            createParenthesizedExpressions: true,
            sourceType: "unambiguous",
            tokens: true, // required for locations of artificial initializers for static computed class properties
            plugins: [
                "typescript",
                "exportDefaultFrom", // https://github.com/leebyron/ecmascript-export-default-from
                ["decorators", { decoratorsBeforeExport: false }] // TODO: decorators?
            ]
        };
        try {
            originalAst = parse(str, options);
        } catch (e) { // 'jsx' conflicts with TypeScript legacy cast syntax, see https://babeljs.io/docs/en/babel-plugin-transform-typescript/
            if (logger.isVerboseEnabled())
                logger.verbose(`Parse error for ${file}${e instanceof Error ? `: ${e.message}` : ""}, retrying with JSX and Flow enabled`);
            options.plugins!.push("jsx");
            if (file.endsWith(".jsx") || file.endsWith(".js")) {
                options.plugins!.push("flow");
                options.plugins!.splice(options.plugins?.indexOf("typescript")!, 1); // 'flow' conflicts with 'typescript'
            }
            originalAst = parse(str, options);
        }
    } catch (e) {
        f?.error(`Unrecoverable parse error for ${file}${e instanceof Error ? `: ${e.message}` : ""}`);
        return null;
    }

    // apply Babel transformations
    let res;
    const p = Error.prepareStackTrace;
    const cw = console.warn;
    console.warn = function() {}; // throw away warnings from babel-plugin-transform-typescript
    try {
        res = transformFromAstSync(originalAst, str, {
            plugins: [
                replaceTypeScriptImportExportAssignmentsAndAddConstructors,
                ["@babel/plugin-transform-typescript", {
                    onlyRemoveTypeImports: f !== undefined,
                    allowDeclareFields: f !== undefined
                }],
                ["@babel/plugin-transform-template-literals", { loose: true }]
            ], // TODO: perform other transformations?
            cwd: __dirname,
            configFile: false,
            ast: true,
            code: logger.isDebugEnabled()
        });
    } catch (e) {
        f?.error(`Babel transformation failed for ${file}${e instanceof Error ? `: ${e.message}` : ""}`);
        return null;
    } finally {
        Error.prepareStackTrace = p; // Babel replaces prepareStackTrace, --enable-source-maps needs the original
        console.warn = cw;
    }
    if (!res) {
        f?.error(`Babel transformation failed silently for ${file}`);
        return null;
    }
    if (res.code) // set 'code: true' above to output desugared code
        if (logger.isDebugEnabled())
            logger.debug("Desugared code:\n" + res.code);

    return res.ast!;
}
