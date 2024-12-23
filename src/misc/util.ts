import {isIdentifier, Node, SourceLocation} from "@babel/types";
import assert from "assert";
import {ModuleInfo} from "../analysis/infos";
import {CallGraph} from "../typings/callgraph";
import logger from "./logger";

export type SimpleLocation = {
    start: {
        line: number;
        column: number;
    };
    end: {
        line: number;
        column: number;
    };
};

/**
 * Source location with extra information.
 * 'module' is set if the location belongs to a specific module, and undefined for globals.
 * 'native' is set if the location comes from a native model.
 * 'nodeIndex' is set by AST preprocessing at nodes with missing source location (see locationToString).
 * 'unbound' is set to true if this is a location for an artificially declared unbound identifier.
 */
export type Location = SimpleLocation & {
    module?: ModuleInfo;
    native?: string;
    nodeIndex?: number;
    unbound?: boolean;
};

export type LocationJSON = string; // format: "<file index>:<start line>:<start column>:<end line>:<end column>"

/**
 * Normalized path to a file or directory.
 */
export type FilePath = string;

/**
 * True/False/Maybe.
 */
export enum Ternary {
    True = 1,
    False = 0,
    Maybe = -1
}

/**
 * Ternary "or" operator.
 */
export function ternaryOr(t1: Ternary, t2: Ternary): Ternary {
    return t1 === Ternary.True || t2 === Ternary.True ? Ternary.True :
        t1 === Ternary.Maybe || t2 === Ternary.Maybe ? Ternary.Maybe :
            Ternary.False;
}

export function ternaryToString(t: Ternary): string {
    switch (t) {
        case Ternary.True:
            return "true";
        case Ternary.False:
            return "false";
        case Ternary.Maybe:
            return "maybe";
    }
}

/**
 * Returns a string representation of the given AST node.
 */
export function nodeToString(n: Node): string {
    if (isIdentifier(n))
        return `'${n.name}'[${locationToStringWithFile(n.loc, true)}]`;
    else
        return `[${locationToStringWithFileAndEnd(n.loc, true)}]`;
}

/**
 * Returns a string representation of the given source location.
 */
export function locationToString(loc: Location | null | undefined, withFilename: boolean = false, withEnd: boolean = false, useModuleName?: boolean) {
    if (!loc)
        return "?";
    const file =
        withFilename ?
            useModuleName ?
                "module" in loc ? loc.module?.toString() : "" :
                "filename" in loc ? loc.filename : "?" :
            "";
    const start = loc.start && loc.start.line !== 0 ? `${loc.start.line}:${loc.start.column + 1}` : "";
    const end = withEnd && loc.end && loc.end.line !== 0 ? `:${loc.end.line}:${loc.end.column + 1}` : "";
    const extra = "nodeIndex" in loc ? `$${loc.nodeIndex}` : ""; // for uniquely naming AST nodes with missing source location
    const native = loc.native ?? "";
    return file + (file && start ? ":" : "") + start + end + extra + native;
}

/**
 * Returns a string representation of the given source location, including filename.
 */
export function locationToStringWithFile(loc: Location | null | undefined, useModuleName?: boolean) {
    return locationToString(loc, true, false, useModuleName);
}

/**
 * Returns a string representation of the given source location, including filename and end position.
 */
export function locationToStringWithFileAndEnd(loc: Location | null | undefined, useModuleName?: boolean) {
    return locationToString(loc, true, true, useModuleName);
}

/**
 * Checks whether the given file and line belong to the source location range.
 */
export function locationContains(loc: Location | null | undefined, file: string, line: number): boolean {
    return Boolean(loc && loc.start && loc.end && "module" in loc && loc.module && loc.module.getPath() === file && loc.start.line <= line && line <= loc.end.line);
}

/**
 * Checks whether the first source location is within the second source location.
 */
export function locationIn(loc1: SimpleLocation, loc2: SimpleLocation | undefined | null): boolean {
    if (!loc2)
        return false;
    const start = loc2.start.line < loc1.start.line ||
        (loc2.start.line === loc1.start.line && loc2.start.column <= loc1.start.column);
    const end = loc1.end.line < loc2.end.line ||
        (loc1.end.line === loc2.end.line && loc1.end.column <= loc2.end.column);
    return start && end;
}

export function mapGetMap<K1, K2, V>(m: Map<K1, Map<K2, V>>, k: K1): Map<K2, V> {
    let mt = m.get(k);
    if (!mt) {
        mt = new Map();
        m.set(k, mt);
    }
    return mt;
}

