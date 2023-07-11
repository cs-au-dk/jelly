import {readFileSync} from "fs";
import {CallGraph} from "../typings/callgraph";
import {addAll, mapGetSet, percent} from "../misc/util";
import logger from "../misc/logger";
import {LocationJSON} from "../misc/util";
import assert from "assert";

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
    const match = /^(?<fileIndex>\d+):(?<start>(?:\d+:\d+|\?:\?)):(?<end>(?:\d+:\d+|\?:\?))$/.exec(str);
    // TODO: warn on missing start/end?
    assert.ok(match, `${kind} location ${str} does not match expected format`);
    const { fileIndex, start, end } = match.groups!;
    const file = cg.files[Number(fileIndex)];
    // stripping start locations for calls and end locations for functions (workaround like in soundnesstester)
    const rest = kind === "Call"? end : start;
    return {str: `${file}:${rest}`, file};
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
    const [foundFun1, totalFun1] = compareEdges(cg1.fun2fun, cg2.fun2fun, file1, file2, cg1, cg2, file2files, "Function", "functions", ignores2);
    const [foundFun2, totalFun2] = compareEdges(cg2.fun2fun, cg1.fun2fun, file2, file1, cg2, cg1, file1files, "Function", "functions", ignores1);
    const [foundCall1, totalCall1] = compareEdges(cg1.call2fun, cg2.call2fun, file1, file2, cg1, cg2, file2files, "Call", "calls", ignores2);
    const [foundCall2, totalCall2] = compareEdges(cg2.call2fun, cg1.call2fun, file2, file1, cg2, cg1, file1files, "Call", "calls", ignores1);
    logger.info(`Function->function edges in ${file2} that are also in ${file1}: ${foundFun2}/${totalFun2} (${percent(foundFun2 / totalFun2)})`);
    logger.info(`Function->function edges in ${file1} that are also in ${file2}: ${foundFun1}/${totalFun1} (${percent(foundFun1 / totalFun1)})`);
    logger.info(`Call->function edges in ${file2} that are also in ${file1}: ${foundCall2}/${totalCall2} (${percent(foundCall2 / totalCall2)})`);
    logger.info(`Call->function edges in ${file1} that are also in ${file2}: ${foundCall1}/${totalCall1} (${percent(foundCall1 / totalCall1)})`);
    const {precision, recall} = compareCallSiteEdges(cg1, cg2, ignores1, ignores2);
    logger.info(`Per-call average precision: ${percent(precision)}, recall: ${percent(recall)}`);
}
