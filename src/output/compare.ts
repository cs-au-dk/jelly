import {readFileSync} from "fs";
import {CallGraph} from "../typings/callgraph";
import {LocationJSON, SourceLocationsToJSON, mapArrayAdd, mapCallsToFunctions, mapGetSet, percent, SimpleLocation, addAll} from "../misc/util";
import logger from "../misc/logger";
import assert from "assert";

/*
 * FileFilter creates a file filtering function based on one or two call graphs.
 * The filter excludes files based on the 'ignoreDependencies', 'files', 'includePackages' and 'excludePackages'
 * fields of the provided call graphs.
 */
class FileFilter {
    readonly files: Set<string>;
    private readonly ignoreDependencies: boolean;
    private readonly incl: Set<string> | undefined;
    private readonly excl: Set<string>;

    constructor(cg1: CallGraph, cg2?: CallGraph) {
        const intersect = <T>(a: Set<T>, b: Set<T>) => {
            for (const x of a)
                if (!b.has(x))
                    a.delete(x);
        };

        // intersect files
        this.files = new Set(cg1.files);
        if (cg2?.files)
            intersect(this.files, new Set(cg2.files));

        // intersect includePackages
        if (cg1.includePackages) {
            this.incl = new Set(cg1.includePackages);
            if (cg2?.includePackages)
                intersect(this.incl, new Set(cg2.includePackages));
        } else if (cg2?.includePackages)
            this.incl = new Set(cg2.includePackages);

        // union excludePackages
        this.excl = new Set(cg1.excludePackages ?? []);
        addAll(cg2?.excludePackages, this.excl);

        this.ignoreDependencies = cg1.ignoreDependencies || cg2?.ignoreDependencies || false;
    }

    /**
     * Checks whether the file belongs to one of the packages.
     */
    private static fileInPackages(file: string, pcks: Set<string>): boolean {
        for (const pck of pcks)
            if (file.includes(`node_modules/${pck}/`) || file.includes(`node_modules\\${pck}\\`))
                return true;
        return false;
    }

    /**
     * Returns whether the file is included.
     */
    isIncluded(file: string, msg: boolean) {
        if (this.ignoreDependencies && !this.files.has(file)) {
            if (msg)
                logger.info(`Ignoring file ${file} (ignoring dependencies)`);
            return false;
        }
        if (!(file.includes("node_modules/") || file.includes("node_modules\\")))
            return true;
        if (this.incl && !FileFilter.fileInPackages(file, this.incl)) {
            if (msg)
                logger.info(`Ignoring file ${file} (not in included package)`);
            return false;
        }
        if (this.excl.size && FileFilter.fileInPackages(file, this.excl)) {
            if (msg)
                logger.info(`Ignoring file ${file} (in excluded package)`);
            return false;
        }
        return true;
    }
}

function compareFileArrays(as1: Array<string>, cg2: CallGraph, file1: string, file2: string): FileFilter {
    const filter = new FileFilter(cg2);
    for (const e of as1)
        if (!filter.files.has(e) && filter.isIncluded(e, true))
            logger.warn(`File ${e} found in ${file1}, missing in ${file2}`);
    return filter;
}

function compareEntryArrays(as1: Array<string>, as2: Array<string>, file1: string, file2: string) {
    const s = new Set<string>(as2);
    for (const e of as1)
        if (!s.has(e))
            logger.warn(`Entry ${e} found in ${file1}, missing in ${file2}`);
}

// Functions: dyn.ts sometimes reports incorrect end locations for functions.
// Example in tests/micro/classes.js: synthetic function for f8 initializer ends on line 29 (in dynamic call graph)
// Example in tests/mochatest/require-hook.js: function on line 2 ends on column 117 instead of 116
// Unfortunately we also have trouble matching functions based on their start locations, as babel does not
// always include location information for some tokens that are part of the function declaration
// (brackets in ["foo"]() { ... }).
// Calls: dyn.ts sometimes reports incorrect start source locations for call expressions
// with parenthesized base expressions (see tests/micro/call-expressions.js).
// Due to these issues we try to match functions and calls on both their start and end locations.

/**
 * Returns a canonical representation of a LocationJSON string that is suitable for matching
 * between call graphs collected from dynamic and static analysis.
 */
function loc(str: LocationJSON, cg: CallGraph): {start: string, end: string, file: string} {
    const parsed = new SourceLocationsToJSON(cg.files).parseLocationJSON(str);
    let start = "?:?", end = "?:?";
    if (parsed.loc) {
        start = `${parsed.loc.start.line}:${parsed.loc.start.column + 1}`;
        end = `${parsed.loc.end.line}:${parsed.loc.end.column + 1}`;
    }
    return {start: `${parsed.file}:${start}`, end: `${parsed.file}:${end}`, file: parsed.file};
}

