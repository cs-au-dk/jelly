import {readFileSync} from "fs";
import {CallGraph} from "../typings/callgraph";
import {LocationJSON, SourceLocationsToJSON, mapArrayAdd, mapCallsToFunctions, mapGetSet, percent} from "../misc/util";
import logger from "../misc/logger";
import assert from "assert";
import {SourceLocation} from "@babel/types";

function compareStringArrays(as1: Array<string>, as2: Array<string>, file1: string, file2: string, kind: string): Set<string> {
    const s = new Set<string>(as2);
    for (const e of as1)
        if (!s.has(e))
            logger.warn(`${kind} ${e} found in ${file1}, missing in ${file2}`);
    return s;
}

// loc returns a canonical representation of a LocationJSON string that is suitable for matching
// between call graphs collected from dynamic and static analysis
function loc(str: LocationJSON, cg: CallGraph, kind: "Function" | "Call"): {str: string, file: string} {
    const parsed = new SourceLocationsToJSON(cg.files).parseLocationJSON(str);
    let rest;
    if (!parsed.loc) rest = "?:?";
    else {
        // Functions: dyn.ts sometimes reports incorrect end locations for functions, so
        // we strip the end locations off of functions.
        // Calls: dyn.ts sometimes reports incorrect start source locations for call expressions
        // with parenthesized base expressions (see tests/micro/call-expressions.js).
        // since end locations are unique for call expressions we can solely rely on those for matching
        const pos = kind === "Call"? parsed.loc.end : parsed.loc.start;
        rest = `${pos.line}:${pos.column+1}`;
    }
    return {str: `${parsed.file}:${rest}`, file: parsed.file};
}

function compareLocationObjects(o1: {[index: number]: string}, o2: {[index: number]: string}, file1: string, file2: string, cg1: CallGraph, cg2: CallGraph, file2files: Set<string>, kind: "Function" | "Call", ignores: Set<string>) {
    const s = new Set<string>();
    for (const loc2 of Object.values(o2))
        s.add(loc(loc2, cg2, kind).str);
    for (const loc1 of Object.values(o1)) {
        const {str: q, file: f} = loc(loc1, cg1, kind);
        if (ignores.has(q)) {
            logger.debug(`Ignoring ${q}`);
            continue;
        }
        if (!s.has(q)) {
            const extra = !file2files.has(f) ? ` (file ${f} missing)` : "";
            logger.warn(`${kind} ${q} found in ${file1}, missing in ${file2}${extra}`);
        }
    }
}

function edge(from: string, to: string): string {
    return `${from} -> ${to}`;
}

function compareEdges(es1: Array<[number, number]>, es2: Array<[number, number]>, file1: string, file2: string, cg1: CallGraph, cg2: CallGraph, file2files: Set<string>, kind: "Function" | "Call", prop: "functions" | "calls", ignores: Set<string>): [number, number] {
    const s = new Set<string>();
    for (const [i, j] of es2) {
        if (!cg2[prop][i])
            assert.fail(`cg2["${prop}"][${i}] is undefined`);
        if (!(cg2.functions)[j])
            assert.fail(`cg2.functions[${j}] is undefined`);
        const from = loc(cg2[prop][i], cg2, kind).str;
        const to = loc((cg2.functions)[j], cg2, "Function").str;
        s.add(edge(from, to));
    }
    let found = 0, missed = 0;
    for (const [i, j] of es1) { // TODO: assuming no duplicate pairs
        if (!cg1[prop][i])
            assert.fail(`cg1["${prop}"][${i}] is undefined`);
        if (!(cg1.functions)[j])
            assert.fail(`cg1.functions[${j}] is undefined`);
        const {str: from, file: ff} = loc(cg1[prop][i], cg1, kind);
        const {str: to, file: ft} = loc((cg1.functions)[j], cg1, "Function");
        if (ignores.has(from) || ignores.has(to)) {
            logger.debug(`Ignoring ${from} -> ${to}`);
            continue;
        }
        const e = edge(from, to);
        if (!s.has(e)) {
            const extra = !file2files.has(ff) ? ` (file ${ff} missing)` : !file2files.has(ft) ? ` (file ${ft} missing)` : "";
            logger.info(`${kind}->function edge ${e} found in ${file1}, missing in ${file2}${extra}`);
            missed++;
        } else
            found++;
    }
    return [found, found + missed];
}

