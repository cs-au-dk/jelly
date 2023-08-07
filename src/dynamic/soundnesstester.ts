import {readFileSync} from "fs";
import {DummyModuleInfo, FunctionInfo, ModuleInfo} from "../analysis/infos";
import logger from "../misc/logger";
import {arrayToString, percent, locationToStringWithFile, locationToStringWithFileAndEnd} from "../misc/util";
import {CallGraph} from "../typings/callgraph";
import path from "path";
import {options} from "../options";
import {FragmentState} from "../analysis/fragmentstate";

/**
 * Performs soundness testing of the analysis result using the given dynamic call graph.
 */
export function testSoundness(jsonfile: string, f: FragmentState): {
    // number of dynamic function->function call edges matched
    fun2funFound: number,
    // total number of dynamic function->function call edges
    fun2funTotal: number,
    // number of dynamic call->function call edges matched
    call2funFound: number,
    // total number of dynamic call->function call edges
    call2funTotal: number,
    // number of dynamic functions that are statically reachable
    reachableFound: number,
    // total number of dynamic functions
    reachableTotal: number,
} {
    // collect all static functions including module top-level functions (excluding aliases)
    const staticFunctions = new Map<string, FunctionInfo | ModuleInfo>();
    for (const m of f.a.moduleInfos.values())
        if (m.node?.loc) // TODO: m.node.loc may be empty with --ignore-dependencies
            staticFunctions.set(`${m.getPath()}:${m.node.loc.start.line}:${m.node.loc.start.column + 1}:${m.node.loc.end.line}:${m.node.loc.end.column + 1}`, m);
    for (const g of f.a.functionInfos.values())
        if (!g.node?.loc || "nodeIndex" in g.node.loc)
            logger.warn(`Warning: Source location missing for function ${g.name || "<anonymous>"} in ${g.moduleInfo.getPath()}`);
        else
            staticFunctions.set(`${g.moduleInfo.getPath()}:${g.node.loc.start.line}:${g.node.loc.start.column + 1}:${g.node.loc.end.line}:${g.node.loc.end.column + 1}`, g);

    // log static locations
    if (logger.isDebugEnabled()) {
        logger.debug(`Static files: ${arrayToString(Array.from(f.a.moduleInfosByPath.keys()), "\n  ")}`);
        logger.debug(`Static functions: ${arrayToString(Array.from(staticFunctions.keys()), "\n  ")}`);
        logger.debug(`Static calls: ${arrayToString(Array.from(f.callLocations).map(n => locationToStringWithFileAndEnd(n.loc)), "\n  ")}`);
        logger.debug(`Ignored functions: ${arrayToString(f.artificialFunctions.map(([, n]) => locationToStringWithFile(n.loc)), "\n  ")}`);
        // TODO: optionally ignore files that haven't been analyzed? (relevant with --ignore-dependencies)
    }

    // load the dynamic call graph
    const dyn = JSON.parse(readFileSync(jsonfile, "utf8")) as CallGraph;

    // collect dynamic files and check that they have been analyzed
    const cwd = process.cwd();
    const dynamicFiles = dyn.files.map((file) => {
        const p = path.resolve(options.basedir, file);
        let m = f.a.moduleInfosByPath.get(p);
        if (m === undefined)
            m = f.a.moduleInfosByPath.get(path.resolve(cwd, file)); // try to resolve the file relative to the current working directory
        if (m === undefined) {
            logger.warn(`File ${file} not found in static call graph`);
            return file;
        }
        return m.getPath();
    });

    // finds the representative for the given source location
    function findRepresentativeLocation(loc: string): string {
        const c = loc.indexOf(":");
        const file = dynamicFiles[Number(loc.substring(0, c))];
        const rest = loc.substring(c + 1);
        return `${file}:${rest}`;
    }

    function stripEnd(loc: string): string {
        return loc.replace(/(:\d+:\d+):\d+:\d+$/, "$1");
    }

    // staticShortFunctions maps "<file>:<startLine>:<startColumn>" to functions
    // TODO: Collisions can happen between the synthetic module function and a function
    // defined at the beginning of the file.
    const staticShortFunctions = new Map([...staticFunctions.entries()].map(([sloc, fun]) => [stripEnd(sloc), fun]));

    // collect dynamic functions and check that they have been analyzed
    const dynamicFunctionLocs = new Map<number, string>();
    const dynamicFunctions = new Map<number, FunctionInfo | ModuleInfo>();
    const ignoredFunctions = new Set<string>();
    for (const [,n] of f.artificialFunctions)
        ignoredFunctions.add(locationToStringWithFile(n.loc));
    const comp = ([, loc1]: [string, string], [, loc2]: [string, string]) => loc1 < loc2 ? -1 : loc1 > loc2 ? 1 : 0;
    for (const [f, loc] of Object.entries(dyn.functions).sort(comp)) {
        const reploc = findRepresentativeLocation(loc);
        dynamicFunctionLocs.set(Number(f), reploc);
        const stripped = stripEnd(reploc);
        // dyn.ts sometimes reports incorrect end locations, so we try to match
        // while only considering start locations if matching the full location fails
        const fun = staticFunctions.get(reploc) ?? staticShortFunctions.get(stripped);
        if (!fun) {
            if (!ignoredFunctions.has(stripped))
                logger.warn(`Function ${reploc} not found in static call graph`);
            else
                logger.debug(`Function ${reploc} from dynamic call graph ignored`); // filtering away artificial call edges reported by dyn.ts
        } else
            dynamicFunctions.set(Number(f), fun);
    }

    // dyn.ts sometimes reports incorrect start source locations for call expressions
    // with parenthesized base expressions (see tests/micro/call-expressions.js),
    // since end locations are unique for call expressions we can solely rely on those for matching
    function stripStart(loc: string): string {
        return loc.replace(/:\d+:\d+(:\d+:\d+)$/, "$1");
    }

    // callStrLocations maps "<file>:<endLine>:<endColumn>" to the full location.
    const callStrLocations = new Map<string, string>();
    for (const n of f.callLocations) {
        const loc = locationToStringWithFileAndEnd(n.loc);
        callStrLocations.set(stripStart(loc), loc);
    }

    // collect dynamic calls and check whether they have been analyzed
    const dynamicCallLocs = new Map<number, string>();
    for (const [f, loc] of Object.entries(dyn.calls).sort(comp)) {
        let reploc = findRepresentativeLocation(loc);
        // attempt to correct dynamically collected source start location with statically collected info
        const actualLoc = callStrLocations.get(stripStart(reploc));
        if (actualLoc === undefined)
            logger.warn(`Call ${reploc} not found in static call graph`);
        else
            reploc = actualLoc;

        dynamicCallLocs.set(Number(f), reploc);
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
                const fs = f.functionToFunction.get(callerFun);
                if (fs && fs.has(calleeFun))
                    found = true;
            } else {
                const ms = f.requireGraph.get(callerFun);
                if (ms && ms.has(calleeFun))
                    found = true;
            }
            if (found)
                found1++;
            else {
                warnings.push(`Call edge missing in static call graph: function ${dynamicFunctionLocs.get(from)} -> function ${dynamicFunctionLocs.get(to)}`);
                missed1++;
            }
        }
    }
    const total1 = found1 + missed1;

    // check call2fun edges
    const callStrToFunction = new Map<string, Set<FunctionInfo>>();
    for (const [n, s] of f.callToFunction)
        callStrToFunction.set(locationToStringWithFileAndEnd(n.loc), s);
    const callStrToModule = new Map<string, Set<ModuleInfo | DummyModuleInfo>>();
    for (const [n, s] of f.callToModule)
        callStrToModule.set(locationToStringWithFileAndEnd(n.loc), s)
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
            if (found)
                found2++;
            else {
                warnings.push(`Call edge missing in static call graph: call ${dynamicCallLocs.get(from)} -> function ${dynamicFunctionLocs.get(to)}`);
                missed2++;
            }
        }
    }
    const total2 = found2 + missed2;

    // compute reachable functions
    const Q: Array<FunctionInfo | ModuleInfo> = [];
    // treat all application modules as CG roots
    for (const [file, m] of f.a.moduleInfosByPath)
        if (!/\bnode_modules\//.test(file))
            Q.push(m);

    // compute transitive closure from entries
    const SCGreach = new Set(Q);
    while (Q.length) {
        const i = Q.pop()!;

        for (const ni of [...f.functionToFunction.get(i) ?? [], ...f.requireGraph.get(i) ?? []])
            if (!SCGreach.has(ni)) {
                SCGreach.add(ni);
                Q.push(ni);
            }
    }

    const dcgReach = dynamicFunctionLocs.size;
    let comReach = 0;
    for (const [fi, reploc] of dynamicFunctionLocs.entries()) {
        const f = dynamicFunctions.get(fi);
        if (f !== undefined && SCGreach.has(f))
            comReach++;
        else {
            const typ = f === undefined? "Function/module" :
                f instanceof ModuleInfo? "Module" : "Function";
            warnings.push(`${typ} ${reploc} is unreachable in static call graph`);
        }
    }

    // report and return results
    for (const m of warnings.sort())
        logger.warn(m);
    logger.info(`Dynamic function->function call edges matched: ${found1}/${total1}${total1 > 0 ? ` (recall: ${percent(found1 / total1)})` : ""}`);
    logger.info(`Dynamic call->function call edges matched: ${found2}/${total2}${total2 > 0 ? ` (recall: ${percent(found2 / total2)})` : ""}`);
    logger.info(`Dynamic functions reachable in static call graph: ${comReach}/${dcgReach}${dcgReach > 0? ` (recall: ${percent(comReach / dcgReach)})` : ""}`)
    return {
        fun2funFound: found1, fun2funTotal: total1,
        call2funFound: found2, call2funTotal: total2,
        reachableFound: comReach, reachableTotal: dcgReach,
    };
}
