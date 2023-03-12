import {
    CallExpression,
    Class,
    Function,
    identifier,
    Identifier,
    isArrowFunctionExpression,
    isExpression,
    isNode,
    NewExpression,
    Node,
    OptionalCallExpression,
    SourceLocation
} from "@babel/types";
import {
    FilePath,
    getOrSet,
    mapGetSet,
    sourceLocationToString,
    sourceLocationToStringWithFile,
    sourceLocationToStringWithFileAndEnd,
    SourceLocationWithFilename,
    strHash
} from "../misc/util";
import {ConstraintVar, NodeVar} from "./constraintvars";
import logger from "../misc/logger";
import {ObjectToken, PackageObjectToken, Token} from "./tokens";
import {dirname, relative, resolve} from "path";
import {NodePath} from "@babel/traverse";
import assert from "assert";
import {getPackageJsonInfo, PackageJsonInfo} from "../misc/packagejson";
import {DummyModuleInfo, FunctionInfo, ModuleInfo, PackageInfo} from "./infos";
import {options} from "../options";
import {
    AccessPath,
    CallResultAccessPath,
    ComponentAccessPath,
    ModuleAccessPath,
    PropertyAccessPath
} from "./accesspaths";
import {ConstraintVarProducer} from "./constraintvarproducer";
import Timer from "../misc/timer";
import {VulnerabilityDetector} from "../patternmatching/vulnerabilitydetector";

export const globalLoc: SourceLocation = {start: {line: 0, column: 0}, end: {line: 0, column: 0}};

export const undefinedIdentifier = identifier("undefined"); // TODO: prevent writes to 'undefined'?
undefinedIdentifier.loc = globalLoc;

export class AnalysisState { // TODO: move some of these fields to FragmentState?

    /**
     * Map from constraint variable string hash to canonical ConstraintVar object.
     */
    readonly canonicalConstraintVars: Map<number, ConstraintVar> = new Map;

    /**
     * Map from AST node to canonical NodeVar object.
     */
    readonly canonicalNodeVars: WeakMap<Node, NodeVar> = new WeakMap;

    /**
     * Map from token string hash to canonical Token object.
     */
    readonly canonicalTokens: Map<number, Token> = new Map;

    /**
     * Map from access path string hash to canonical AccessPath object.
     */
    readonly canonicalAccessPaths: Map<number, AccessPath> = new Map;

    /**
     * Map that provides for each function/module the set of modules being required.
     */
    readonly requireGraph: Map<FunctionInfo | ModuleInfo, Set<ModuleInfo>> = new Map;

    /**
     * Map that provides for each function/module the set of functions that may be called.
     */
    readonly functionToFunction: Map<FunctionInfo | ModuleInfo, Set<FunctionInfo>> = new Map;

    /**
     * Map that provides for each call site location the set of functions that may be called. (For output only.)
     */
    readonly callToFunction: Map<Node, Set<FunctionInfo>> = new Map; // TODO: redundant? see callToFunctionOrModule

    /**
     * Map from call/require/import node to functions/modules that may be called/imported.
     */
    readonly callToFunctionOrModule: Map<Node, Set<FunctionInfo | ModuleInfo | DummyModuleInfo>> = new Map;

    readonly callToContainingFunction: Map<Node, ModuleInfo | FunctionInfo> = new Map;

    /**
     * Map from require/import call to the set of modules being required. (For output only.)
     */
    readonly callToModule: Map<Node, Set<ModuleInfo | DummyModuleInfo>> = new Map; // TODO: redundant? see callToFunctionOrModule

    /**
     * Total number of function->function call graph edges. (For statistics only.)
     */
    numberOfFunctionToFunctionEdges: number = 0;

    /**
     * Total number of call->function call graph edges. (For statistics only.)
     */
    numberOfCallToFunctionEdges: number = 0;

    /**
     * Map from "name@version" to package info, "<main>" is used for entry files if no package.json is found.
     */
    readonly packageInfos: Map<string, PackageInfo> = new Map;

    /**
     * Map from normalized module path to ModuleInfo.
     * Note: different paths may refer to the same ModuleInfo! (if they belong to the same package and version)
     */
    readonly moduleInfos: Map<FilePath, ModuleInfo> = new Map;

