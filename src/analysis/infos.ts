import {FilePath, sourceLocationToString, strHash} from "../misc/util";
import {Function, Program} from "@babel/types";
import {sep} from "path";
import assert from "assert";

/**
 * Information about a package.
 */
export class PackageInfo {

    readonly name: string; // package name, "<main>" is used for entry files if no package.json is found

    readonly version: string | undefined; // package version, undefined if not available

    readonly main: string | undefined; // package main file, undefined if not available

    readonly dir: FilePath; // absolute path to representative package root directory, or current working directory if no package.json is found for the entry files (transient)

    readonly modules: Map<string, ModuleInfo> = new Map; // map from path relative to the package root to module info

    readonly directDependencies: Set<PackageInfo> = new Set; // the direct dependencies of this package

    readonly isEntry: boolean; // true for entry packages

    constructor(name: string, version: string | undefined, main: string | undefined, dir: FilePath, isEntry: boolean) {
        this.name = name;
        this.version = version;
        this.main = main;
        this.dir = dir;
        this.isEntry = isEntry;
    }

    toString(): string {
        return `${this.name}${this.version ? `@${this.version}` : ""}`;
    }
}

export function normalizeModuleName(s: string): string {
    return s.endsWith("/index.js") ? s.substring(0, s.length - 9) : // (ignoring index.json and index.node)
        s.endsWith(".js") ? s.substring(0, s.length - 3) :
            s.endsWith(".mjs") ? s.substring(0, s.length - 4) : s;
}

/**
 * Information about a module/file.
 */
export class ModuleInfo {

    readonly relativePath: string; // path relative to the package root

    readonly packageInfo: PackageInfo; // package containing this module

    readonly functions: Map<Function, FunctionInfo> = new Map; // functions directly inside this module

    readonly isEntry: boolean; // true for entry modules

    node: Program | undefined; // top-level source location (set by analyzeFiles)

    readonly hash: number;

    constructor(relativePath: string, packageInfo: PackageInfo, isEntry: boolean) {
        this.relativePath = relativePath;
        this.packageInfo = packageInfo;
        this.isEntry = isEntry;
        this.hash = strHash(this.toString());
    }

    toString(): string {
        return `${this.packageInfo}:${this.relativePath}`;
    }

    /**
     * Returns normalized file path of the representative file (different paths may refer to the same ModuleInfo).
     */
    getPath(): FilePath {
        assert(this.packageInfo.dir !== undefined);
        return `${this.packageInfo.dir}${sep}${this.relativePath}`;
    }

    /**
     * Returns the official name of this module, using the package name if the module is the main module,
     * and otherwise stripping /index.js, .js and .mjs.
     */
    getOfficialName(): string {
        if (this.relativePath === this.packageInfo.main)
            return this.packageInfo.name;
        return normalizeModuleName(`${this.packageInfo.name}/${this.relativePath}`);
    }
}

/**
 * Information about a module that is not being analyzed.
 */
export class DummyModuleInfo { // used for module files that can't be found (typically because they haven't been installed)

    readonly requireName: string;

    readonly normalizedRequireName: string; // require string (normalized but not resolved to a file)

    constructor(requireName: string) {
        this.requireName = requireName;
        this.normalizedRequireName = normalizeModuleName(requireName);
    }

    toString(): string {
        return `${this.normalizedRequireName}[unresolved]`;
    }

    getOfficialName(): string {
        return this.normalizedRequireName;
    }
}

/**
 * Information about a function.
 */
export class FunctionInfo {

    readonly name: string | undefined; // function name

    readonly node: Function; // function source location

    readonly moduleInfo: ModuleInfo; // module containing this function

    readonly functions: Map<Function, FunctionInfo> = new Map; // functions directly inside this function

    get packageInfo(): PackageInfo {
        return this.moduleInfo.packageInfo;
    }

    constructor(name: string | undefined, node: Function, moduleInfo: ModuleInfo) {
        this.name = name;
        this.node = node;
        this.moduleInfo = moduleInfo;
    }

    toString() {
        return `${this.moduleInfo}:${sourceLocationToString(this.node.loc)}:${this.name ?? "<anonymous>"}`;
    }
}