/*
 * Computes bidirectional mappings from locations in cg1 to locations in cg2 and vice versa.
 * A mapping from loc a in cg1 to loc b in cg2 is added if a and b have equal start _or_ end locations.
 */
function matchLocationObjects(
    cg1: CallGraph,
    cg2: CallGraph,
    prop: "functions" | "calls",
    ignores: Set<string>,
): [Map<number, Set<number>>, Map<number, Set<number>>] {
    const starts = new Map<string, Array<number>>();
    const ends = new Map<string, Array<number>>();
    for (const [i, rawloc] of Object.entries(cg1[prop])) {
        const {start, end} = loc(rawloc, cg1);
        if (prop === "functions" && ignores.has(start)) {
            logger.debug(`Ignoring ${start}`);
            continue;
        }
        mapArrayAdd(start, Number(i), starts);
        mapArrayAdd(end, Number(i), ends);
    }

    const aToB = new Map<number, Set<number>>();
    const bToA = new Map<number, Set<number>>();

    for (const [j, rawloc] of Object.entries(cg2[prop])) {
        const {start, end} = loc(rawloc, cg2);
        if (prop === "functions" && ignores.has(start)) {
            logger.debug(`Ignoring ${start}`);
            continue;
        }

        const is = new Set([...starts.get(start) ?? [], ...ends.get(end) ?? []]);
        if (!is.size)
            continue;

        const jn = Number(j);
        bToA.set(jn, is);
        for (const i of is) mapGetSet(aToB, i).add(jn);
    }

    return [aToB, bToA];
}

function compareLocationObjects(
    match: Map<number, unknown>,
    cg: CallGraph,
    file1: string,
    file2: string,
    kind: "Function" | "Call",
    ignores: Set<string>,
    filter: FileFilter,
) {
    for (const [i, rawloc] of Object.entries(kind === "Function" ? cg.functions : cg.calls)) {
        const {start: q, file: f} = loc(rawloc, cg);
        if (!match.has(Number(i)) && (kind !== "Function" || !ignores.has(q))) {
            const extra = !filter.files.has(f) ? ` (file ${f} missing)` : "";
            logger.warn(`${kind} ${q} found in ${file1}, missing in ${file2}${extra}`);
        }
    }
}

function compareEdges(
    file1: string,
    file2: string,
    cg1: CallGraph,
    cg2: CallGraph,
    kind: "Function" | "Call",
    matchCalls: Map<number, Set<number>>,
    matchFuns: Map<number, Set<number>>,
    ignores: Set<string>,
    filter: FileFilter,
): [number, number, number] {
    const sourceProp = kind === "Function" ? "functions" : "calls";
    const edgesProp = kind === "Function" ? "fun2fun" : "call2fun";
    const s = new Set<string>();
    for (const [i, j] of cg2[edgesProp]) {
        if (!cg2[sourceProp][i])
            assert.fail(`cg2.${sourceProp}[${i}] is undefined`);
        if (!cg2.functions[j])
            assert.fail(`cg2.functions[${j}] is undefined`);
        s.add(`${i} -> ${j}`);
    }
    let found = 0, missed = 0, ignored = 0;
    for (const [i, j] of cg1[edgesProp]) { // TODO: assuming no duplicate pairs
        if (!cg1[sourceProp][i])
            assert.fail(`cg1.${sourceProp}[${i}] is undefined`);
        if (!cg1.functions[j])
            assert.fail(`cg1.functions[${j}] is undefined`);
        const {start: fstart, end: from, file: ff} = loc(cg1[sourceProp][i], cg1);
        const {start: tstart, end: to, file: ft} = loc(cg1.functions[j], cg1);
        if (kind === "Function" && ignores.has(fstart) || ignores.has(tstart)) {
            logger.debug(`Ignoring ${from} -> ${to}`);
            continue;
        }
        const i2s = Array.from(matchCalls.get(i) ?? []), j2s = Array.from(matchFuns.get(j) ?? []);
        if (!i2s.flatMap(i2 => j2s.map(j2 => `${i2} -> ${j2}`)).some(e => s.has(e))) {
            if (filter.isIncluded(ff, false) &&
                filter.isIncluded(ft, false)) {
                const extra = !filter.files.has(ff) ? ` (file ${ff} missing)` : !filter.files.has(ft) ? ` (file ${ft} missing)` : "";
                logger.info(`${kind}->function edge ${fstart} -> ${tstart} found in ${file1}, missing in ${file2}${extra}`);
                missed++;
            } else
                ignored++;
        } else
            found++;
    }
    return [found, found + missed, ignored];
}

