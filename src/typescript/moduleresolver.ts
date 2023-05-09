import * as ts from "typescript";
import {FilePath} from "../misc/util";

const options = { // TODO: get options from tsconfig.json if available? (see typeinferrer.ts)
    target: ts.ScriptTarget.ES5,
    module: ts.ModuleKind.CommonJS,
    allowJs: true,
    checkJs: true,
    noDtsResolution: true // if not enabled, .d.ts files take priority over .js files
}; // TODO: set typeRoots to options.basedir?

const host = ts.createCompilerHost(options);

/**
 * Resolves a module name using the TypeScript compiler.
 * @param str module name
 * @param file current file path
 * @return resolved file path if successful
 * @throws exception if the module is not found
 */
export function tsResolveModuleName(str: string, file: FilePath): FilePath {
    const t = str.endsWith(".ts") ? str.substring(0, str.length - 3) : str;
    const filepath = ts.resolveModuleName(t, file, options, host).resolvedModule?.resolvedFileName;
    if (!filepath)
        throw new Error(`Module ${str} not found`);
    return filepath;
}