// https://manu.sridharan.net/files/ICSE-2013-Approximate.pdf
// https://github.com/asgerf/callgraphjs/blob/master/evaluate.js
function compareCallSiteEdges(cg1: CallGraph, cg2: CallGraph, ignores1: Set<string>, ignores2: Set<string>): {precision: number, recall: number} {
    const e1 = new Map<string, Set<string>>();
    for (const [c, f] of cg1.call2fun) {
        const from = loc(cg1.calls[c], cg1, "Call").str;
        const to = loc(cg1.functions[f], cg1, "Function").str;
        if (ignores2.has(to)) {
            logger.debug(`Ignoring ${from} -> ${to}`);
            continue;
        }
        mapGetSet(e1, from).add(to);
    }
    const e2 = new Map<string, Set<string>>();
    for (const [c, f] of cg2.call2fun) {
        const from = loc(cg2.calls[c], cg2, "Call").str;
        const to = loc(cg2.functions[f], cg2, "Function").str;
        if (ignores1.has(to)) {
            logger.debug(`Ignoring ${from} -> ${to}`);
            continue;
        }
        mapGetSet(e2, from).add(to);
    }
    const ps = [];
    const rs = [];
    for (const c of Object.values(cg1.calls)) {
        const from = loc(c, cg1, "Call").str;
        const s1 = e1.get(from);
        if (s1) {
            const s2 = e2.get(from) ?? new Set;
            const pos = Array.from(s1).reduce((acc, f) => acc + (s2.has(f) ? 1 : 0), 0);
            ps.push(s2.size > 0 ? pos / s2.size : 1);
            rs.push(pos / s1.size);
        }
    }
    function avg(xs: Array<number>): number {
        return xs.reduce((acc, x) => acc + x, 0) / (xs.length || 1);
    }
    return {precision: avg(ps), recall: avg(rs)};
}

function getIgnores(cg: CallGraph): Set<string> {
    const s = new Set<string>();
    if (cg.ignore)
        for (const p of cg.ignore)
            s.add(loc(p, cg, "Function").str);
    return s;
}


/**
  * Returns the number of functions in cg1, the number of reachable functions
  * in cg2, and the number of functions in cg1 that are reachable in cg2.
  * Reachability in cg2 is computed from all application modules that are present in cg1.
  */
function computeReachableFunctions(file2: string, cg1: CallGraph, cg2: CallGraph, ignores: Set<string>): [number, number, number] {
    const parser = new SourceLocationsToJSON(cg2.files);
    // find the module entry function for each file by looking for functions
    // that begin at position 1:1 and span the longest
    const fileToModuleIndex: Array<{ index: number, loc: SourceLocation } | undefined> = new Array(cg2.files.length);
    const replocToIndex = new Map<string, number>();
    for (const [i, floc] of Object.entries(cg2.functions)) {
        replocToIndex.set(loc(floc, cg2, "Function").str, Number(i));

        const parsed = parser.parseLocationJSON(floc);
        if (parsed.loc && parsed.loc.start.line === 1 && parsed.loc.start.column === 0) {
            const prev = fileToModuleIndex[parsed.fileIndex]?.loc;
            if (prev === undefined || parsed.loc.end.line > prev.end.line ||
                (parsed.loc.end.line === prev.end.line && parsed.loc.end.column >= prev.end.column))
                fileToModuleIndex[parsed.fileIndex] = {index: Number(i), loc: parsed.loc};
        }
    }

    const Q: Array<number> = [];
    // treat all application modules as CG roots
    for (const [i, file] of cg2.files.entries())
        if (!/\bnode_modules\//.test(file)) {
            const mi = fileToModuleIndex[i];
            if (mi !== undefined)
                Q.push(mi.index);
            else
                // TODO: saveCallGraph shouldn't output files for modules with parse errors
                logger.warn(`Unable to determine module function for ${file}`);
        }

    // compute transitive closure from entries
    const funEdges = new Map<number, Array<number>>();
    for (const [a, b] of cg2.fun2fun) mapArrayAdd(a, b, funEdges);

    const SCGreach = new Set(Q);
    while (Q.length) {
        const i = Q.pop()!;

        for (const ni of funEdges.get(i) ?? [])
            if (!SCGreach.has(ni)) {
                SCGreach.add(ni);
                Q.push(ni);
            }
    }

    if (logger.isDebugEnabled()) {
        logger.debug("Statically reachable functions:");
        for (const i of SCGreach)
            logger.debug(`\t${loc(cg2.functions[i], cg2, "Function").str}`);
    }

    let dcgReach = 0, comReach = 0;
    for (const floc of Object.values(cg1.functions)) {
        const reploc = loc(floc, cg1, "Function").str;
        if (ignores.has(reploc))
            continue;

        dcgReach++;

        if (SCGreach.has(replocToIndex.get(reploc)!))
            comReach++;
        else
            logger.info(`Function ${reploc} is unreachable in ${file2}`);
    }

    // report edges from cg1 where only the source is reachable
    function checkEdge(a: number, b: number, kind: "function" | "call" = "function", rloc?: string) {
        const aloc = loc(cg1.functions[a], cg1, "Function").str;
        const i = replocToIndex.get(aloc);
        if (i === undefined || !SCGreach.has(i))
            return;

        const bloc = loc(cg1.functions[b], cg1, "Function").str;
        const j = replocToIndex.get(bloc);
        if (j === undefined || !SCGreach.has(j))
            logger.info(`Missed ${kind}->function edge ${rloc ?? aloc} -> ${bloc} could increase reachability recall`);
    }

    for (const [a, b] of cg1.fun2fun)
        checkEdge(a, b);

    const callFunIdx = mapCallsToFunctions(cg1);
    for (const [a, b] of cg1.call2fun) {
        const af = callFunIdx.get(a);
        if (af === undefined)
            continue;

        const loc = cg1.calls[a];
        const i = loc.indexOf(":");

        checkEdge(af, b, "call", `${cg1.files[Number(loc.substring(0, i))]}:${loc.substring(i+1)}`);
    }

    return [dcgReach, SCGreach.size, comReach];
}