export function mapGetSet<K, V>(m: Map<K, Set<V>>, k: K): Set<V> {
    let mt = m.get(k);
    if (!mt) {
        mt = new Set;
        m.set(k, mt);
    }
    return mt;
}

export function mapGetSetPair<K, V1, V2>(m: Map<K, [Set<V1>, V2]>, k: K, v: V2): Set<V1> {
    let mt = m.get(k);
    if (!mt) {
        mt = [new Set, v];
        m.set(k, mt);
    }
    const [ms] = mt;
    return ms;
}

export function mapGetArray<K, V>(m: Map<K, Array<V>>, k: K): Array<V>
export function mapGetArray<K extends object, V>(m: WeakMap<K, Array<V>>, k: K): Array<V>
export function mapGetArray<K, V>(m: Map<K, Array<V>> | WeakMap<any, Array<V>>, k: K): Array<V> {
    let mt = m.get(k);
    if (!mt) {
        mt = [];
        m.set(k, mt);
    }
    return mt;
}

export function pushArraySingle<K, V>(m: Map<K, Array<V> | V>, k: K, v: V, vs: Array<V> | V | undefined): Array<V> | V {
    if (Array.isArray(vs)) {
        vs.push(v);
        return vs;
    }
    if (vs === undefined) {
        m.set(k, v);
        return v;
    }
    const qs = [vs, v];
    m.set(k, qs);
    return qs;
}

export function getOrSet<K, V>(m: Map<K, V>, k: K, v: () => V): V
export function getOrSet<K extends object, V>(m: WeakMap<K, V>, k: K, v: () => V): V
export function getOrSet<K, V>(m: Map<K, V> | WeakMap<any, V>, k: K, v: () => V): V {
    let r = m.get(k);
    if (r === undefined) {
        r = v();
        m.set(k, r);
    }
    return r;
}

export function mapMapSize<K1, K2, V>(m: Map<K1, Map<K2, V>>): number {
    let c = 0;
    for (const n of m.values())
        c += n.size;
    return c;
}

export function mapSetAddAll<K, V>(from: Map<K, Set<V>>, to: Map<K, Set<V>>) {
    for (const [k, vs] of from)
        addAll(vs, mapGetSet(to, k));
}

export function mapArrayPushAll<K, V>(from: Map<K, Array<V>>, to: Map<K, Array<V>>) {
    for (const [k, vs] of from)
        pushAll(vs, mapGetArray(to, k));
}

export function mapMapSetAll<K1, K2, V>(from: Map<K1, Map<K2, V>>, to: Map<K1, Map<K2, V>>) {
    for (const [k, m] of from)
        setAll(m, mapGetMap(to, k));
}

export function mapMapMapSetAll<K1, K2, K3, V>(from: Map<K1, Map<K2, Map<K3, V>>>, to: Map<K1, Map<K2, Map<K3, V>>>) {
    for (const [k, m] of from)
        mapMapSetAll(m, mapGetMap(to, k));
}

export function addAll<T>(from: Iterable<T> | Set<T> | Array<T> | undefined, to: Set<T>): number {
    if (!from)
        return 0;
    const before = to.size;
    for (const x of from)
        to.add(x);
    return to.size - before;
}

export function setAll<K, V>(from: Map<K, V>, to: Map<K, V>) {
    for (const [k, v] of from)
        to.set(k, v);
}

export function mapArrayAdd<K, V>(k: K, v: V, m: Map<K, Array<V>>): void
export function mapArrayAdd<K extends object, V>(k: K, v: V, m: WeakMap<K, Array<V>>): void
export function mapArrayAdd<K, V>(k: K, v: V, m: Map<K, Array<V>> | WeakMap<any, Array<V>>) {
    let a = m.get(k);
    if (!a) {
        a = [];
        m.set(k, a);
    }
    a.push(v);
}

export function mapArrayAddNoDuplicates<K, V>(k: K, v: V, m: Map<K, Array<V>>, eq: (v1: V, v2: V) => boolean): void {
    let a = m.get(k);
    if (!a) {
        a = [];
        m.set(k, a);
    }
    for (const w of a)
        if (eq(v, w))
            return;
    a.push(v);
}

export function mapArraySize<K, V>(m: Map<K, Array<V>>): number {
    let n = 0;
    for (const v of m.values())
        n += v.length;
    return n;
}

export function deleteAll<T>(xs: Iterable<T>, s: Set<T>) {
    for (const x of xs)
        s.delete(x);
}

