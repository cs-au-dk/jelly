import fs, {readFileSync, statSync} from "fs";
import {resolve} from "path";
import logger, {writeStdOutIfActive} from "../misc/logger";
import Solver, {AbortedException} from "./solver";
import Timer, {nanoToMs, TimeoutException} from "../misc/timer";
import {getMapHybridSetSize, mapMapSize, percent} from "../misc/util";
import {visit} from "./astvisitor";
import {FunctionInfo} from "./infos";
import {options, resolveBaseDir} from "../options";
import {findModules} from "./modulefinder";
import {parseAndDesugar} from "../parsing/parser";
import {findEscapingObjects} from "./escaping";
import {buildGlobalNatives, buildModuleNatives} from "../natives/nativebuilder";
import {AnalysisStateReporter} from "../output/analysisstatereporter";
import {Operations} from "./operations";
import {preprocessAst} from "../parsing/extras";
import {patchDynamics} from "../patching/patchdynamics";
import {patchMethodCalls} from "../patching/patchmethodcalls";
import {finalizeCallEdges} from "./finalization";
import {ProcessManager} from "../approx/processmanager";
import {Patching} from "../approx/patching";
import {PatchingDiagnostics} from "../approx/diagnostics";
import {patchThis} from "../patching/patchthis";

export async function analyzeFiles(files: Array<string>, solver: Solver) {
    const a = solver.globalState;
    const d = solver.diagnostics;
    const timer = new Timer();
    resolveBaseDir();
    if (options.approx || options.approxLoad) {
        a.approx = new ProcessManager(a);
        a.patching = new Patching(a.approx.hints);
        d.patching = new PatchingDiagnostics();
    }

    try {
        if (files.length === 0)
            logger.info("Error: No files to analyze");
        else {
            // add model of native library
            a.globalSpecialNatives = buildGlobalNatives(solver);

            // analyze files reachable from the entry files top-down
            for (const file of files)
                a.entryFiles.add(resolve(options.basedir, file)); // TODO: optionally resolve using require.resolve instead?
            for (const file of a.entryFiles)
                a.reachedFile(file, true); // entry packages must be reached before approx.add
            if (options.approxLoad) {
                if (options.printProgress)
                    logger.info(`Loading ${options.approxLoad}`);
                a.approx!.add(JSON.parse(readFileSync(options.approxLoad, "utf-8")));
            }
            while (a.pendingFiles.isNonEmpty()) {
                while (a.pendingFiles.isNonEmpty()) {
                    for (const file of a.pendingFiles) {
                        const moduleInfo = a.getModuleInfo(file);

                        d.modules++;
                        d.packages = a.packageInfos.size;
                        if (!options.modulesOnly && options.printProgress)
                            logger.info(`Analyzing module ${moduleInfo} (${d.modules})`);

                        const str = fs.readFileSync(file, "utf8"); // TODO: OK to assume utf8? (ECMAScript says utf16??)
                        writeStdOutIfActive(`Parsing ${file} (${Math.ceil(str.length / 1024)}KB)...`);
                        const ast = parseAndDesugar(str, file, solver.fragmentState);
                        if (!ast) {
                            a.filesWithParseErrors.push(file);
                            continue;
                        }
                        moduleInfo.loc = ast.program.loc!;
                        a.filesAnalyzed.push(file);
                        const fileSize = statSync(file).size;
                        d.codeSize += fileSize;
                        if (moduleInfo.packageInfo.isEntry)
                            d.codeSizeMain += fileSize;
                        else
                            d.codeSizeDependencies += fileSize;

                        if (options.approx) {
                            if (a.approx!.hints.moduleIndex.has(moduleInfo.toString())) {
                                if (logger.isVerboseEnabled())
                                    logger.verbose(`Skipping approximate interpretation of module ${file}, already visited`);
                            } else {
                                writeStdOutIfActive(`Approximate interpretation...`);
                                await a.approx!.execute(file); // TODO: run in parallel with static analysis and sync later before the result is used?
                            }
                        }

                        if (options.modulesOnly) {

                            // find modules only, no actual analysis
                            findModules(ast, solver.fragmentState, moduleInfo);

                            if (d.modules % 16 === 0)
                                a.timeoutTimer.checkTimeout();

                        } else {

                            // preprocess the AST
                            const moduleParams = preprocessAst(ast, moduleInfo);

                            // traverse the AST
                            writeStdOutIfActive("Traversing AST...");
                            visit(ast, new Operations(moduleInfo, solver, buildModuleNatives(solver, moduleInfo, moduleParams)));
                        }

                        ast.tokens = undefined; // tokens are no longer needed, allow GC
                    }

                    // propagate tokens until fixpoint reached
                    await solver.propagate("Analyzing");
                    solver.updateDiagnostics();
                }

                if (!options.modulesOnly) {

                    // patch using escape analysis
                    if (options.patchEscaping) {
                        const t = new Timer();
                        findEscapingObjects(Array.from(a.moduleInfos.values()), solver); // TODO: currently using all modules in a
                        await solver.propagate("Escape patching");
                        d.totalEscapePatchingTime += t.elapsed();
                    }

                    // patch using hints from approximate interpretation
                    if (options.approx || options.approxLoad) {
                        const t = new Timer();
                        a.patching!.patch(solver);
                        await solver.propagate("Approximate patching");
                        d.totalApproxPatchingTime += t.elapsed();
                    }

                    // patch heuristics
                    if (options.patchDynamics || options.patchMethodCalls || options.patchThis) {
                        const t = new Timer();
                        if (options.patchDynamics)
                            patchDynamics(solver);
                        if (options.patchMethodCalls)
                            patchMethodCalls(solver);
                        if (options.patchThis)
                            patchThis(solver);
                        await solver.propagate("Extra patching");
                        d.totalOtherPatchingTime += t.elapsed();
                    }

                    solver.updateDiagnostics();
                }
            }
        }

        const f = solver.fragmentState;
        f.reportUnhandledDynamicPropertyWrites();
        f.reportUnhandledDynamicPropertyReads();

    } catch (ex) {
        if (ex instanceof TimeoutException)
            d.timeout = true;
        else if (ex instanceof AbortedException)
            d.aborted = true;
        else
            throw ex;
    } finally {
        if (a.approx) {
            a.approx.stop();
            if (options.approx && (options.diagnostics || options.diagnosticsJson))
                solver.diagnostics.approx = a.approx.getDiagnostics();
        }
    }
    if (d.aborted)
        logger.warn("Received abort signal, analysis aborted");
    else if (d.timeout)
        logger.warn("Time limit reached, analysis aborted");
    else if (d.waveLimitReached > 0)
        logger.warn("Warning: Wave limit reached, analysis terminated early");
    else if (d.indirectionsLimitReached > 0)
        logger.warn("Warning: Indirection limit reached, analysis terminated early");

    // collect final call edges
    finalizeCallEdges(solver);
    solver.updateDiagnostics();

    // output statistics
    d.analysisTime = timer.elapsed();
    d.errors = getMapHybridSetSize(solver.fragmentState.errors) + a.filesWithParseErrors.length;
    d.warnings = getMapHybridSetSize(solver.fragmentState.warnings) + getMapHybridSetSize(solver.fragmentState.warningsUnsupported);
    if (!options.modulesOnly && files.length > 0) {
        const f = solver.fragmentState; // current fragment (not final if aborted due to timeout)
        const r = new AnalysisStateReporter(f);
        d.callsWithUniqueCallee = r.getOneCalleeCalls();
        d.callsWithMultipleCallees = r.getMultipleCalleeCalls();
        d.totalCallSites = f.callLocations.size;
        d.callsWithNoCallee = r.getZeroCalleeCalls().size;
        d.nativeOnlyCalls = r.getZeroButNativeCalleeCalls();
        d.externalOnlyCalls = r.getZeroButExternalCalleeCalls();
        d.nativeOrExternalCalls = r.getZeroButNativeOrExternalCalleeCalls();
        d.functionsWithZeroCallers = r.getZeroCallerFunctions().size;
        d.reachableFunctions = Array.from(r.getReachableModulesAndFunctions(r.getEntryModules())).filter(r => r instanceof FunctionInfo).length;
        if (logger.isInfoEnabled()) {
            logger.info(`Analyzed packages: ${d.packages}, modules: ${d.modules}, functions: ${a.functionInfos.size}, code size main: ${Math.ceil(d.codeSizeMain / 1024)}KB, dependencies: ${Math.ceil(d.codeSizeDependencies / 1024)}KB`);
            logger.info(`Call edges function->function: ${d.functionToFunctionEdges}, call->function: ${d.callToFunctionEdges}`);
            const total = d.totalCallSites, zeroOne = d.callsWithNoCallee + d.callsWithUniqueCallee, nativeExternal = d.nativeOnlyCalls + d.externalOnlyCalls + d.nativeOrExternalCalls;
            if (total > 0)
                logger.info(`Calls with zero or one callee: ${zeroOne}/${total} (${percent(zeroOne / total)}), ` +
                    `multiple: ${d.callsWithMultipleCallees}/${total} (${percent(d.callsWithMultipleCallees / total)}), ` +
                    `native or external: ${nativeExternal}/${total} (${percent(nativeExternal / total)})`);
            logger.info(`Functions with zero callers: ${d.functionsWithZeroCallers}/${a.functionInfos.size}${a.functionInfos.size > 0 ? ` (${percent(d.functionsWithZeroCallers / a.functionInfos.size)})` : ""}, ` +
                `reachable functions: ${d.reachableFunctions}/${a.functionInfos.size}${a.functionInfos.size > 0 ? ` (${percent(d.reachableFunctions / a.functionInfos.size)})` : ""}`);
            logger.info(`Analysis time: ${nanoToMs(d.analysisTime)}, memory usage: ${d.maxMemoryUsage}MB${!options.gc ? " (without --gc)" : ""}`);
            logger.info(`Analysis errors: ${d.errors}, warnings: ${d.warnings}${getMapHybridSetSize(f.warningsUnsupported) > 0 && !options.warningsUnsupported ? " (show all with --warnings-unsupported)" : ""}`);
            if (options.diagnostics) {
                logger.info(`Propagations: ${d.propagations}, listener notification rounds: ${d.listenerNotificationRounds}`);
                if (options.maxWaves !== undefined)
                    logger.info(`Fixpoint wave limit reached: ${d.waveLimitReached} time${d.waveLimitReached !== 1 ? "s" : ""}`);
                logger.info(`Constraint vars: ${f.getNumberOfVarsWithTokens()} (${f.vars.size}), tokens: ${d.tokens}, subset edges: ${d.subsetEdges}, max tokens: ${f.getLargestTokenSetSize()}, max subset out: ${f.getLargestSubsetEdgeOutDegree()}, redirections: ${f.redirections.size}`);
                logger.info(`Listeners (notifications) token: ${mapMapSize(f.tokenListeners)} (${d.tokenListenerNotifications}), bounded: ${mapMapSize(f.tokenListeners2)} (${d.tokenListener2Notifications}), ` +
                    `array: ${mapMapSize(f.arrayEntriesListeners)} (${d.arrayEntriesListenerNotifications}), ` +
                    `obj: ${mapMapSize(f.objectPropertiesListeners)} (${d.objectPropertiesListenerNotifications})`);
                logger.info(`Canonicalize vars: ${a.canonicalConstraintVars.size} (${a.numberOfCanonicalizeVarCalls}), tokens: ${a.canonicalTokens.size} (${a.numberOfCanonicalizeTokenCalls}), access paths: ${a.canonicalAccessPaths.size} (${a.numberOfCanonicalizeAccessPathCalls})`);
                logger.info(`Propagation: ${nanoToMs(d.totalPropagationTime)}, listeners: ${nanoToMs(d.totalListenerCallTime)}` +
                    `, finalization: ${nanoToMs(d.finalizationTime)}`);
                logger.info(`Patching time escape: ${nanoToMs(d.totalEscapePatchingTime)}, approx: ${nanoToMs(d.totalApproxPatchingTime)}, other: ${nanoToMs(d.totalOtherPatchingTime)}`);
                if (options.cycleElimination)
                    logger.info(`Cycle elimination: ${nanoToMs(d.totalCycleEliminationTime)}, runs: ${d.totalCycleEliminationRuns}, nodes removed: ${f.redirections.size}`);
                if (options.approx)
                    a.approx!.printDiagnostics();
                if (options.approx || options.approxLoad)
                    a.patching!.printDiagnostics(solver);
                if (options.vulnerabilitiesFull)
                    logger.info(`Vulnerability collection: ${nanoToMs(d.vulnerabilities!.vulnerabilityCollectionTime)}`);
            }
        }
    }
}
