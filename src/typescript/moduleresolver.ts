import {basename, dirname, join} from "node:path";
import fs from "node:fs";
import ts from "typescript";
import {FilePath} from "../misc/util";
import {options} from "../options";
import logger from "../misc/logger";

const host = ts.createCompilerHost({});

const parseConfigHost: ts.ParseConfigHost = {
    fileExists: host.fileExists,
    readDirectory: ts.sys.readDirectory,
    readFile: host.readFile,
    useCaseSensitiveFileNames: host.useCaseSensitiveFileNames(),
};

/**
 * Resolves module names using the TypeScript compiler.
 * The class caches lookups for tsconfig.json files.
 */
export class TSModuleResolver {
    // maps directories to compiler options or undefined
    private readonly tsconfigCache = new Map<FilePath, ts.CompilerOptions>();

    private getTSOptions(file: FilePath): ts.CompilerOptions {
        let opts: ts.CompilerOptions = {
            module: ts.ModuleKind.NodeNext,
        };

        // find the nearest tsconfig.json file
        // TODO: perhaps we should only use tsconfig.json options when resolving from TypeScript files?
        const misses = [];
        let dir = file;
        while ((dir = dirname(dir)).startsWith(options.basedir)) {
            const cached = this.tsconfigCache.get(dir);
            if (cached !== undefined) {
                opts = cached;
                break;
            }

            misses.push(dir);

            const tsconfig = join(dir, "tsconfig.json");
            if (fs.existsSync(tsconfig)) {
                const res = ts.readConfigFile(tsconfig, host.readFile);
                if (!res.error)
                    opts = ts.parseJsonConfigFileContent(res.config, parseConfigHost, dir).options;
                else
                    logger.warn(`Warning: Unable to read ${tsconfig} (${ts.formatDiagnostic(res.error, host)})`);

                break;
            }

            // stop at the filesystem root or when traversing a node_modules directory
            if (dir == dirname(dir) || basename(dir) === "node_modules")
                break;
        }

        // opts.traceResolution = true;
        opts.allowJs = true;
        opts.checkJs = true;
        opts.noDtsResolution = true; // if not enabled, .d.ts files take priority over .js files

        // populate cache
        for (const miss of misses)
            this.tsconfigCache.set(miss, opts);

        return opts;
    }

    /**
     * Resolves a module name using the TypeScript compiler.
     * @param str module name
     * @param file current file path
     * @return resolved file path if successful
     * @throws exception if the module is not found
     */
    resolveModuleName(str: string, file: FilePath): FilePath {
        const opts = this.getTSOptions(file);
        const resolutionMode = ts.getImpliedNodeFormatForFile(file as ts.Path, undefined, host, opts);
        const t = str.endsWith(".ts") && resolutionMode !== ts.ModuleKind.ESNext ? str.substring(0, str.length - 3) : str;
        const filepath = ts.resolveModuleName(t, file, opts, host, undefined, undefined, resolutionMode).resolvedModule?.resolvedFileName;
        // TS does not always respect noDtsResolution=true when the enclosing package has a 'typesVersions' field
        if (!filepath || (filepath.endsWith(".d.ts") && !str.endsWith(".d.ts")))
            throw new Error();
        return filepath;
    }
}