export function deleteMapSetPairAll<K, V1, V2>(m: Map<K, [Set<V1>, V2]>, k: K, vs: Set<V1>) {
    const p = m.get(k);
    if (p) {
        const [s] = p;
        deleteAll(vs.values(), s);
        if (s.size === 0)
            m.delete(k);
    }
}

export function addMapHybridSet<K, V>(k: K, v: V, to: Map<K, V | Set<V>>): boolean {
    const s = to.get(k);
    let added = false;
    if (s) {
        if (s instanceof Set) {
            if (!s.has(v)) {
                s.add(v);
                added = true;
            }
        } else if (s !== v) {
            to.set(k, new Set<V>([s, v]));
            added = true;
        }
    } else {
        to.set(k, v);
        added = true;
    }
    return added;
}

export function addAllMapHybridSet<K, V>(from: Map<K, V | Set<V>>, to: Map<K, V | Set<V>>) {
    for (const [k, v] of from)
        if (v instanceof Set)
            for (const t of v)
                addMapHybridSet(k, t, to);
        else
            addMapHybridSet(k, v, to);
}

export function getMapHybridSetSize<K, V>(m: Map<K, V | Set<V>>): number {
    let c = 0;
    for (const v of m.values())
        if (v instanceof Set)
            c += v.size;
        else
            c++;
    return c;
}

export function mapSetToPairArray<K, V>(x: Map<K, Set<V>>): Array<[K, V]> {
    const res: Array<[K, V]> = [];
    for (const [k, vs] of x)
        for (const v of vs)
            res.push([k, v]);
    return res;
}

export function addPairArrayToMapSet<K,V>(from: Array<[K, V]>, to: Map<K, Set<V>>) {
    for (const [k, v] of from)
        mapGetSet(to, k).add(v);
}

/**
 * Pushes all elements from 'from' to 'to'.
 * Use this instead of "to.push(...from)",
 * see https://stackoverflow.com/questions/61740599/rangeerror-maximum-call-stack-size-exceeded-with-array-push
 */
export function pushAll<V>(from: Iterable<V>, to: Array<V>) {
    for (const x of from)
        to.push(x);
}

/**
 * Computes a hashcode for the given string.
 * https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
 */
