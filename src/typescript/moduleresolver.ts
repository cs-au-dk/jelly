import {FilePath} from "../misc/util";
import * as path from "path";
import ts from "typescript";

interface Project {
    options: ts.CompilerOptions;
    cache: ts.ModuleResolutionCache;
    host: ts.ModuleResolutionHost;
    configDir: string;
}

/**
 * Resolves module names using the TypeScript compiler.
 */
export class TSModuleResolver {

    private projects = new Map<string, Project>();

    private fileToConfig = new Map<FilePath, FilePath | null>();

    private results = new Map<string, FilePath>();

    private canonical = ts.sys.useCaseSensitiveFileNames ?
        (s: string) => s :
        (s: string) => s.toLowerCase();

    resolveModuleName(spec: string, file: FilePath): FilePath {
        const abs = path.resolve(file);
        const key = `${abs}::${spec}`;
        const cached = this.results.get(key);
        if (cached)
            return cached;
        const project = this.getProject(abs);
        const res = ts.resolveModuleName(spec, abs, project.options, project.host, project.cache).resolvedModule;
        if (!res)
            throw new Error(`Cannot resolve "${spec}" from "${file}"`);
        this.results.set(key, res.resolvedFileName);
        return res.resolvedFileName;
    }

    private getProject(file: FilePath): Project {
        const configPath = this.getConfigPath(file);
        const key = configPath ?? "__no_config__";
        const existing = this.projects.get(key);
        if (existing)
            return existing;
        const {options, configDir} = configPath ?
            this.loadTsConfig(configPath) :
            { options: {} as ts.CompilerOptions, configDir: ts.sys.getCurrentDirectory() };
        const host: ts.ModuleResolutionHost = {
            ...ts.sys,
            fileExists: (fn) => {
                if (fn.endsWith(".d.ts"))
                    return false; // hide .d.ts files (in libraries and in application code) from resolver
                if (fn.includes(`${path.sep}node_modules${path.sep}`))
                    if (/\.(ts|tsx|mts|cts)$/.test(fn))
                        return false; // hide TS files in libraries from resolver
                return ts.sys.fileExists(fn);
            }
        };
        const cache = ts.createModuleResolutionCache(configDir, this.canonical, options);
        const project = {options, cache, host, configDir};
        this.projects.set(key, project);
        return project;
    }

    private getConfigPath(file: FilePath): FilePath | null {
        const cached = this.fileToConfig.get(file);
        if (cached !== undefined)
            return cached;
        const dir = path.dirname(file);
        const found = ts.findConfigFile(dir, ts.sys.fileExists) ?? null;
        this.fileToConfig.set(file, found);
        return found;
    }

    private loadTsConfig(configPath: string) {
        const configDir = path.dirname(configPath);
        const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
        if (loaded.error)
            throw new Error(ts.formatDiagnostics([loaded.error], {
                getCanonicalFileName: this.canonical,
                getCurrentDirectory: ts.sys.getCurrentDirectory,
                getNewLine: () => ts.sys.newLine
            }));
        const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, configDir);
        return {options: parsed.options, configDir};
    }
}
