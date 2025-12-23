import {Function, Node} from "@babel/types";
import {FilePath, getOrSet, Location, locationToStringWithFile, mapGetMap, strHash} from "../misc/util";
import {
    AccessorType,
    AncestorsVar,
    ArgumentsVar,
    ConstraintVar,
    FunctionReturnVar,
    NodeVar,
    ObjectPropertyVar,
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
import {Worklist} from "../misc/worklist";

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

    private canonicalArgumentsVar: WeakMap<Function | ModuleInfo, ArgumentsVar> = new WeakMap;

    private canonicalObjectPropertyVar: WeakMap<
        ObjectPropertyVarObj,
        Map<string, Record<AccessorType, ObjectPropertyVar | undefined>>
    > = new WeakMap;

    /**
     * Map from AST node to canonical NodeVar object.
     */
    readonly canonicalNodeVars: WeakMap<Node, NodeVar> = new WeakMap;

    readonly vars: Array<ConstraintVar> = [];

    /**
     * Map from token string hash to canonical Token object.
     */
    readonly canonicalTokens: Map<string, Token> = new Map;

    private canonicalUnknownAccessPathToken: AccessPathToken | undefined;

    private canonicalIgnoredAccessPathToken: AccessPathToken | undefined;

    private canonicalNativeObjectTokens: Map<string, NativeObjectToken> = new Map;

    readonly tokens: Array<Token> = [];

    /**
     * Map from access path string hash to canonical AccessPath object.
     */
    readonly canonicalAccessPaths: Map<string, AccessPath> = new Map;

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
    readonly pendingFiles = new Worklist<FilePath>();

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
        const next = () => {
           v.index = this.vars.length;
           this.vars.push(v);
           return v;
        };
        if (v instanceof NodeVar)
            return getOrSet(this.canonicalNodeVars, v.node, next as unknown as () => NodeVar) as unknown as T;
        else if (v instanceof AncestorsVar)
            return getOrSet(this.canonicalAncestorVars, v.t, next as unknown as () => AncestorsVar) as unknown as T;
        else if (v instanceof FunctionReturnVar)
            return getOrSet(this.canonicalReturnVar, v.fun, next as unknown as () => FunctionReturnVar) as unknown as T;
        else if (v instanceof ThisVar)
            return getOrSet(this.canonicalThisVar, v.fun, next as unknown as () => ThisVar) as unknown as T;
        else if (v instanceof ArgumentsVar)
            return getOrSet(this.canonicalArgumentsVar, v.fun, next as unknown as () => ArgumentsVar) as unknown as T;
        else if (v instanceof ObjectPropertyVar) {
            const props = mapGetMap(this.canonicalObjectPropertyVar, v.obj);
            const m = getOrSet(props, v.prop, () => ({
                get: undefined,
                set: undefined,
                normal: undefined,
            }));
            return (m[v.accessor] ??= next() as unknown as ObjectPropertyVar) as unknown as T;
        }
        this.numberOfCanonicalizeVarCalls++;
        return getOrSet(this.canonicalConstraintVars, v.toString(), next) as T;
    }

    /**
     * Returns the canonical representative of the given token (possibly the given one).
     */
    canonicalizeToken<T extends Token>(t: T): T {
        const next = () => {
            t.index = this.tokens.length;
            this.tokens.push(t);
            return t;
        };
        if (t instanceof AccessPathToken) {
            if (t.ap === UnknownAccessPath.instance) {
                if (!this.canonicalUnknownAccessPathToken) {
                    t.hash = strHash(t.toString());
                    this.canonicalUnknownAccessPathToken = next() as unknown as AccessPathToken;
                }
                return this.canonicalUnknownAccessPathToken as unknown as T;
            }
            if (t.ap === IgnoredAccessPath.instance) {
                if (!this.canonicalIgnoredAccessPathToken) {
                    t.hash = strHash(t.toString());
                    this.canonicalIgnoredAccessPathToken = next() as unknown as AccessPathToken;
                }
                return this.canonicalIgnoredAccessPathToken as unknown as T;
            }
        } else if (t instanceof NativeObjectToken && !t.moduleInfo)
            return getOrSet(this.canonicalNativeObjectTokens, t.name, () => {
                t.hash = strHash(t.toString());
                return next() as unknown as NativeObjectToken;
            }) as any;
        this.numberOfCanonicalizeTokenCalls++;
        const s = t.toString();
        return getOrSet(this.canonicalTokens, s, () => (t.hash = strHash(s), next())) as T;
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
    registerFunctionInfo(m: ModuleInfo, path: NodePath<Function>, name: string | undefined) {
        const fun = path.node;
        const f = new FunctionInfo(name, fun.loc!, m, isDummyConstructor(fun));
        this.functionInfos.set(fun, f);
        const parent = getEnclosingFunction(path)?.node;
        (parent ? this.functionInfos.get(parent)!.functions : m.functions).add(f);
        this.vulnerabilities?.reachedFunction(f); // TODO: move to FragmentState?
    }

    /**
     * Records that the given file has been reached, and returns its ModuleInfo.
     */
    reachedFile(tofile: FilePath, entry: boolean, from?: ModuleInfo, local?: boolean): ModuleInfo {
        let moduleInfo;
        if (this.reachedFiles.has(tofile))
            moduleInfo = this.moduleInfosByPath.get(tofile)!;
        else {

            // find package.json and extract name, version, and main file
            let packageInfo: PackageInfo | undefined;
            let rel = "";
            let otherfile: string | undefined;
            if (from && local) {

                // expect module to be in the same package
                packageInfo = from.packageInfo;
                rel = relative(packageInfo.dir, tofile);
                if (rel.startsWith("../")) {
                    logger.warn(`Relative module reference from ${from.getPath()} to ${rel} outside current package ${packageInfo}`);
                    packageInfo = undefined;
                }
            }

            if (!packageInfo) {
                // module in other package
                const p = getOrSet(this.packageJsonInfos, dirname(tofile), () => getPackageJsonInfo(tofile));
                rel = relative(p.dir, tofile);

                // find or create PackageInfo
                packageInfo = this.packageInfos.get(p.packagekey);
                if (!packageInfo) {

                    // package has not been reached before (also not in another directory)
                    packageInfo = new PackageInfo(p.name, p.version, p.main, p.dir, entry);
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
                moduleInfo = new ModuleInfo(rel, packageInfo, from === undefined, !ignoreModule); // FIXME: from === undefined may depend on visit order when using approx
                packageInfo.modules.set(rel, moduleInfo);

                // record that module has been reached
                this.reachedFiles.add(tofile);
                if (ignoreModule)
                    logger.info(`Ignoring module ${moduleInfo}`);
                else
                    this.pendingFiles.enqueue(tofile);
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

        // unless this is an entry file, extend the package and module dependencies
        if (from) {
            const pf = from.packageInfo;
            const mt = this.moduleInfosByPath.get(tofile)!;
            const pt = mt.packageInfo;
            if (pf !== pt && !pf.directDependencies.has(pt)) {
                pf.directDependencies.add(pt);
                if (logger.isDebugEnabled())
                    logger.debug(`Package ${pf} depends on ${pt}`);
            }
            if (!mt.directDependents.has(from)) {
                mt.directDependents.add(from);
                if (logger.isDebugEnabled())
                    logger.debug(`Module ${from} depends on ${mt}`);
            }
        }
        return moduleInfo;
    }

    /**
     * Finds the nearest enclosing function or module.
     */
    getEnclosingFunctionOrModule(path: NodePath): FunctionInfo | ModuleInfo {
        const p = getEnclosingFunction(path)?.node;
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