/**
 * Compares two call graphs, reports missing files, function and edges and precision/recall.
 * @param file1 "actual" call graph file
 * @param file2 "predicted" call graph file
 * @param cg2 the parsed call graph for file2 - will be loaded from file2 if not provided
 * @param compareBothWays if true, reports missing objects in both directions, otherwise
 * only objects that are present in the "actual" call graph but missing in the "predicted"
 * call graph are reported
 * @param compareReachability compare reachability as an additional call graph comparison metric
 */
export function compareCallGraphs(
    file1: string, file2: string, cg2?: CallGraph,
    compareBothWays: boolean = true,
    compareReachability: boolean = false
): {
    // number of actual function->function call edges matched
    fun2funFound: number,
    // total number of actual function->function call edges
    fun2funTotal: number,
    // number of actual call->function call edges matched
    call2funFound: number,
    // total number of actual call->function call edges
    call2funTotal: number,
    // number of actual functions that are predicted reachable
    reachableFound: number,
    // total number of actual functions
    reachableTotal: number,
} {
    logger.info(`Comparing ${file1} and ${file2}`);
    const cg1 = JSON.parse(readFileSync(file1, "utf8")) as CallGraph;
    cg2 ??= JSON.parse(readFileSync(file2, "utf8")) as CallGraph;
    compareStringArrays(cg1.entries ?? [], cg2.entries ?? [], file1, file2, "Entry");
    if (compareBothWays)
        compareStringArrays(cg2.entries ?? [], cg1.entries ?? [], file2, file1, "Entry");
    const file2files = compareStringArrays(cg1.files, cg2.files, file1, file2, "File");
    const file1files = compareBothWays && compareStringArrays(cg2.files, cg1.files, file2, file1, "File") || undefined;
    const ignores1 = getIgnores(cg1);
    const ignores2 = getIgnores(cg2);
    compareLocationObjects(cg1.functions, cg2.functions, file1, file2, cg1, cg2, file2files, "Function", ignores2);
    if (compareBothWays)
        compareLocationObjects(cg2.functions, cg1.functions, file2, file1, cg2, cg1, file1files!, "Function", ignores1);
    compareLocationObjects(cg1.calls, cg2.calls, file1, file2, cg1, cg2, file2files, "Call", ignores2);
    if (compareBothWays)
        compareLocationObjects(cg2.calls, cg1.calls, file2, file1, cg2, cg1, file1files!, "Call", ignores1);
    // measure precision/recall in terms of individual call edges
    const [foundFun1, totalFun1] = compareEdges(cg1.fun2fun, cg2.fun2fun, file1, file2, cg1, cg2, file2files, "Function", "functions", ignores2);
    const [foundFun2, totalFun2] = compareBothWays &&
        compareEdges(cg2.fun2fun, cg1.fun2fun, file2, file1, cg2, cg1, file1files!, "Function", "functions", ignores1) || [0, 0];
    const [foundCall1, totalCall1] = compareEdges(cg1.call2fun, cg2.call2fun, file1, file2, cg1, cg2, file2files, "Call", "calls", ignores2);
    const [foundCall2, totalCall2] = compareBothWays &&
        compareEdges(cg2.call2fun, cg1.call2fun, file2, file1, cg2, cg1, file1files!, "Call", "calls", ignores1) || [0, 0];
    // measure recall in terms of reachable functions
    const [dcgReach, scgReach, comReach] = compareReachability && computeReachableFunctions(file2, cg1, cg2, ignores2) || [0, 0, 0];

    const formatFraction = (num: number, den: number) => `${num}/${den}${den === 0 ? "" : ` (${percent(num / den)})`}`;
    if (compareBothWays)
        logger.info(`Function->function edges in ${file2} that are also in ${file1}: ${formatFraction(foundFun2, totalFun2)}`);
    logger.info(`Function->function edges in ${file1} that are also in ${file2}: ${formatFraction(foundFun1, totalFun1)}`);
    if (compareBothWays)
        logger.info(`Call->function edges in ${file2} that are also in ${file1}: ${formatFraction(foundCall2, totalCall2)}`);
    logger.info(`Call->function edges in ${file1} that are also in ${file2}: ${formatFraction(foundCall1, totalCall1)}`);
    const {precision, recall} = compareCallSiteEdges(cg1, cg2, ignores1, ignores2);
    logger.info(`Per-call average precision: ${percent(precision)}, recall: ${percent(recall)}`);
    if (compareReachability) {
        if (compareBothWays)
            logger.info(`Reachable functions in ${file2} that are also in ${file1}: ${formatFraction(comReach, scgReach)}`);
        logger.info(`Functions in ${file1} that are reachable in ${file2}: ${formatFraction(comReach, dcgReach)}`);
    }

    return {
        fun2funFound: foundFun1, fun2funTotal: totalFun1,
        call2funFound: foundCall1, call2funTotal: totalCall1,
        reachableFound: comReach, reachableTotal: dcgReach,
    };
}