/*
 * Returns the precision and recall of call->function edges in cg1 compared to cg2.
 * The values are averaged over all call sites in cg1.
 * Sources:
 * - https://manu.sridharan.net/files/ICSE-2013-Approximate.pdf
 * - https://github.com/asgerf/callgraphjs/blob/master/evaluate.js
 */
function compareCallSiteEdges(
    cg1: CallGraph,
    cg2: CallGraph,
    call2ToCall1: Map<number, Set<number>>,
    fun2ToFun1: Map<number, Set<number>>,
    ignores: Set<string>,
): {precision: number, recall: number} {
    const filter = new FileFilter(cg1, cg2);
    const floc = (s: string, cg: CallGraph) => filter.isIncluded(loc(s, cg).file, false);
    const e1 = new Map<number, Set<number>>();
    for (const [c, f] of cg1.call2fun) {
        if (!floc(cg1.calls[c], cg1) || !floc(cg1.functions[f], cg1))
            continue;
        if (ignores.has(loc(cg1.functions[f], cg1).start)) {
            // logger.debug(`Ignoring ${from} -> ${to}`);
            continue;
        }
        mapGetSet(e1, c).add(f);
    }
    const e2 = new Map<number, Set<number>>();
    for (const [c, f] of cg2.call2fun) {
        if (!floc(cg2.calls[c], cg2) || !floc(cg2.functions[f], cg2))
            continue;
        for (const i of call2ToCall1.get(c) ?? [])
            for (const j of fun2ToFun1.get(f) ?? [])
                mapGetSet(e2, i).add(j);
    }
    const ps = [], rs = [];
    for (const [from, s1] of e1) {
        const s2 = e2.get(from) ?? new Set;
        const pos = Array.from(s1).reduce((acc, f) => acc + (s2.has(f) ? 1 : 0), 0);
        ps.push(s2.size > 0 ? pos / s2.size : 1);
        rs.push(pos / s1.size);
    }
    const avg = (xs: Array<number>) => xs.reduce((acc, x) => acc + x, 0) / (xs.length || 1);
    return {precision: avg(ps), recall: avg(rs)};
}

function getIgnores(...cgs: CallGraph[]): Set<string> {
    const s = new Set<string>();
    for (const cg of cgs)
        for (const p of cg.ignore ?? [])
            s.add(loc(p, cg).start);
    return s;
}

/**
 * Returns the number of functions in cg1, the number of reachable functions
 * in cg2, and the number of functions in cg1 that are reachable in cg2.
 * Reachability in cg2 is computed from all application modules in cg2.
 */
