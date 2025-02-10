import {Function, Identifier, Node} from "@babel/types";
import {FilePath, getOrSet, Location, locationToStringWithFile, strHash} from "../misc/util";
import {
    AncestorsVar,
    ArgumentsVar,
    ConstraintVar,
    FunctionReturnVar,
    NodeVar,
    ObjectPropertyVarObj,
    ThisVar
} from "./constraintvars";
import {AccessPathToken, NativeObjectToken, Token} from "./tokens";
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
import {TSModuleResolver} from "../typescript/moduleresolver";
import {ProcessManager} from "../approx/processmanager";
import {Patching} from "../approx/patching";
import {isDummyConstructor} from "../parsing/extras";
import {getEnclosingFunction} from "../misc/asthelpers";

/**
 * Global analysis state.
 */
export class GlobalState {

    /**
     * Map from constraint variable string hash to canonical ConstraintVar object.
     */
    readonly canonicalConstraintVars: Map<string, ConstraintVar> = new Map;

    private canonicalAncestorVars: WeakMap<ObjectPropertyVarObj, AncestorsVar> = new WeakMap;

    private canonicalReturnVar: WeakMap<Function, FunctionReturnVar> = new WeakMap;

    private canonicalThisVar: WeakMap<Function, ThisVar> = new WeakMap;

    private canonicalArgumentsVar: WeakMap<Function, ThisVar> = new WeakMap;

    /**
     * Map from AST node to canonical NodeVar object.
     */
    readonly canonicalNodeVars: WeakMap<Node, NodeVar> = new WeakMap;

    /**
     * Map from token string hash to canonical Token object.
     */
    readonly canonicalTokens: Map<string, Token> = new Map;

    private canonicalUnknownAccessPathToken: AccessPathToken | undefined;

    private canonicalIgnoredAccessPathToken: AccessPathToken | undefined;

    private canonicalNativeObjectTokens: Map<string, NativeObjectToken> = new Map;

    /**
     * Map from access path string hash to canonical AccessPath object.
     */
    readonly canonicalAccessPaths: Map<string, AccessPath> = new Map;

    /**
     * Canonical global identifiers (excluding module-specific).
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
     * TSModuleResolver instance which caches lookups of tsconfig.json files.
     */
    readonly tsModuleResolver = new TSModuleResolver();

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
     * Vulnerability information, only used if options.vulnerabilities is set.
     */
    vulnerabilities: VulnerabilityDetector | undefined; // TODO: move to FragmentState?

    /**
     * Native objects that are shared for all modules.
     */
    globalSpecialNatives: SpecialNativeObjects | undefined;

    approx: ProcessManager | undefined;

    patching: Patching | undefined;

    /**
     * Returns the canonical representative of the given constraint variable (possibly the given one).
     */
    canonicalizeVar<T extends ConstraintVar>(v: T): T {
        if (v instanceof NodeVar)
            return getOrSet(this.canonicalNodeVars, v.node, () => v) as unknown as T;
        else if (v instanceof AncestorsVar)
            return getOrSet(this.canonicalAncestorVars, v.t, () => v) as unknown as T;
        else if (v instanceof FunctionReturnVar)
            return getOrSet(this.canonicalReturnVar, v.fun, () => v) as unknown as T;
        else if (v instanceof ThisVar)
            return getOrSet(this.canonicalThisVar, v.fun, () => v) as unknown as T;
        else if (v instanceof ArgumentsVar)
            return getOrSet(this.canonicalArgumentsVar, v.fun, () => v) as unknown as T;
        this.numberOfCanonicalizeVarCalls++;
        return getOrSet(this.canonicalConstraintVars, v.toString(), () => v) as T;
    }

    /**
     * Returns the canonical representative of the given token (possibly the given one).
     */
    canonicalizeToken<T extends Token>(t: T): T {
        if (t instanceof AccessPathToken) {
            if (t.ap === UnknownAccessPath.instance) {
                if (!this.canonicalUnknownAccessPathToken) {
                    t.hash = strHash(t.toString());
                    this.canonicalUnknownAccessPathToken = t;
                }
                return this.canonicalUnknownAccessPathToken as unknown as T;
            }
            if (t.ap === IgnoredAccessPath.instance) {
                if (!this.canonicalIgnoredAccessPathToken) {
                    t.hash = strHash(t.toString());
                    this.canonicalIgnoredAccessPathToken = t;
                }
                return this.canonicalIgnoredAccessPathToken as unknown as T;
            }
        } else if (t instanceof NativeObjectToken && !t.moduleInfo)
            return getOrSet(this.canonicalNativeObjectTokens, t.name, () => {
                t.hash = strHash(t.toString());
                return t;
            }) as any;
        this.numberOfCanonicalizeTokenCalls++;
        const s = t.toString();
        return getOrSet(this.canonicalTokens, s, () => (t.hash = strHash(s), t)) as T;
    }

