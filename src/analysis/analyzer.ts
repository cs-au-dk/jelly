import fs, {statSync} from "fs";
import {resolve} from "path";
import logger, {writeStdOutIfActive} from "../misc/logger";
import Solver, {AbortedException} from "./solver";
import Timer, {TimeoutException} from "../misc/timer";
import {addAll, getMapHybridSetSize, mapMapSize, percent} from "../misc/util";
import {visit} from "./astvisitor";
import {ModuleInfo, PackageInfo} from "./infos";
import {options, resolveBaseDir} from "../options";
import assert from "assert";
import {widenObjects} from "./widening";
import {findModules} from "./modulefinder";
import {parseAndDesugar} from "../parsing/parser";
import {findEscapingObjects} from "./escaping";
import {buildNatives} from "../natives/nativebuilder";
import {AnalysisStateReporter} from "../output/analysisstatereporter";
import {Operations} from "./operations";
import {UnknownAccessPath} from "./accesspaths";
import {Token} from "./tokens";
import {preprocessAst} from "../parsing/extras";
import {FragmentState} from "./fragmentstate";

export async function analyzeFiles(files: Array<string>, solver: Solver) {
    const a = solver.globalState;
    const d = solver.diagnostics;
    const timer = new Timer();
    resolveBaseDir();
    const fragmentStates = new Map<ModuleInfo | PackageInfo, FragmentState>();

    function merge(mp: ModuleInfo | PackageInfo, propagate: boolean = true) {
        const f = fragmentStates.get(mp);
        if (f) {
            if (logger.isDebugEnabled())
                logger.debug(`Merging state for ${mp}`);
            solver.merge(f, propagate);
        } else if (logger.isVerboseEnabled())
            logger.verbose(`No state found for ${mp}`);
    }

    try {
        if (files.length === 0)
            logger.info("Error: No files to analyze");
        else {

            // analyze files reachable from the entry files top-down
            for (const file of files)
                a.entryFiles.add(resolve(options.basedir, file)); // TODO: optionally resolve using require.resolve instead?
            for (const file of a.entryFiles)
                a.reachedFile(file);
            while (a.pendingFiles.length > 0) {
                const file = a.pendingFiles.shift()!;
                const moduleInfo = a.getModuleInfo(file);

                // initialize analysis state for the module
                solver.prepare();

                d.modules++;
                if (!options.modulesOnly && options.printProgress)
                    logger.info(`Analyzing module ${file} (${d.modules})`);

                const str = fs.readFileSync(file, "utf8"); // TODO: OK to assume utf8? (ECMAScript says utf16??)
                writeStdOutIfActive(`Parsing ${file} (${Math.ceil(str.length / 1024)}KB)...`);
                const ast = parseAndDesugar(str, file, solver.fragmentState);
                if (!ast) {
                    a.filesWithParseErrors.push(file);
                    continue;
                }
                moduleInfo.node = ast.program;
                a.filesAnalyzed.push(file);
                d.codeSize += statSync(file).size;

                if (options.modulesOnly) {

                    // find modules only, no actual analysis
                    findModules(ast, file, solver.fragmentState, moduleInfo);

                } else {

                    // add model of native library
                    const {globals, globalsHidden, moduleSpecialNatives, globalSpecialNatives} = buildNatives(solver, moduleInfo);
                    a.globalSpecialNatives = globalSpecialNatives;

                    // preprocess the AST
                    preprocessAst(ast, file, moduleInfo, globals, globalsHidden);

                    // traverse the AST
                    writeStdOutIfActive("Traversing AST...");
                    solver.fragmentState.maybeEscapingFromModule.clear();
                    visit(ast, new Operations(file, solver, moduleSpecialNatives));

                    // propagate tokens until fixpoint reached for the module
                    await solver.propagate();

                    // find escaping objects and add UnknownAccessPaths
                    const escaping = findEscapingObjects(moduleInfo, solver);

                    // if enabled, widen escaping objects for this module
                    if (options.alloc && options.widening)
                        widenObjects(escaping, solver);

                    // propagate tokens (again) until fixpoint reached
                    await solver.propagate();

                    // shelve the module state
                    if (logger.isDebugEnabled())
                        logger.debug(`Shelving state for ${moduleInfo}`);
                    fragmentStates.set(moduleInfo, solver.fragmentState);

                    solver.updateDiagnostics();
                }
            }

            if (!options.modulesOnly) {

                // combine analysis states for all modules
                solver.prepare();
                const totalNumPackages = Array.from(a.packageInfos.values()).reduce((acc, p) =>
                    acc + (Array.from(p.modules.values()).some(m => fragmentStates.has(m)) ? 1 : 0), 0);
                for (const p of a.packageInfos.values()) {
                    await solver.checkAbort();

                    // skip the package if it doesn't contain any analyzed modules
                    if (!Array.from(p.modules.values()).some(m => fragmentStates.has(m)))
                        continue;

                    d.packages++;
                    if (options.printProgress)
                        logger.info(`Analyzing package ${p} (${d.packages}/${totalNumPackages})`);

                    // merge analysis state for each module
                    for (const m of p.modules.values())
                        merge(m);

                    // connect neighbors
                    for (const d of p.directDependencies)
                        solver.addPackageNeighbor(p, d);
                }

                // propagate tokens until fixpoint reached
                await solver.propagate();
                await patchDynamics(solver);

                assert(a.pendingFiles.length === 0, "Unexpected module"); // (new modules shouldn't be discovered in the second phase)
                solver.updateDiagnostics();
            }
        }

        const f = solver.fragmentState;
        f.reportNonemptyUnhandledDynamicPropertyWrites();
        f.reportNonemptyUnhandledDynamicPropertyReads();

    } catch (ex) {
        solver.updateDiagnostics();
        if (ex instanceof TimeoutException) {
            d.timeout = true;
        } else if (ex instanceof AbortedException) {
            d.aborted = true;
        } else
            throw ex;
    }
    d.time = timer.elapsed();
    d.cpuTime = timer.elapsedCPU();
    d.errors = getMapHybridSetSize(solver.fragmentState.errors) + a.filesWithParseErrors.length;
    d.warnings = getMapHybridSetSize(solver.fragmentState.warnings) + getMapHybridSetSize(solver.fragmentState.warningsUnsupported);

    if (d.aborted)
        logger.warn("Received abort signal, analysis aborted");
    else if (d.timeout)
        logger.warn("Time limit reached, analysis aborted");

    // output statistics
    if (!options.modulesOnly && files.length > 0) {
        const f = solver.fragmentState; // current fragment (not final if aborted due to timeout)
        const r = new AnalysisStateReporter(f);
        d.callsWithUniqueCallee = r.getOneCalleeCalls();
        d.totalCallSites = f.callLocations.size;
        d.callsWithNoCallee = r.getZeroCalleeCalls().size;
        d.nativeOnlyCalls = r.getZeroButNativeCalleeCalls();
        d.externalOnlyCalls = r.getZeroButExternalCalleeCalls();
        d.nativeOrExternalCalls = r.getZeroButNativeOrExternalCalleeCalls();
        d.functionsWithZeroCallers = r.getZeroCallerFunctions().size;
        if (logger.isInfoEnabled()) {
            logger.info(`Analyzed packages: ${d.packages}, modules: ${d.modules}, functions: ${a.functionInfos.size}, code size: ${Math.ceil(d.codeSize / 1024)}KB`);
            logger.info(`Call edges function->function: ${f.numberOfFunctionToFunctionEdges}, call->function: ${f.numberOfCallToFunctionEdges}`);
            const n = d.totalCallSites - d.callsWithNoCallee - d.nativeOnlyCalls - d.externalOnlyCalls - d.nativeOrExternalCalls;
            logger.info(`Calls with unique callee: ${d.callsWithUniqueCallee}/${n}${n > 0 ? ` (${percent(d.callsWithUniqueCallee / n)})` : ""}` +
                ` (excluding ${d.callsWithNoCallee} zero-callee, ${d.nativeOnlyCalls} native-only, ${d.externalOnlyCalls} external-only and ${d.nativeOrExternalCalls} native-or-external-only)`)
            logger.info(`Functions with zero callers: ${r.getZeroCallerFunctions().size}/${a.functionInfos.size}`);
            logger.info(`Analysis time: ${d.time}ms, memory usage: ${d.maxMemoryUsage}MB${!options.gc ? " (without --gc)" : ""}`);
            logger.info(`Analysis errors: ${d.errors}, warnings: ${d.warnings}${getMapHybridSetSize(f.warningsUnsupported) > 0 && !options.warningsUnsupported ? " (show all with --warnings-unsupported)" : ""}`);
            if (options.diagnostics) {
                logger.info(`Iterations: ${d.iterations}, listener notification rounds: ${d.listenerNotificationRounds}`);
                if (options.maxRounds !== undefined)
                    logger.info(`Fixpoint round limit reached: ${d.roundLimitReached} time${d.roundLimitReached !== 1 ? "s" : ""}`);
                logger.info(`Constraint vars: ${f.getNumberOfVarsWithTokens()} (${f.vars.size}), tokens: ${f.numberOfTokens}, subset edges: ${f.numberOfSubsetEdges}, max tokens: ${f.getLargestTokenSetSize()}, max subset out: ${f.getLargestSubsetEdgeOutDegree()}, redirections: ${f.redirections.size}`);
                logger.info(`Listeners (notifications) token: ${mapMapSize(f.tokenListeners)} (${d.tokenListenerNotifications}), ` +
                    `pair: ${mapMapSize(f.pairListeners1) + mapMapSize(f.pairListeners2)} (${d.pairListenerNotifications}), ` +
                    (options.readNeighbors ? `neighbor: ${mapMapSize(f.packageNeighborListeners)} (${d.packageNeighborListenerNotifications}), ` : "") +
                    `ancestor: ${mapMapSize(f.ancestorListeners)} (${d.ancestorListenerNotifications}), ` +
                    `array: ${mapMapSize(f.arrayEntriesListeners)} (${d.arrayEntriesListenerNotifications}), ` +
                    `obj: ${mapMapSize(f.objectPropertiesListeners)} (${d.objectPropertiesListenerNotifications})`);
                logger.info(`Canonicalize vars: ${a.canonicalConstraintVars.size} (${a.numberOfCanonicalizeVarCalls}), tokens: ${a.canonicalTokens.size} (${a.numberOfCanonicalizeTokenCalls}), access paths: ${a.canonicalAccessPaths.size} (${a.numberOfCanonicalizeAccessPathCalls})`);
                logger.info(`CPU time: ${d.cpuTime}ms, propagation: ${d.totalPropagationTime}ms, listeners: ${d.totalListenerCallTime}ms` +
                    (options.alloc && options.widening ? `, widening: ${d.totalWideningTime}ms` : ""));
                if (options.cycleElimination)
                    logger.info(`Cycle elimination time: ${d.totalCycleEliminationTime}ms, runs: ${d.totalCycleEliminationRuns}, nodes removed: ${f.redirections.size}`);
            }
        }
    }
}