    /**
     * Set of DummyModuleInfos created (for module files that haven't been found).
     */
    readonly dummyModuleInfos: Map<string, DummyModuleInfo> = new Map;

    /**
     * Map from Function AST object to FunctionInfo.
     */
    readonly functionInfos: Map<Function, FunctionInfo> = new Map;

    /**
     * Functions that use 'arguments'.
     */
    readonly functionsWithArguments: Set<Function> = new Set;

    /**
     * Functions that use 'this'.
     */
    readonly functionsWithThis: Set<Function> = new Set;

    /**
     * Source code locations that correspond to the start of artificial functions in dyn.ts.
     * Such functions are ignored during soundness testing.
     */
    readonly artificialFunctions: Array<[ModuleInfo, Node]> = [];

    /**
     * Call nodes for each module. (Only used with options.callgraphJson.)
     */
    readonly calls: Map<ModuleInfo, Set<Node>> = new Map;

    /**
     * Source locations of all calls (including accessor calls).
     */
    readonly callLocations: Set<Node> = new Set;

    /**
     * Source locations of calls to/from known native functions.
     */
    readonly nativeCallLocations: Set<Node> = new Set;

    /**
     * Source locations of calls to external functions.
     */
    readonly externalCallLocations: Set<Node> = new Set;

    /**
     * Calls with unused result.
     * Used by PatternMatcher.
     */
    readonly callsWithUnusedResult: Set<Node> = new Set;

    /**
     * Calls where the result may be used as a promise.
     * Used by PatternMatcher.
     */
    readonly callsWithResultMaybeUsedAsPromise: Set<Node> = new Set;

    /**
     * Constraint variables that represent function parameters.
     */
    readonly functionParameters: Map<Function, Set<ConstraintVar>> = new Map;

    /**
     * Expressions that are invoked at calls.
     * Used by PatternMatcher.
     */
    readonly invokedExpressions: Set<Node> = new Set;

    /**
     * Constraint variables that represent expressions whose values may escape to other modules.
     * Includes arguments to functions from other modules.
     */
    readonly maybeEscaping: Set<ConstraintVar> = new Set;

    /**
     * Object tokens that have been widened.
     */
    readonly widened: Set<ObjectToken> = new Set;

    /**
     * Unhandled dynamic property write operations.
     */
    readonly unhandledDynamicPropertyWrites: Map<Node, {src: ConstraintVar, source: string | undefined}> = new Map;

    /**
     * Unhandled dynamic property read operations.
     */
    readonly unhandledDynamicPropertyReads: Set<Node> = new Set;

    /**
     * Number of errors. (For statistics only.)
     */
    errors: number = 0;

    /**
     * Number of warnings. (For statistics only.)
     */
    warnings: number = 0;

    /**
     * AST nodes where a warning has been emitted.
     */
    readonly nodesWithWarning: WeakSet<Node> = new WeakSet;

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
     * 'require' expressions and import/export declarations/expressions where ModuleAccessPaths are created.
     * Used by PatternMatcher.
     */
    readonly moduleAccessPaths: Map<ModuleAccessPath, Set<Node>> = new Map;

    /**
     * Property read expressions where PropertyAccessPaths are created.
     * ap |-> prop |-> n |-> {bp, sub} means that ap appears at the base sub-expression of the property read expression n with
     * property prop, bp is the access path for n, and sub is the constraint variable of the sub-expression.
     * Used by PatternMatcher.
     */
    readonly propertyReadAccessPaths: Map<AccessPath, Map<string, Map<Node, {bp: PropertyAccessPath, sub: ConstraintVar}>>> = new Map;

    /**
     * Property write expressions where PropertyAccessPaths are created.
     * ap |-> prop |-> n |-> {bp, sub} means that ap appears at the base sub-expression of the property write expression n with
     * property prop, bp is the access path for n, and sub is the constraint variable of the sub-expression.
     * Used by PatternMatcher.
     */
    readonly propertyWriteAccessPaths: Map<AccessPath, Map<string, Map<Node, {bp: PropertyAccessPath, sub: ConstraintVar}>>> = new Map;

