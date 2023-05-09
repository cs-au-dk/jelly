import {Class, Function, Identifier, isNode, Node} from "@babel/types";
import {FilePath, getOrSet, sourceLocationToString, SourceLocationWithFilename} from "../misc/util";
import {ConstraintVar, NodeVar} from "./constraintvars";
import {Token} from "./tokens";
import {getPackageJsonInfo, PackageJsonInfo} from "../misc/packagejson";
import {AccessPath, IgnoredAccessPath, UnknownAccessPath} from "./accesspaths";
import Timer from "../misc/timer";
import {VulnerabilityDetector} from "../patternmatching/vulnerabilitydetector";
import {SpecialNativeObjects} from "../natives/nativebuilder";
import {DummyModuleInfo, FunctionInfo, ModuleInfo, PackageInfo} from "./infos";
import assert from "assert";
import {NodePath} from "@babel/traverse";
import {dirname, relative, resolve} from "path";
import {options} from "../options";
import logger from "../misc/logger";

/**
 * Global analysis state.
 */
export class GlobalState {

    /**
     * Map from constraint variable string hash to canonical ConstraintVar object.
     */
    readonly canonicalConstraintVars: Map<string, ConstraintVar> = new Map;

    /**
     * Map from AST node to canonical NodeVar object.
     */
    readonly canonicalNodeVars: WeakMap<Node, NodeVar> = new WeakMap;

    /**
     * Map from token string hash to canonical Token object.
     */
    readonly canonicalTokens: Map<string, Token> = new Map;

    /**
     * Map from access path string hash to canonical AccessPath object.
     */
    readonly canonicalAccessPaths: Map<string, AccessPath> = new Map;

    /**
     * Canonical global identifiers.
     */
    readonly canonicalGlobals: Map<string, Identifier> = new Map;

    /**
     * Map from "name@version" to package info, "<main>" is used for entry files if no package.json is found.
     */
    readonly packageInfos: Map<string, PackageInfo> = new Map;

    /**
     * Map from normalized module path to ModuleInfo.
     * Note: different paths may refer to the same ModuleInfo! (if they belong to the same package and version)
     */
    readonly moduleInfosByPath: Map<FilePath, ModuleInfo> = new Map;

    /**
     * Map from module name to ModuleInfo.
     */
    readonly moduleInfos: Map<string, ModuleInfo> = new Map;

    /**
     * Set of DummyModuleInfos created (for module files that haven't been found).
     */
    readonly dummyModuleInfos: Map<string, DummyModuleInfo> = new Map;

    /**
     * Map from Function AST object to FunctionInfo.
     */
    readonly functionInfos: Map<Function, FunctionInfo> = new Map;

    /**
     * Entry files.
     */
    readonly entryFiles: Set<FilePath> = new Set;

    /**
     * Files reached during analysis.
     */
    readonly reachedFiles: Set<FilePath> = new Set;

    /**
     * Files reached and waiting to be analyzed.
     */
    readonly pendingFiles: Array<FilePath> = [];

    /**
     * Files that could not be parsed.
     */
    readonly filesWithParseErrors: Array<FilePath> = [];

    /**
     * Files that have been analyzed (without parse error).
     */
    readonly filesAnalyzed: Array<FilePath> = [];

    /**
     * Timeout timer.
     */
    readonly timeoutTimer = new Timer;

    /**
     * Cache of PackageJsonInfos.
     */
    readonly packageJsonInfos = new Map<FilePath, PackageJsonInfo>();

    /**
     * Number of calls to canonicalizeVar.
     */
    numberOfCanonicalizeVarCalls = 0;

    /**
     * Number of calls to canonicalizeToken.
     */
    numberOfCanonicalizeTokenCalls = 0;

    /**
     * Number of calls to canonicalizeAccessPath.
     */
    numberOfCanonicalizeAccessPathCalls = 0;

    /**
     * Dynamic analysis time.
     */
    dynamicAnalysisTime: number = 0;

    /**
     * Vulnerability information, only used if options.vulnerabilities is set.
     */
    vulnerabilities: VulnerabilityDetector | undefined;

    /**
     * Native objects that are shared for all modules.
     */
    globalSpecialNatives: SpecialNativeObjects | undefined;

    constructor() {
        this.canonicalizeAccessPath(IgnoredAccessPath.instance);
        this.canonicalizeAccessPath(UnknownAccessPath.instance);
    }

    /**
     * Returns the canonical representative of the given constraint variable (possibly the given one).
     */
    canonicalizeVar<T extends ConstraintVar>(v: T): T {
        this.numberOfCanonicalizeVarCalls++;
        if (v instanceof NodeVar)
            return getOrSet(this.canonicalNodeVars, v.node, () => v) as unknown as T;
        else
            return getOrSet(this.canonicalConstraintVars, v.toString(), () => v) as T;
    }

    /**
     * Returns the canonical representative of the given token (possibly the given one).
     */
    canonicalizeToken<T extends Token>(t: T): T {
        this.numberOfCanonicalizeTokenCalls++;
        return getOrSet(this.canonicalTokens, t.toString(), () => t) as T;
    }

