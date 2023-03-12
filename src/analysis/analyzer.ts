import fs from "fs";
import {resolve} from "path";
import logger, {writeStdOutIfActive} from "../misc/logger";
import Solver, {AbortedException} from "./solver";
import Timer, {TimeoutException} from "../misc/timer";
import {addAll, FilePath, mapMapSize, percent} from "../misc/util";
import {visit} from "./astvisitor";
import {PackageInfo} from "./infos";
import {options, resolveBaseDir} from "../options";
import assert from "assert";
import {getComponents, nuutila} from "../misc/scc";
import {widenObjects} from "./widening";
import {findModules} from "./modulefinder";
import {parseAndDesugar} from "../parsing/parser";
import {findEscapingObjects} from "./escaping";
import {buildNatives} from "../natives/nativebuilder";
import {AnalysisStateReporter} from "../output/analysisstatereporter";
import {Operations} from "./operations";
import {Program} from "@babel/types";
import {UnknownAccessPath} from "./accesspaths";
import {Token} from "./tokens";
import {preprocessAst} from "../parsing/extras";

export async function analyzeFiles(files: Array<string>, solver: Solver, returnFileMap: boolean = false): Promise<Map<FilePath, {sourceCode: string, program: Program}>> {
    const a = solver.analysisState;
    const timer = new Timer();
    resolveBaseDir();
    const fileMap = new Map<FilePath, {sourceCode: string, program: Program}>();
    try {
        if (files.length === 0)
            logger.info("Error: No files to analyze");
        else {

            // resolve entry files relative to basedir
            for (const file of files)
                a.entryFiles.add(resolve(options.basedir, file)); // TODO: optionally resolve using require.resolve instead?

            // analyze files reachable from the entry files top-down
            for (const file of a.entryFiles)
                a.reachedFile(file);
            while (a.pendingFiles.length > 0) {
                const file = a.pendingFiles.shift()!;
                const moduleInfo = a.getModuleInfo(file);

                solver.diagnostics.modules++;
                if (!options.modulesOnly && options.printProgress)
                    logger.info(`Analyzing module ${file} (${solver.diagnostics.modules})`);

                writeStdOutIfActive(`Parsing ${file}...`);
                const str = fs.readFileSync(file, "utf8"); // TODO: OK to assume utf8? (ECMAScript says utf16??)
                solver.diagnostics.codeSize += str.length;
                const ast = parseAndDesugar(str, file, a);
                if (!ast) {
                    a.filesWithParseErrors.push(file);
                    continue;
                }
                if (returnFileMap)
                    fileMap.set(file, {sourceCode: str, program: ast.program})

                if (options.modulesOnly) {

                    // find modules only, no actual analysis
                    findModules(ast, file, solver);

                } else {

                    // initialize analysis state for the module
                    solver.prepare();

                    // prepare model of native library
                    const {globals, globalsHidden, specials} = buildNatives(solver, moduleInfo);

                    // preprocess the AST
                    preprocessAst(ast, file, globals, globalsHidden);

                    // traverse the AST
                    writeStdOutIfActive("Traversing AST...");
                    visit(ast, new Operations(file, solver, specials));

                    // propagate tokens until fixpoint reached for the module
                    await solver.propagate();

                    // find escaping objects and add UnknownAccessPaths
                    const escaping = findEscapingObjects(moduleInfo, solver);

                    // if enabled, widen escaping objects for this module
                    if (options.alloc && options.widening)
                        widenObjects(moduleInfo, escaping, solver);

                    // propagate tokens (again) until fixpoint reached
                    await solver.propagate();

                    // store the analysis state for the module
                    solver.store(moduleInfo);

                    a.filesAnalyzed.push(file);
                    solver.updateDiagnostics();
                }
            }

            if (!options.modulesOnly) {

                if (!options.bottomUp) {

                    // combine analysis states for all modules
                    solver.prepare();
                    const totalNumPackages = Array.from(a.packageInfos.values()).reduce((acc, p) =>
                        acc + (Array.from(p.modules.values()).some(m => m.fragmentState) ? 1 : 0), 0);
                    for (const p of a.packageInfos.values()) {
                        await solver.checkAbort();

                        // skip the package if it doesn't contain any modules that have been analyzed
                        if (!Array.from(p.modules.values()).some(m => m.fragmentState))
                            continue;

                        solver.diagnostics.packages++;
                        if (options.printProgress)
                            logger.info(`Analyzing package ${p} (${solver.diagnostics.packages}/${totalNumPackages})`);

                        // restore analysis state for each module
                        for (const m of p.modules.values())
                            solver.restore(m);

                        // connect neighbors
                        for (const d of p.directDependencies)
                            solver.addPackageNeighbor(p, d);
                    }

                    // propagate tokens until fixpoint reached
                    await solver.propagate();

                    await patchDynamics(solver);

                } else {

                    // compute strongly connected components from the package dependency graph
                    if (logger.isVerboseEnabled())
                        for (const p of a.packageInfos.values()) {
                            logger.verbose(`Package ${p} dependencies:${p.directDependencies.size === 0 ? " -" : ""}`);
                            for (const d of p.directDependencies)
                                logger.verbose(`  ${d}`);
                        }
                    const components = getComponents(nuutila(a.packageInfos.values(), (p: PackageInfo) => p.directDependencies));

                    // combine local analysis results bottom-up in the package structure
                    const transdeps = new Map<PackageInfo, Set<PackageInfo>>(); // direct and transitive dependencies in other components
                    const totalNumPackages = components.reduce((acc, scc) =>
                        acc + scc.reduce((acc, p) =>
                            acc + (Array.from(p.modules.values()).some(m => m.fragmentState) ? 1 : 0), 0), 0);
                    for (const scc of components) {

                        // skip the component if it doesn't contain any modules that have been analyzed
                        if (!(Array.from(scc).some(p => Array.from(p.modules.values()).some(m => m.fragmentState))))
                            continue;

                        solver.diagnostics.packages += scc.length;
                        if (options.printProgress)
                            if (scc.length === 1)
                                logger.info(`Analyzing package ${scc[0]} (${solver.diagnostics.packages}/${totalNumPackages})`);
                            else
                                logger.info(`Analyzing mutually dependent packages ${scc.join(", ")}`);

                        // compute solution for the strongly connected component
                        solver.prepare();
                        const deps = new Set<PackageInfo>(); // direct dependencies in other components
                        const trans = new Set<PackageInfo>(); // transitive dependencies in other components
                        for (const p of scc) {

                            // restore the tokens of the modules of the packages in the component
                            for (const m of p.modules.values())
                                solver.restore(m);

                            // collect dependencies in other components
                            const pd = new Set<PackageInfo>();
                            for (const d of p.directDependencies)
                                if (!scc.includes(d)) {
                                    pd.add(d);
                                    const td = transdeps.get(d);
                                    if (td)
                                        for (const dd of td) {
                                            pd.add(dd);
                                            trans.add(dd);
                                        }
                                }
                            transdeps.set(p, pd);

                            // collect direct dependencies in other components and connect neighbors
                            for (const d of p.directDependencies) {
                                if (!scc.includes(d))
                                    deps.add(d);
                                solver.addPackageNeighbor(p, d);
                            }
                        }
                        // restore tokens from the direct dependencies in other components
                        for (const d of deps)
                            if (!trans.has(d)) // transitive dependencies can safely be skipped
                                solver.restore(d);

                        // propagate tokens until fixpoint reached for the scc packages with their dependencies
                        await solver.propagate();

                        await patchDynamics(solver);

                        // store the tokens for the packages in the component
                        for (const p of scc)
                            solver.store(p);
                        // TODO: persist package(/module?) tokens, seed when analyzing the package/module again (note: modules are only analyzed when reached)

                        assert(a.pendingFiles.length === 0, "Unexpected module"); // (new modules shouldn't be discovered in the bottom-up phase)
                    }

                    // restore all tokens (safe to restore for one package of each component and to skip the last component)
                    let lastComponent = true;
                    for (const scc of components.reverse()) {
                        if (lastComponent) {
                            lastComponent = false;
                            continue;
                        }
                        solver.restore(scc[0], false);
                    }
                }

                solver.updateDiagnostics();
            }
        }

    } catch (ex) {
        solver.updateDiagnostics();
        if (ex instanceof TimeoutException) {
            solver.diagnostics.timeout = true;
        } else if (ex instanceof AbortedException) {
            solver.diagnostics.aborted = true;
        } else
            throw ex;
    }
    solver.diagnostics.time = timer.elapsed();
    solver.diagnostics.cpuTime = timer.elapsedCPU();
    solver.diagnostics.errors = a.errors;
    solver.diagnostics.warnings = a.warnings;

    if (solver.diagnostics.aborted)
        logger.warn("Received abort signal, analysis aborted");
    else if (solver.diagnostics.timeout)
        logger.warn("Time limit reached, analysis aborted");

    // output statistics
    if (!options.modulesOnly && files.length > 0) {
        const f = solver.fragmentState; // current fragment (not final if aborted due to timeout)
        const r = new AnalysisStateReporter(a, f);
        const d = solver.diagnostics;
        d.callsWithUniqueCallee = r.getOneCalleeCalls();
        d.totalCallSites = a.callLocations.size;
        d.callsWithNoCallee = r.getZeroCalleeCalls().size;
        d.nativeOnlyCalls = r.getZeroButNativeCalleeCalls();
        d.externalOnlyCalls = r.getZeroButExternalCalleeCalls();
        d.nativeOrExternalCalls = r.getZeroButNativeOrExternalCalleeCalls();
        d.functionsWithZeroCallers = r.getZeroCallerFunctions().size;
        if (!logger.isInfoEnabled())
            return fileMap;
        if (options.warningsUnsupported && !solver.diagnostics.aborted && !solver.diagnostics.timeout) {
            r.reportNonemptyUnhandledDynamicPropertyWrites();
            r.reportNonemptyUnhandledDynamicPropertyReads();
        }
        logger.info(`Analyzed packages: ${solver.diagnostics.packages}, modules: ${solver.diagnostics.modules}, functions: ${a.functionInfos.size}, code size: ${Math.round(solver.diagnostics.codeSize / 1024)}KB`);
        logger.info(`Call edges function->function: ${a.numberOfFunctionToFunctionEdges}, call->function: ${a.numberOfCallToFunctionEdges}`);
        const n = d.totalCallSites - d.callsWithNoCallee - d.nativeOnlyCalls - d.nativeOnlyCalls - d.nativeOrExternalCalls;
        logger.info(`Calls with unique callee: ${d.callsWithUniqueCallee}/${n}${n > 0 ? ` (${percent(d.callsWithUniqueCallee / n)})` : ""}` +
            ` (excluding ${d.callsWithNoCallee} zero-callee, ${d.nativeOnlyCalls} native-only, ${d.externalOnlyCalls} external-only and ${d.nativeOrExternalCalls} native-or-external-only)`)
        logger.info(`Functions with zero callers: ${r.getZeroCallerFunctions().size}/${a.functionInfos.size}`);
        logger.info(`Analysis time: ${solver.diagnostics.time}ms, memory usage: ${solver.diagnostics.maxMemoryUsage}MB${!options.gc ? " (without --gc)" : ""}`);
        logger.info(`Analysis errors: ${a.errors}, warnings: ${a.warnings}${a.warnings > 0 && !options.warningsUnsupported ? " (show with --warnings-unsupported)" : ""}`);
        if (options.diagnostics) {
            logger.info(`Iterations: ${solver.diagnostics.iterations}, listener notification rounds: ${solver.listenerNotificationRounds}`);
            if (options.maxRounds !== undefined)
                logger.info(`Fixpoint round limit reached: ${solver.roundLimitReached} time${solver.roundLimitReached !== 1 ? "s" : ""}`);
            logger.info(`Constraint vars: ${f.getNumberOfVarsWithTokens()} (${f.vars.size}), tokens: ${f.numberOfTokens}, subset edges: ${f.numberOfSubsetEdges}, max tokens: ${solver.largestTokenSetSize}, max subset out: ${solver.largestSubsetEdgeOutDegree}`);
            logger.info(`Listeners (notifications) normal: ${mapMapSize(f.tokenListeners)} (${solver.tokenListenerNotifications}), ` +
                `pair: ${mapMapSize(f.pairListeners1) + mapMapSize(f.pairListeners2)} (${solver.pairListenerNotifications}), ` +
                `neighbor: ${mapMapSize(f.packageNeighborListeners)} (${solver.packageNeighborListenerNotifications}), ` +
                `inheritance: ${mapMapSize(f.ancestorListeners)} (${solver.ancestorListenerNotifications}), ` +
                `array: ${mapMapSize(f.arrayEntriesListeners)} (${solver.arrayEntriesListenerNotifications}), ` +
                `obj: ${mapMapSize(f.objectPropertiesListeners)} (${solver.objectPropertiesListenerNotifications})`);
            logger.info(`Canonicalize vars: ${a.canonicalConstraintVars.size} (${a.numberOfCanonicalizeVarCalls}), tokens: ${a.canonicalTokens.size} (${a.numberOfCanonicalizeTokenCalls}), access paths: ${a.canonicalAccessPaths.size} (${a.numberOfCanonicalizeAccessPathCalls})`);
            logger.info(`CPU time: ${solver.diagnostics.cpuTime}ms, propagation: ${solver.totalPropagationTime}ms, listeners: ${solver.totalListenerCallTime}` +
                `ms${options.alloc && options.widening ? `, widening: ${solver.totalWideningTime}ms` : ""}`);
            if (options.cycleElimination)
                logger.info(`Cycle elimination time: ${solver.totalCycleEliminationTime}ms, runs: ${solver.totalCycleEliminationRuns}, nodes removed: ${f.redirections.size}`);
        }
    }

    return fileMap;
}

/**
 * Patches empty object property constraint variables that may be affected by dynamic property writes.
 */
async function patchDynamics(solver: Solver) {
    if (!options.patchDynamics)
        return;
    const a = solver.analysisState;
    const f = solver.fragmentState;
    const dyns = new Set<Token>();
    for (const v of a.dynamicPropertyWrites)
        addAll(f.getTokens(f.getRepresentative(v)), dyns);
    // constraint: for all E.p (or E[..]) where ⟦E.p⟧ (or ⟦E[..]⟧) is empty and ⟦E⟧ contains a token that is base of a dynamic property write
    let count = 0;
    const r: typeof a.maybeEmptyPropertyReads = [];
    for (const e of a.maybeEmptyPropertyReads) {
        const {result, base, pck} = e;
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
                count++;
            } else
                r.push(e); // keep only the property reads that are still empty
        }
    }
    a.maybeEmptyPropertyReads = r;
    if (count > 0) {
        if (logger.isVerboseEnabled())
            logger.verbose(`${count} empty object property read${count === 1 ? "" : "s"} patched, propagating again`);
        await solver.propagate();
    }
}