    /**
     * Expressions and associated CallResultAccessPaths where CallResultAccessPaths are created.
     * ap |-> n |-> {bp, sub} means that ap appears at the function sub-expression of the call expression n,
     * bp is the access path for n, and sub is the constraint variable of the sub-expression.
     * Used by PatternMatcher.
     */
    readonly callResultAccessPaths: Map<AccessPath, Map<Node, {bp: CallResultAccessPath, sub: ConstraintVar}>> = new Map;

    /**
     * Expressions and associated ComponentAccessPaths where ComponentAccessPaths are created.
     * ap |-> n |-> {bp, sub} means that ap appears at the function sub-expression of the component creation expression n,
     * bp is the access path for n, and sub is the constraint variable of the sub-expression.
     * Used by PatternMatcher.
     */
    readonly componentAccessPaths: Map<AccessPath, Map<Node, {bp: ComponentAccessPath, sub: ConstraintVar}>> = new Map;

    /**
     * Map from identifier declarations at imports to uses.
     * Used by PatternMatcher.
     */
    readonly importDeclRefs: Map<Identifier, Array<Identifier>> = new Map;

    /**
     * Constraint variable producer.
     */
    readonly varProducer = new ConstraintVarProducer(this);

    /**
     * Timeout timer.
     */
    readonly timeoutTimer = new Timer;

    /**
     * Cache of PackageJsonInfos.
     */
    readonly packageJsonInfos = new Map<FilePath, PackageJsonInfo>();

    /**
     * Property reads that may have empty result.
     */
    maybeEmptyPropertyReads: Array<{result: ConstraintVar, base: ConstraintVar, pck: PackageObjectToken}> = [];

    /**
     * Dynamic property writes.
     */
    dynamicPropertyWrites = new Set<ConstraintVar>();

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
     * Returns the canonical representative of the given constraint variable (possibly the given one).
     */
    canonicalizeVar<T extends ConstraintVar>(v: T): T {
        this.numberOfCanonicalizeVarCalls++;
        if (v instanceof NodeVar)
            return getOrSet(this.canonicalNodeVars, v.node, () => v) as unknown as T;
        else
            return getOrSet(this.canonicalConstraintVars, strHash(v.toString()), () => v) as T;
    }

    /**
     * Returns the canonical representative of the given token (possibly the given one).
     */
    canonicalizeToken<T extends Token>(t: T): T {
        this.numberOfCanonicalizeTokenCalls++;
        return getOrSet(this.canonicalTokens, strHash(t.toString()), () => t) as T;
    }

    /**
     * Returns the canonical representative of the given access path (possibly the given one).
     */
    canonicalizeAccessPath<T extends AccessPath>(t: T): T {
        this.numberOfCanonicalizeAccessPathCalls++;
        return getOrSet(this.canonicalAccessPaths, strHash(t.toString()), () => t) as T;
    }

    /**
     * Adds an edge in the call graph (both function->function and call->function).
     */
    registerCallEdge(call: Node, from: FunctionInfo | ModuleInfo, to: FunctionInfo,
                     {native, accessor, external}: {native?: boolean, accessor?: boolean, external?: boolean} = {}) {
        if ((!accessor || options.callgraphImplicit) &&
            (!native || options.callgraphNative) &&
            (!external || options.callgraphExternal)) {
            // register function->function
            let fs = mapGetSet(this.functionToFunction, from);
            if (!fs.has(to))
                this.numberOfFunctionToFunctionEdges++;
            fs.add(to);
            // register call->function
            let cs = mapGetSet(this.callToFunction, call);
            if (!cs.has(to)) {
                this.numberOfCallToFunctionEdges++;
                if (logger.isVerboseEnabled())
                    logger.verbose(`Adding call edge from call ${sourceLocationToStringWithFileAndEnd(call.loc)}, function ${from} -> ${to}`);
            }
            cs.add(to);
        }
        // register call->function/module
        mapGetSet(this.callToFunctionOrModule, call).add(to);
        this.callToContainingFunction.set(call, from);
    }

