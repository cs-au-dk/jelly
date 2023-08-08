import {readFileSync} from "fs";
import {CallGraph} from "../typings/callgraph";
import {SourceLocationsToJSON, addAll, mapArrayAdd, mapGetSet, percent} from "../misc/util";
import logger from "../misc/logger";
import {LocationJSON} from "../misc/util";
import assert from "assert";
import {SourceLocation} from "@babel/types";

function compareStringArrays(as1: Array<string> | undefined, as2: Array<string> | undefined, file1: string, file2: string, kind: string): Set<string> {
    const s = new Set<string>();
    if (as2)
        addAll(as2, s);
    if (as1)
        for (const e of as1)
            if (!s.has(e))
                logger.info(`${kind} ${e} found in ${file1}, missing in ${file2}`);
    return s;
}

// loc returns a canonical representation of a LocationJSON string that is suitable for matching
// between call graphs collected from dynamic and static analysis
function loc(str: LocationJSON, cg: CallGraph, kind: "Function" | "Call"): {str: string, file: string} {
    const parsed = new SourceLocationsToJSON(cg.files).parseLocationJSON(str);
    let rest;
    if (!parsed.loc) rest = "?:?";
    else {
        // stripping start locations for calls and end locations for functions (workaround like in soundnesstester)
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
            logger.info(`${kind} ${q} found in ${file1}, missing in ${file2}${extra}`);
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
  * Returns the number of functions in cg1 that are reachable in cg2.
  * Reachability in cg2 is computed from all application modules that are present in cg1.
  */
function computeReachableFunctions(file2: string, cg1: CallGraph, cg2: CallGraph): [number, number] {
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
                fileToModuleIndex[parsed.fileIndex] = { index: Number(i), loc: parsed.loc };
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
                logger.warn(`Unable to determine module function for ${file}`)
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
        dcgReach++;

        if (SCGreach.has(replocToIndex.get(reploc)!))
            comReach++;
        else
            logger.info(`Function ${reploc} (${floc}) is unreachable in ${file2}`);
    }

    return [dcgReach, comReach];
}

/**
 * Compares two call graphs, reports missing files, function and edges and precision/recall.
 * @param file1 "actual" call graph
 * @param file2 "predicted" call graph
 */
export function compareCallGraphs(file1: string, file2: string) {
    logger.info(`Comparing ${file1} and ${file2}`);
    const cg1 = JSON.parse(readFileSync(file1, "utf8")) as CallGraph;
    const cg2 = JSON.parse(readFileSync(file2, "utf8")) as CallGraph;
    const ignores1 = getIgnores(cg1);
    const ignores2 = getIgnores(cg2);
    compareStringArrays(cg1.entries, cg2.entries, file1, file2, "Entry");
    compareStringArrays(cg2.entries, cg1.entries, file2, file1, "Entry");
    const file2files = compareStringArrays(cg1.files, cg2.files, file1, file2, "File");
    const file1files = compareStringArrays(cg2.files, cg1.files, file2, file1, "File");
    compareLocationObjects(cg1.functions, cg2.functions, file1, file2, cg1, cg2, file2files, "Function", ignores2);
    compareLocationObjects(cg2.functions, cg1.functions, file2, file1, cg2, cg1, file1files,  "Function", ignores1);
    compareLocationObjects(cg1.calls, cg2.calls, file1, file2, cg1, cg2, file2files, "Call", ignores2);
    compareLocationObjects(cg2.calls, cg1.calls, file2, file1, cg2, cg1, file1files, "Call", ignores1);
    // measure precision/recall in terms of individual call edges
    const [foundFun1, totalFun1] = compareEdges(cg1.fun2fun, cg2.fun2fun, file1, file2, cg1, cg2, file2files, "Function", "functions", ignores2);
    const [foundFun2, totalFun2] = compareEdges(cg2.fun2fun, cg1.fun2fun, file2, file1, cg2, cg1, file1files, "Function", "functions", ignores1);
    const [foundCall1, totalCall1] = compareEdges(cg1.call2fun, cg2.call2fun, file1, file2, cg1, cg2, file2files, "Call", "calls", ignores2);
    const [foundCall2, totalCall2] = compareEdges(cg2.call2fun, cg1.call2fun, file2, file1, cg2, cg1, file1files, "Call", "calls", ignores1);
    // measure recall in terms of reachable functions
    const [dcgReach, comReach] = computeReachableFunctions(file2, cg1, cg2);
    logger.info(`Function->function edges in ${file2} that are also in ${file1}: ${foundFun2}/${totalFun2} (${percent(foundFun2 / totalFun2)})`);
    logger.info(`Function->function edges in ${file1} that are also in ${file2}: ${foundFun1}/${totalFun1} (${percent(foundFun1 / totalFun1)})`);
    logger.info(`Call->function edges in ${file2} that are also in ${file1}: ${foundCall2}/${totalCall2} (${percent(foundCall2 / totalCall2)})`);
    logger.info(`Call->function edges in ${file1} that are also in ${file2}: ${foundCall1}/${totalCall1} (${percent(foundCall1 / totalCall1)})`);
    const {precision, recall} = compareCallSiteEdges(cg1, cg2, ignores1, ignores2);
    logger.info(`Per-call average precision: ${percent(precision)}, recall: ${percent(recall)}`);
    logger.info(`Functions in ${file1} that are reachable in ${file2}: ${comReach}/${dcgReach}${dcgReach > 0? ` (${percent(comReach / dcgReach)})` : ""}`)
}