    /**
     * Returns the canonical representative of the given access path (possibly the given one).
     */
    canonicalizeAccessPath<T extends AccessPath>(t: T): T {
        if (t === IgnoredAccessPath.instance || t === UnknownAccessPath.instance)
            return t;
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
    registerFunctionInfo(file: FilePath, path: NodePath<Function>, name: string | undefined) {
        const fun = path.node;
        const m = this.moduleInfosByPath.get(file)!;
        const f = new FunctionInfo(name, fun.loc!, m, isDummyConstructor(fun));
        this.functionInfos.set(fun, f);
        const parent = getEnclosingFunction(path);
        (parent ? this.functionInfos.get(parent)!.functions : m.functions).add(f);
        if (this.vulnerabilities)
            this.vulnerabilities.reachedFunction(path, f); // TODO: move to FragmentState?
    }

    /**
     * Records that the given file has been reached, and returns its ModuleInfo.
     */
    reachedFile(tofile: FilePath, from?: ModuleInfo, local?: boolean): ModuleInfo {
        let moduleInfo;
        if (this.reachedFiles.has(tofile))
            moduleInfo = this.moduleInfosByPath.get(tofile)!;
        else {

            // find package.json and extract name, version, and main file
            let packageInfo: PackageInfo | undefined;
            let rel: string | undefined;
            let otherfile: string | undefined;
            if (from && local) {

                // module in same package
                packageInfo = from.packageInfo;
                rel = relative(packageInfo.dir, tofile);
                if (rel.startsWith("../"))
                    throw new Error(`Relative module reference to ${from.getPath()} outside current package ${packageInfo}`);
            } else {

                // module in other package
                const p = getOrSet(this.packageJsonInfos, dirname(tofile), () => getPackageJsonInfo(tofile));
                rel = relative(p.dir, tofile);

                // find or create PackageInfo
                packageInfo = this.packageInfos.get(p.packagekey);
                if (!packageInfo) {

                    // package has not been reached before (also not in another directory)
                    packageInfo = new PackageInfo(p.name, p.version, p.main, p.dir, from === undefined);
                    this.packageInfos.set(p.packagekey, packageInfo);
                    if (!options.modulesOnly && !options.approxOnly && options.printProgress && logger.isVerboseEnabled())
                        logger.verbose(`Reached package ${packageInfo} at ${p.dir}`);
                    if (this.vulnerabilities)
                        this.vulnerabilities.reachedPackage(packageInfo);

                } else {

                    // package has been reached before, but maybe in another directory, so look for ModuleInfo there
                    otherfile = resolve(packageInfo.dir, rel);
                    moduleInfo = this.moduleInfosByPath.get(otherfile);
                }
            }

            if (moduleInfo) {

                // module has been reached before in another directory
                if (logger.isDebugEnabled())
                    logger.debug(`${moduleInfo} already encountered in another directory`);
            } else {

                // module has not been reached before, create new ModuleInfo
                const ignoreModule = (from && (options.ignoreDependencies ||
                        (!packageInfo.isEntry && ((options.includePackages && !options.includePackages.includes(packageInfo.name)))))) ||
                    options.excludePackages?.includes(packageInfo.name);
                moduleInfo = new ModuleInfo(rel, packageInfo, from === undefined, !ignoreModule);
                packageInfo.modules.set(rel, moduleInfo);

                // record that module has been reached
                this.reachedFiles.add(tofile);
                if (ignoreModule)
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
                if (logger.isDebugEnabled())
                    logger.debug(`Package ${pf} depends on ${pt}`);
            }
        }
        return moduleInfo;
    }

    /**
     * Finds the nearest enclosing function or module.
     */
    getEnclosingFunctionOrModule(path: NodePath): FunctionInfo | ModuleInfo {
        const p = getEnclosingFunction(path);
        if (p)
            return this.functionInfos.get(p)!;
        const loc = path.node.loc as Location;
        if (!loc?.module)
            assert.fail(`Function/module info not found at ${locationToStringWithFile(path.node.loc)}!?!`);
        return loc.module;
    }

    /**
     * Finds the module or package that the given constraint variable belongs to,
     * returns undefined for constraint variables that do not belong to a specific package.
     */
    getConstraintVarParent(v: ConstraintVar): PackageInfo | ModuleInfo | undefined {
        const p = v.getParent();
        if (p && "loc" in p && p.loc)
            return (p.loc as Location).module;
        return undefined;
    }
}
