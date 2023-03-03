import {readFileSync} from "fs";
import {DummyModuleInfo, FunctionInfo, ModuleInfo} from "../analysis/infos";
import logger from "../misc/logger";
import {arrayToString, percent, sourceLocationToStringWithFile, sourceLocationToStringWithFileAndEnd} from "../misc/util";
import {CallGraph} from "../typings/callgraph";
import {AnalysisState} from "../analysis/analysisstate";
import path from "path";
import {options} from "../options";

/**
 * Performs soundness testing of the analysis result using the given dynamic call graph.
 * @return [number of dynamic function->function call edges matched,
 *          total number of dynamic function->function call edges,
 *          number of dynamic call->function call edges matched,
 *          total number of dynamic call->function call edges]
 */
export function testSoundness(jsonfile: string, analysisState: AnalysisState): [number, number, number, number] {

    // collect all static functions including module top-level functions (excluding aliases)
    const staticFunctions = new Map<string, FunctionInfo | ModuleInfo>();
    for (const m of analysisState.moduleInfos.values())
        if (m.loc) // TODO: m.loc may be empty with --ignore-dependencies
            staticFunctions.set(`${m.path}:${m.loc.start.line}:${m.loc.start.column + 1}:${m.loc.end.line}:${m.loc.end.column + 1}`, m);
    for (const f of analysisState.functionInfos.values())
        if (!f.loc || "nodeIndex" in f.loc)
            analysisState.warn(`Source location missing for function ${f.name || "<anonymous>"} in ${f.moduleInfo.path}`);
        else
            staticFunctions.set(`${f.moduleInfo.path}:${f.loc.start.line}:${f.loc.start.column + 1}:${f.loc.end.line}:${f.loc.end.column + 1}`, f);

    // log static locations
    if (logger.isDebugEnabled()) {
        logger.debug(`Static files: ${arrayToString(Array.from(analysisState.moduleInfos.keys()), "\n  ")}`);
        logger.debug(`Static functions: ${arrayToString(Array.from(staticFunctions.keys()), "\n  ")}`);
        logger.debug(`Static calls: ${arrayToString(Array.from(analysisState.callLocations), "\n  ")}`);
        logger.debug(`Ignored functions: ${arrayToString(analysisState.artificialFunctions.map(([, n]) => sourceLocationToStringWithFile(n.loc)), "\n  ")}`);
        // TODO: optionally ignore files that haven't been analyzed? (relevant with --ignore-dependencies)
    }

    // load the dynamic call graph
    const dyn = JSON.parse(readFileSync(jsonfile, "utf8")) as CallGraph;

    // collect dynamic files and check that they have been analyzed
    const dynamicFiles = new Map<number, string>();
    for (const file of dyn.files) {
        const f = path.resolve(options.basedir, file);
        dynamicFiles.set(dynamicFiles.size, f);
        if (!analysisState.moduleInfos.has(f))
            logger.warn(`File ${file} not found in static call graph`);
        // else
        //     logger.debug(`Found file ${file}`);
    }

    // finds the representative for the given source location
    function findRepresentativeLocation(loc: string): string {
        const c = loc.indexOf(":");
        const file = dynamicFiles.get(Number(loc.substring(0, c)))!;
        const rest = loc.substring(c + 1);
        const m = analysisState.moduleInfos.get(file);
        return `${m ? m.path : file}:${rest}`;
    }

    // collect dynamic functions and check that they have been analyzed
    const dynamicFunctionLocs = new Map<number, string>();
    const dynamicFunctions = new Map<number, FunctionInfo | ModuleInfo>();
    const ignoredFunctions = new Set<string>();
    for (const [,n] of analysisState.artificialFunctions)
        ignoredFunctions.add(sourceLocationToStringWithFile(n.loc) + ":");
    const comp = ([, loc1]: [string, string], [, loc2]: [string, string]) => loc1 < loc2 ? -1 : loc1 > loc2 ? 1 : 0;
    for (const [f, loc] of Object.entries(dyn.functions).sort(comp)) {
        const reploc = findRepresentativeLocation(loc);
        dynamicFunctionLocs.set(Number(f), reploc);
        const fun = staticFunctions.get(reploc);
        if (!fun) {
            if (!ignoredFunctions.has(reploc.substring(0, reploc.lastIndexOf(":", reploc.lastIndexOf(":") - 1) + 1))) // dyn.ts sometimes reports incorrect end locations, so we only consider start locations
                logger.warn(`Function ${reploc} not found in static call graph`);
            else
                logger.debug(`Function ${reploc} from dynamic call graph ignored`); // filtering away artificial call edges reported by dyn.ts
        } else {
            dynamicFunctions.set(Number(f), fun);
            // logger.debug(`Found function ${loc}`);
        }
    }

    // collect dynamic calls and check whether they have been analyzed
    const callStrLocations = new Set<string>();
    for (const n of analysisState.callLocations)
        callStrLocations.add(sourceLocationToStringWithFileAndEnd(n.loc));
    const dynamicCallLocs = new Map<number, string>();
    for (const [f, loc] of Object.entries(dyn.calls).sort(comp)) {
        const reploc = findRepresentativeLocation(loc);
        dynamicCallLocs.set(Number(f), reploc);
        if (!callStrLocations.has(reploc))
            logger.warn(`Call ${reploc} not found in static call graph`);
    }

    const warnings: Array<string> = [];

    // check fun2fun edges
    let found1 = 0, missed1 = 0;
    for (const [from, to] of dyn.fun2fun) {
        const callerFun = dynamicFunctions.get(from);
        const calleeFun = dynamicFunctions.get(to);
        let found = false;
        if (callerFun && calleeFun) {
            if (calleeFun instanceof FunctionInfo) {
                const fs = analysisState.functionToFunction.get(callerFun);
                if (fs && fs.has(calleeFun))
                    found = true;
            } else {
                const ms = analysisState.requireGraph.get(callerFun);
                if (ms && ms.has(calleeFun))
                    found = true;
            }
        }
        if (found)
            found1++;
        else {
            warnings.push(`Call edge missing in static call graph: function ${dynamicFunctionLocs.get(from)} -> function ${dynamicFunctionLocs.get(to)}`);
            missed1++;
        }
    }
    const total1 = found1 + missed1;

    // check call2fun edges
    const callStrToFunction = new Map<string, Set<FunctionInfo>>();
    for (const [n, s] of analysisState.callToFunction)
        callStrToFunction.set(sourceLocationToStringWithFileAndEnd(n.loc), s);
    const callStrToModule = new Map<string, Set<ModuleInfo | DummyModuleInfo>>();
    for (const [n, s] of analysisState.callToModule)
        callStrToModule.set(sourceLocationToStringWithFileAndEnd(n.loc), s)
    let found2 = 0, missed2 = 0;
    for (const [from, to] of dyn.call2fun) {
        const callLoc = dynamicCallLocs.get(from);
        const calleeFun = dynamicFunctions.get(to);
        let found = false;
        if (callLoc && calleeFun) {
            if (calleeFun instanceof FunctionInfo) {
                const fs = callStrToFunction.get(callLoc);
                if (fs && fs.has(calleeFun))
                    found = true;
            } else {
                const ms = callStrToModule.get(callLoc);
                if (ms && ms.has(calleeFun))
                    found = true;
            }
        }
        if (found)
            found2++;
        else {
            warnings.push(`Call edge missing in static call graph: call ${dynamicCallLocs.get(from)} -> function ${dynamicFunctionLocs.get(to)}`);
            missed2++;
        }
    }
    const total2 = found2 + missed2;

    // report and return results
    for (const m of warnings.sort())
        logger.warn(m);
    logger.info(`Dynamic function->function call edges matched: ${found1}/${total1}${total1 > 0 ? ` (recall: ${percent(found1 / total1)})` : ""}`);
    logger.info(`Dynamic call->function call edges matched: ${found2}/${total2}${total2 > 0 ? ` (recall: ${percent(found2 / total2)})` : ""}`);
    return [found1, total1, found2, total2];
}
