import * as ts from "typescript";
import {FilePath} from "../misc/util";

const options = { // TODO: get options from tsconfig.json if available? (see typeinferrer.ts)
    module: ts.ModuleKind.NodeNext,
    allowJs: true,
    checkJs: true,
    noDtsResolution: true // if not enabled, .d.ts files take priority over .js files
};

const host = ts.createCompilerHost(options);

/**
 * Resolves a module name using the TypeScript compiler.
 * @param str module name
 * @param file current file path
 * @return resolved file path if successful
 * @throws exception if the module is not found
 */
export function tsResolveModuleName(str: string, file: FilePath): FilePath {
    const resolutionMode = ts.getImpliedNodeFormatForFile(file as ts.Path, undefined, host, options);
    const t = str.endsWith(".ts") ? str.substring(0, str.length - 3) : str;
    const filepath = ts.resolveModuleName(t, file, options, host, undefined, undefined, resolutionMode).resolvedModule?.resolvedFileName;
    if (!filepath)
        throw new Error;
    return filepath;
}