function computeReachableFunctions(
    file2: string,
    cg1: CallGraph,
    cg2: CallGraph,
    fun1ToFun2: Map<number, Set<number>>,
    ignores: Set<string>,
    filter: FileFilter,
): [number, number, number] {
    const parser = new SourceLocationsToJSON(cg2.files);
    // find the module entry function for each file by looking for functions
    // that begin at position 1:1 and span the longest
    const fileToModuleIndex: Array<{ index: number, loc: SimpleLocation } | undefined> = new Array(cg2.files.length);
    for (const [i, floc] of Object.entries(cg2.functions)) {
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
            logger.debug(`\t${loc(cg2.functions[i], cg2).end}`);
    }

    let dcgReach = 0, comReach = 0;
    for (const [i, rawloc] of Object.entries(cg1.functions)) {
        const {start, file} = loc(rawloc, cg1);
        if (ignores.has(start) || !filter.isIncluded(file, false))
            continue;
        dcgReach++;
        if (Array.from(fun1ToFun2.get(Number(i)) ?? []).some(j => SCGreach.has(j)))
            comReach++;
        else
            logger.info(`Function ${start} is unreachable in ${file2}`);
    }

    // report edges from cg1 where only the source is reachable
    function checkEdge(a: number, b: number, kind: "function" | "call" = "function", rloc?: string) {
        const {start: aloc, file: file1} = loc(cg1.functions[a], cg1);
        if (ignores.has(aloc) || !filter.isIncluded(file1, false) ||
                !Array.from(fun1ToFun2.get(a) ?? []).some(f => SCGreach.has(f)))
            return;
        const {start: bloc, file: file2} = loc(cg1.functions[b], cg1);
        if (!ignores.has(bloc) && filter.isIncluded(file2, false) &&
                !Array.from(fun1ToFun2.get(b) ?? []).some(f => SCGreach.has(f)))
            logger.info(`Missed ${kind}->function edge ${rloc ?? aloc} -> ${bloc} could increase reachability recall`);
    }

    for (const [a, b] of cg1.fun2fun)
        checkEdge(a, b);

    const callFunIdx = mapCallsToFunctions(cg1);
    for (const [a, b] of cg1.call2fun) {
        const af = callFunIdx.get(a);
        if (af === undefined)
            continue;
        const {start} = loc(cg1.calls[a], cg1);
        checkEdge(af, b, "call", start);
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
    compareReachability: boolean = false,
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
    compareEntryArrays(cg1.entries ?? [], cg2.entries ?? [], file1, file2);
    if (compareBothWays)
        compareEntryArrays(cg2.entries ?? [], cg1.entries ?? [], file2, file1);
    const filter2 = compareFileArrays(cg1.files, cg2, file1, file2);
    const filter1 = compareBothWays && compareFileArrays(cg2.files, cg1, file2, file1) || undefined;
    const ignores = getIgnores(cg1, cg2);
    const [fun1ToFun2, fun2ToFun1] = matchLocationObjects(cg1, cg2, "functions", ignores);
    compareLocationObjects(fun1ToFun2, cg1, file1, file2, "Function", ignores, filter2);
    if (compareBothWays)
        compareLocationObjects(fun2ToFun1, cg2, file2, file1, "Function", ignores, filter1!);
    const [call1ToCall2, call2ToCall1] = matchLocationObjects(cg1, cg2, "calls", ignores);
    compareLocationObjects(call1ToCall2, cg1, file1, file2, "Call", ignores, filter2);
    if (compareBothWays)
        compareLocationObjects(call2ToCall1, cg2, file2, file1, "Call", ignores, filter1!);
    // measure precision/recall in terms of individual call edges
    const [foundFun1, totalFun1, ignoredFun1] = compareEdges(file1, file2, cg1, cg2, "Function", fun1ToFun2, fun1ToFun2, ignores, filter2);
    const [foundFun2, totalFun2, ignoredFun2] = compareBothWays &&
        compareEdges(file2, file1, cg2, cg1, "Function", fun2ToFun1, fun2ToFun1, ignores, filter1!) || [0, 0, 0];
    const [foundCall1, totalCall1, ignoredCall1] = compareEdges(file1, file2, cg1, cg2, "Call", call1ToCall2, fun1ToFun2, ignores, filter2);
    const [foundCall2, totalCall2, ignoredCall2] = compareBothWays &&
        compareEdges(file2, file1, cg2, cg1, "Call", call2ToCall1, fun2ToFun1, ignores, filter1!) || [0, 0, 0];
    // measure recall in terms of reachable functions
    const [dcgReach, scgReach, comReach] = compareReachability && computeReachableFunctions(file2, cg1, cg2, fun1ToFun2, ignores, filter2) || [0, 0, 0];

    const formatFraction = (num: number, den: number) => `${num}/${den}${den === 0 ? "" : ` (${percent(num / den)})`}`;
    if (ignoredFun1 > 0 || ignoredCall1 > 0)
        logger.info(`Ignored in ${file1}: ${ignoredFun1} functions, ${ignoredCall1} calls`);
    if (ignoredFun2 > 0 || ignoredCall2 > 0)
        logger.info(`Ignored in ${file2}: ${ignoredFun2} functions, ${ignoredCall2} calls`);
    if (compareBothWays)
        logger.info(`Function->function edges in ${file2} that are also in ${file1}: ${formatFraction(foundFun2, totalFun2)}`);
    logger.info(`Function->function edges in ${file1} that are also in ${file2}: ${formatFraction(foundFun1, totalFun1)}`);
    if (compareBothWays)
        logger.info(`Call->function edges in ${file2} that are also in ${file1}: ${formatFraction(foundCall2, totalCall2)}`);
    logger.info(`Call->function edges in ${file1} that are also in ${file2}: ${formatFraction(foundCall1, totalCall1)}`);
    const {precision, recall} = compareCallSiteEdges(cg1, cg2, call2ToCall1, fun2ToFun1, ignores);
    logger.info(`Per-call average precision: ${percent(precision)}, recall: ${percent(recall)}`);
    if (compareReachability) {
        if (compareBothWays)
            logger.info(`Reachable functions and modules in ${file2} that are also in ${file1}: ${formatFraction(comReach, scgReach)}`);
        logger.info(`Functions and modules in ${file1} that are reachable in ${file2}: ${formatFraction(comReach, dcgReach)}`);
    }

    return {
        fun2funFound: foundFun1, fun2funTotal: totalFun1,
        call2funFound: foundCall1, call2funTotal: totalCall1,
        reachableFound: comReach, reachableTotal: dcgReach,
    };
}