    /**
     * Registers a call location.
     */
    registerCall(n: Node, m: ModuleInfo, {native, external, accessor}: {native?: boolean, external?: boolean, accessor?: boolean} = {}) {
        if (accessor && !options.callgraphImplicit)
            return;
        if (options.callgraphJson)
            mapGetSet(this.calls, m).add(n);
        if (!this.callLocations.has(n) ||
            (native && !this.nativeCallLocations.has(n)) ||
            (external && !this.externalCallLocations.has(n))) {
            if (logger.isDebugEnabled())
                logger.debug(`Adding ${native ? "native " : external ? "external " : accessor ? "accessor " : ""}call ${sourceLocationToStringWithFileAndEnd(n.loc!)}`);
            this.callLocations.add(n);
            if (native)
                this.nativeCallLocations.add(n);
            else if (external)
                this.externalCallLocations.add(n);
        }
    }

    /**
     * Registers a require/import call.
     */
    registerRequireCall(node: Node, from:  ModuleInfo | FunctionInfo, m: ModuleInfo | DummyModuleInfo) {
        if (options.callgraphRequire)
            mapGetSet(this.callToModule, node).add(m);
        mapGetSet(this.callToFunctionOrModule, node).add(m);
        this.callToContainingFunction.set(node, from);
    }

    /**
     * Registers a call node whose result is unused.
     */
    registerCallWithUnusedResult(n: CallExpression | OptionalCallExpression | NewExpression) {
        this.callsWithUnusedResult.add(n);
    }

    /**
     * Registers a call node whose result may be used as a promise.
     */
    registerCallWithResultMaybeUsedAsPromise(n: CallExpression | OptionalCallExpression | NewExpression) {
        this.callsWithResultMaybeUsedAsPromise.add(n);
    }

    /**
     * Registers a constraint variable that represents a function parameter (identifiers only, excluding patterns).
     */
    registerFunctionParameter(v: ConstraintVar, fun: Function) {
        mapGetSet(this.functionParameters, fun).add(v);
    }

    /**
     * Registers that values of the expression represented by the given constraint variable may escape to other modules.
     */
    registerEscaping(v: ConstraintVar | undefined) {
        if (v)
            this.maybeEscaping.add(v);
    }

    /**
     * Registers a call to another module.
     */
    registerEscapingArguments(args: CallExpression["arguments"], path: NodePath<CallExpression | OptionalCallExpression | NewExpression>) {
        for (const arg of args)
            if (isExpression(arg)) // TODO: handle non-Expression arguments?
                this.registerEscaping(this.varProducer.expVar(arg, path));
    }

    /**
     * Registers an expression that is invoked at a call.
     */
    registerInvokedExpression(n: Node) {
        this.invokedExpressions.add(n);
    }

    /**
     * Registers a function that may be ignored in output from dyn.ts.
     */
    registerArtificialFunction(m: ModuleInfo, n: Node) {
        this.artificialFunctions.push([m, n]);
    }

    /**
     * Registers an unhandled dynamic property write operation.
     */
    registerUnhandledDynamicPropertyWrite(node: Node, src: ConstraintVar, source: string | undefined) {
        this.unhandledDynamicPropertyWrites.set(node, {src, source});
    }

    /**
     * Registers an unhandled dynamic property read operation.
     */
    registerUnhandledDynamicPropertyRead(node: Node) {
        this.unhandledDynamicPropertyReads.add(node);
    }

    /**
     * Emits an error message.
     */
    error(msg: string) {
        logger.error(`Error: ${msg}`);
        this.errors++;
    }

    /**
     * Emits a warning message.
     */
    warn(msg: string) {
        logger.warn(`Warning: ${msg}`);
        this.warnings++;
    }

    /**
     * Emits a warning message about an unsupported language feature or library function.
     * If avoidDuplicates is set, at most one warning is generated per node.
     */
    warnUnsupported(node: Node, msg: string = node.type, avoidDuplicates: boolean = false) {
        if (avoidDuplicates) {
            if (this.nodesWithWarning.has(node))
                return;
            this.nodesWithWarning.add(node);
        }
        if (options.warningsUnsupported)
            this.warn(`${msg} at ${sourceLocationToStringWithFile(node.loc)}`);
        else
            this.warnings++;
    }