export function strHash(s: string): number {
    let h1 = 0, h2 = 0x41c6ce570;
    for (let i = 0, ch; i < s.length; i++) {
        ch = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Checks whether the given property name is an array index.
 */
export function isArrayIndex(prop: string): boolean {
    return /^\d+$/.test(prop); // TODO: more precise check for isArrayIndex?
}

/**
 * Converts the given number to a percentage string.
 */
export function percent(x: number): string {
    return `${(100 * x).toFixed(2)}%`;
}

export class SourceLocationsToJSON {

    private readonly fileIndex = new Map<FilePath, number>();

    private readonly files: Array<string>;

    constructor(files: Array<string>) {
        this.files = files;
    }

    private getFileIndex(file: FilePath): number {
        let n = this.fileIndex.get(file);
        if (n === undefined) {
            n = this.files.length;
            this.fileIndex.set(file, n);
            this.files.push(file);
        }
        return n;
    }

    makeLocString(loc: (SourceLocation & {filename?: string}) | Location | null | undefined): LocationJSON {
        assert(loc && ("module" in loc && loc.module || "filename" in loc && loc.filename)); // TODO: assertion may fail?
        // @ts-ignore
        return `${this.getFileIndex(loc.module ? loc.module.getPath() : loc.filename)}:${loc.start.line}:${loc.start.column + 1}:${loc.end.line}:${loc.end.column + 1}`;
    }

    parseLocationJSON(loc: LocationJSON): { loc?: SimpleLocation, fileIndex: number, file: string } {
        const [_, _fileIndex, startLine, startCol, endLine, endCol] = /^(\d+):(\d+|\?):(\d+|\?):(\d+|\?):(\d+|\?)/.exec(loc)!;
        const fileIndex = Number(_fileIndex);
        assert(fileIndex < this.files.length);

        if (startLine === "?") {
            assert(startCol === "?" && endLine === "?" && endCol === "?");
            return {
                fileIndex,
                file: this.files[fileIndex],
            };
        }

        return {
            loc: {
                start: {line: Number(startLine), column: Number(startCol)-1},
                end: {line: Number(endLine), column: Number(endCol)-1},
            },
            fileIndex,
            file: this.files[fileIndex],
        };
    }
}

/*
 * Computes a mapping from calls to the function they are contained in.
 * The time complexity is linearithmic in the number of functions and calls.
 */
export function mapCallsToFunctions(cg: CallGraph): Map<number, number> {
    const parser = new SourceLocationsToJSON(cg.files);
    const ret = new Map();

    type LocationWithIndex = SimpleLocation & { index: number };
    const byFile: Array<{ functions: LocationWithIndex[], calls: LocationWithIndex[] }> =
        Array.from(cg.files, () => ({functions: [], calls: []}));

    // group functions and calls by file
    for (const kind of ["functions", "calls"] as const)
        for (const [i, loc] of Object.entries(cg[kind])) {
            const parsed = parser.parseLocationJSON(loc);
            if (!parsed.loc)
                continue;

            byFile[parsed.fileIndex][kind].push({...parsed.loc, index: Number(i)});
        }

    function compareLC(a: { line: number, column: number }, b: { line: number, column: number }): number {
        return a.line !== b.line ? a.line - b.line : a.column - b.column;
    }

    // orders source locations primarily in ascending order by start location
    // ties are broken first by descending order of end locations and then index.
    function compareSL(a: LocationWithIndex, b: LocationWithIndex): number {
        return compareLC(a.start, b.start) || -compareLC(a.end, b.end) || a.index - b.index;
    }

    for (const [i, {functions, calls}] of byFile.entries()) {
        if (functions.length === 0) {
            logger.error(`Call graph contains file ${cg.files[i]} without functions`);
            continue;
        }

        functions.sort(compareSL);
        calls.sort(compareSL);

        let synthModFun: LocationWithIndex | undefined = functions[0];
        if (synthModFun.start.line !== 1 || synthModFun.start.column !== 0) {
            const funs = functions.map(f => parser.makeLocString({...f, filename: cg.files[i]})).join("\n\t");
            logger.warn(`No synthetic module function for file ${cg.files[i]}\nFunctions:\n\t${funs}`);
            synthModFun = undefined;
        }

        // sweep over functions and calls simultaneously, maintaining a stack of functions
        const stack = [];
        let funIndex = 0;

        for (const call of calls) {
            if (synthModFun && !locationIn(call, synthModFun)) {
                const cs = parser.makeLocString({...call, filename: cg.files[i]});
                const fs = parser.makeLocString({...synthModFun, filename: cg.files[i]});
                logger.error(`Call ${cs} is outside module function (${fs})`);
                continue;
            }

            // remove functions that ended before the call starts
            while (stack.length && compareLC(stack[stack.length-1]!.end, call.start) <= 0)
                stack.pop();

            // add functions that started before the call (but didn't end yet)
            while (funIndex < functions.length) {
                const fun = functions[funIndex], cmp = compareLC(fun.start, call.start);
                // require that the function starts strictly before the call, unless the function is
                // the synthetic module function. requiring that calls are stricly before functions
                // is required due to how functions sometimes have incorrect start positions in the
                // dynamic analysis
                if (cmp < 0 || (cmp === 0 && fun.start.line === 1 && fun.start.column === 0)) {
                    funIndex++;

                    if (compareLC(fun.end, call.start) > 0)
                        stack.push(fun);
                } else
                    break;
            }

            if (stack.length === 0) {
                logger.error(`No function surrounding call ${parser.makeLocString({...call, filename: cg.files[i]})}!`);
                continue;
            }

            const fun = stack[stack.length-1];
            if (!locationIn(call, fun)) {
                // this should not happen!
                // one case has been observed where the same file is loaded multiple times in the dynamic
                // analysis with different contents, which results in a dynamic CG with functions that
                // cannot be properly nested within eachother
                const cs = parser.makeLocString({...call, filename: cg.files[i]}),
                    fs = parser.makeLocString({...fun, filename: cg.files[i]});
                logger.error(`Error: ${cs} should be in ${fs}`);
            }

            ret.set(call.index, fun.index);
        }
    }

    return ret;
}

/**
 * Finds the longest common prefix of the given strings.
 * (As a side-effect, the given array is sorted.)
 */
export function longestCommonPrefix(a: Array<string>): string {
    const size = a.length;
    if (size == 0)
        return "";
    if (size == 1)
        return a[0];
    a.sort();
    const end = Math.min(a[0].length, a[size - 1].length);
    let i = 0;
    while (i < end && a[0][i] === a[size - 1][i])
        i++;
    return a[0].substring(0, i);
}

export function stringify(x: any, space: string | number = 2): string {
    return JSON.stringify(x, (_k, v) => typeof v === "bigint" ? Number(v / 1000000n) : v, space);
}