/**
 * Patches empty object property constraint variables that may be affected by dynamic property writes.
 */
async function patchDynamics(solver: Solver) {
    if (!options.patchDynamics)
        return;
    const f = solver.fragmentState;
    const dyns = new Set<Token>();
    for (const v of f.dynamicPropertyWrites)
        addAll(f.getTokens(f.getRepresentative(v)), dyns);
    // constraint: for all E.p (or E[..]) where ⟦E.p⟧ (or ⟦E[..]⟧) is empty and ⟦E⟧ contains a token that is base of a dynamic property write
    let count = 0;
    const r: typeof f.maybeEmptyPropertyReads = [];
    for (const e of f.maybeEmptyPropertyReads) {
        const {result, base, pck/*, prop*/} = e;
        const bs = f.getTokens(f.getRepresentative(base));
        const [size] = f.getTokensSize(f.getRepresentative(result));
        if (size === 0) {
            let dpw = false;
            for (const t of bs)
                if (dyns.has(t)) {
                    dpw = true; // base has a token that is base of a dynamic property write
                    break;
                }
            if (dpw) {
                if (logger.isDebugEnabled())
                    logger.debug(`Empty object property read ${result} with dynamic write to base object ${base}`);

                // constraint: ...: @Unknown ∈ ⟦E⟧ and k ∈ ⟦E.p⟧ (or ⟦E[..]⟧) where k is the package containing the property read operation
                solver.addAccessPath(UnknownAccessPath.instance, base);
                solver.addTokenConstraint(pck, result); // TODO: omit?

                // TODO: enable extra patching for exports properties?
                /*
                // constraint: ...: ⟦%exports[m].p⟧ ⊆ ⟦E⟧ for each module m in the current package or a neighbor package
                if (prop !== undefined)
                    for (const p of [pck.packageInfo, ...f.packageNeighbors.get(pck.packageInfo) ?? []]) {
                        for (const m of p.modules.values()) {
                            const t = f.a.canonicalizeToken(new NativeObjectToken("exports", m));
                            const v = f.getRepresentative(solver.varProducer.objPropVar(t, prop));
                            if (f.vars.has(v))
                                solver.addSubsetConstraint(v, result);
                        }
                    }
                 */

                count++;
            } else
                r.push(e); // keep only the property reads that are still empty
        }
    }
    f.maybeEmptyPropertyReads = r;
    if (count > 0) {
        if (logger.isVerboseEnabled())
            logger.verbose(`${count} empty object property read${count === 1 ? "" : "s"} patched, propagating again`);
        await solver.propagate();
    }
}