    /**
     * Returns the ModuleInfo of the given module.
     */
    getModuleInfo(file: FilePath): ModuleInfo {
        const m = this.moduleInfos.get(file);
        if (!m)
            assert.fail(`ModuleInfo for ${file} not found`);
        return m;
    }

    /**
     * Registers a new FunctionInfo for a function/method/constructor.
     */
    registerFunctionInfo(file: FilePath, path: NodePath<Function | Class>, name: string | undefined, fun: Function, loc: SourceLocation | null | undefined) {
        const m = this.moduleInfos.get(file)!;
        const f = new FunctionInfo(name, loc, m);
        this.functionInfos.set(fun, f);
        const parent = path.getFunctionParent()?.node;
        (parent ? this.functionInfos.get(parent)!.functions : m.functions).set(fun, f);
        if (this.vulnerabilities)
            this.vulnerabilities.reachedFunction(path, f);
    }

    /**
     * Registers that the current function uses 'arguments'.
     * Returns the enclosing (non-arrow) function, or undefined if no such function.
     */
    registerArguments(path: NodePath): Function | undefined {
        let p: NodePath | NodePath<Function> | null | undefined = path, f: Function | undefined;
        do {
            f = (p = p?.getFunctionParent())?.node;
        } while (f && isArrowFunctionExpression(f));
        if (f) {
            this.functionsWithArguments.add(f);
            if (logger.isDebugEnabled())
                logger.debug(`Function uses 'arguments': ${sourceLocationToStringWithFile(f.loc)}`);
        }
        return f;
    }

    /**
     * Registers that the current function uses 'this'.
     */
    registerThis(path: NodePath): Function | undefined {
        let p: NodePath | NodePath<Function> | null | undefined = path, f: Function | undefined;
        do {
            f = (p = p?.getFunctionParent())?.node;
        } while (f && isArrowFunctionExpression(f));
        if (f) {
            this.functionsWithThis.add(f);
            if (logger.isDebugEnabled())
                logger.debug(`Function uses 'this': ${sourceLocationToStringWithFile(f.loc)}`);
        }
        return f;
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
     * Records that the given file has been reached, and returns its ModuleInfo.
     */
    reachedFile(tofile: FilePath, from?: Function | FilePath): ModuleInfo {
        let moduleInfo;
        if (this.reachedFiles.has(tofile))
            moduleInfo = this.moduleInfos.get(tofile)!;
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
                moduleInfo = this.moduleInfos.get(otherfile);
            }

            if (moduleInfo) {

                // modules has been reached before in another directory
                if (logger.isVerboseEnabled())
                    logger.verbose(`${moduleInfo} already encountered in another directory`);
            } else {

                // module has not been reached before, create new ModuleInfo
                moduleInfo = new ModuleInfo(rel, packageInfo, tofile, from === undefined);
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
                    this.moduleInfos.set(otherfile, moduleInfo);
            }

            // record the ModuleInfo for the given file
            this.moduleInfos.set(tofile, moduleInfo);
        }

        // unless this is an entry file...
        if (from) {

            // extend the require graph
            const fr = typeof from === "string" ? this.moduleInfos.get(from)! : this.functionInfos.get(from)!;
            const to = this.moduleInfos.get(tofile)!;
            mapGetSet(this.requireGraph, fr).add(to);

            // extend the package dependencies and dependents
            const pf = fr.packageInfo;
            const pt = to.packageInfo;
            if (pf !== pt && !pf.directDependencies.has(pt)) {
                pf.directDependencies.add(pt);
                if (logger.isVerboseEnabled())
                    logger.verbose(`Package ${pf} depends on ${pt}`);
            }
        }
        return moduleInfo;
    }

    /**
     * Finds the module or package that the given constraint variable belongs to,
     * returns undefined for constraint variables that do not belong to a specific package.
     */
    getConstraintVarParent(v: ConstraintVar): PackageInfo | ModuleInfo | undefined {
        const p = v.getParent();
        if (isNode(p) || (p && "loc" in p && p.loc))
            return this.moduleInfos.get((p.loc as SourceLocationWithFilename).filename);
        return undefined;
    }
}