    /**
     * Returns the canonical representative of the given access path (possibly the given one).
     */
    canonicalizeAccessPath<T extends AccessPath>(t: T): T {
        this.numberOfCanonicalizeAccessPathCalls++;
        return getOrSet(this.canonicalAccessPaths, t.toString(), () => t) as T;
    }

    /**
     * Returns the ModuleInfo of the given module.
     */
    getModuleInfo(file: FilePath): ModuleInfo {
        const m = this.moduleInfosByPath.get(file);
        if (!m)
            assert.fail(`ModuleInfo for ${file} not found`);
        return m;
    }

    /**
     * Registers a new FunctionInfo for a function/method/constructor.
     */
    registerFunctionInfo(file: FilePath, path: NodePath<Function | Class>, name: string | undefined, fun: Function) {
        const m = this.moduleInfosByPath.get(file)!;
        const f = new FunctionInfo(name, fun, m);
        this.functionInfos.set(fun, f);
        const parent = path.getFunctionParent()?.node;
        (parent ? this.functionInfos.get(parent)!.functions : m.functions).add(f);
        if (this.vulnerabilities)
            this.vulnerabilities.reachedFunction(path, f); // TODO: move to FragmentState?
    }

    /**
     * Records that the given file has been reached, and returns its ModuleInfo.
     */
    reachedFile(tofile: FilePath, from?: ModuleInfo): ModuleInfo {
        let moduleInfo;
        if (this.reachedFiles.has(tofile))
            moduleInfo = this.moduleInfosByPath.get(tofile)!;
        else {

            // find package.json and extract name, version, and main file
            const p = getOrSet(this.packageJsonInfos, dirname(tofile), () => getPackageJsonInfo(tofile));
            const rel = relative(p.dir, tofile);

            // find or create PackageInfo
            let packageInfo = this.packageInfos.get(p.packagekey);
            let otherfile: string | undefined;
            if (!packageInfo) {

                // package has not been reached before (also not in another directory)
                packageInfo = new PackageInfo(p.name, p.version, p.main, p.dir, from === undefined);
                this.packageInfos.set(p.packagekey, packageInfo);
                if (!options.modulesOnly && options.printProgress && logger.isVerboseEnabled())
                    logger.verbose(`Reached package ${packageInfo} at ${p.dir}`);
                if (this.vulnerabilities)
                    this.vulnerabilities.reachedPackage(packageInfo);

            } else {

                // package has been reached before, but maybe in another directory, so look for ModuleInfo there
                otherfile = resolve(packageInfo.dir, rel);
                moduleInfo = this.moduleInfosByPath.get(otherfile);
            }

            if (moduleInfo) {

                // modules has been reached before in another directory
                if (logger.isVerboseEnabled())
                    logger.verbose(`${moduleInfo} already encountered in another directory`);
            } else {

                // module has not been reached before, create new ModuleInfo
                moduleInfo = new ModuleInfo(rel, packageInfo, from === undefined);
                packageInfo.modules.set(rel, moduleInfo);

                // record that module has been reached
                this.reachedFiles.add(tofile);
                if (from && options.ignoreDependencies)
                    logger.info(`Ignoring module ${moduleInfo}`);
                else
                    this.pendingFiles.push(tofile);
                if (this.vulnerabilities)
                    this.vulnerabilities.reachedModule(moduleInfo);

                // if the package was reached before in another directory, record the ModuleInfo for the file in that directory
                if (otherfile)
                    this.moduleInfosByPath.set(otherfile, moduleInfo);
            }

            // record the ModuleInfo for the given file
            this.moduleInfosByPath.set(tofile, moduleInfo);
            this.moduleInfos.set(moduleInfo.toString(), moduleInfo);
        }

        // unless this is an entry file, extend the package dependencies and dependents
        if (from) {
            const pf = from.packageInfo;
            const pt = this.moduleInfosByPath.get(tofile)!.packageInfo;
            if (pf !== pt && !pf.directDependencies.has(pt)) {
                pf.directDependencies.add(pt);
                if (logger.isVerboseEnabled())
                    logger.verbose(`Package ${pf} depends on ${pt}`);
            }
        }
        return moduleInfo;
    }

    /**
     * Finds the nearest enclosing function or module.
     */
    getEnclosingFunctionOrModule(path: NodePath, moduleInfo: ModuleInfo): FunctionInfo | ModuleInfo {
        const p = path.getFunctionParent()?.node;
        const caller = p ? this.functionInfos.get(p)! : moduleInfo;
        if (!caller)
            assert.fail(`Function/module info not found at ${moduleInfo}:${sourceLocationToString(path.node.loc)}!?!`);
        return caller;
    }

    /**
     * Finds the module or package that the given constraint variable belongs to,
     * returns undefined for constraint variables that do not belong to a specific package.
     */
    getConstraintVarParent(v: ConstraintVar): PackageInfo | ModuleInfo | undefined {
        const p = v.getParent();
        if (isNode(p) || (p && "loc" in p && p.loc))
            return this.moduleInfosByPath.get((p.loc as SourceLocationWithFilename).filename);
        return undefined;
    }
}
