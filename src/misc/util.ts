import {isIdentifier, Node, SourceLocation} from "@babel/types";
import {globalLoc} from "../analysis/analysisstate";
import assert from "assert";

export type SourceLocationWithFilename = SourceLocation & {filename: string};

export type PatchedSourceLocation = {nodeIndex: number, start?: {line: number, column: number }, end?: {line: number, column: number}};

export type SourceLocationJSON = string; // format: "<file index>:<start line>:<start column>:<end line>:<end column>"

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
        return `'${n.name}'[${sourceLocationToStringWithFile(n.loc)}]`;
    else
        return `[${sourceLocationToStringWithFileAndEnd(n.loc)}]`;
}

/**
 * Returns a string representation of the given source location.
 */
export function sourceLocationToString(loc: SourceLocationWithFilename | SourceLocation | PatchedSourceLocation | null | undefined, withFilename: boolean = false, withEnd: boolean = false) {
    if (!loc || loc === globalLoc)
        return "?";
    const file = withFilename && "filename" in loc ? `${loc.filename}` : "";
    const start = loc.start && loc.start.line !== 0 ? `${loc.start.line}:${loc.start.column + 1}` : "";
    const end = withEnd && loc.end && loc.end.line !== 0 ? `:${loc.end.line}:${loc.end.column + 1}` : "";
    const extra = "nodeIndex" in loc ? `$${loc.nodeIndex}` : ""; // for uniquely naming AST nodes with missing source location
    return file + (file && start ? ":" : "") + start + end + extra;
}

/**
 * Returns a string representation of the given source location, including filename.
 */
export function sourceLocationToStringWithFile(loc: SourceLocationWithFilename | SourceLocation | PatchedSourceLocation | null | undefined) {
    return sourceLocationToString(loc, true);
}

/**
 * Returns a string representation of the given source location, including filename and end position.
 */
export function sourceLocationToStringWithFileAndEnd(loc: SourceLocationWithFilename | SourceLocation | PatchedSourceLocation | null | undefined) {
    return sourceLocationToString(loc, true, true);
}

/**
 * Checks whether the given file and line belong to the source location range.
 */
export function sourceLocationContains(loc: SourceLocationWithFilename | SourceLocation | PatchedSourceLocation | null | undefined, file: string, line: number): boolean {
    return Boolean(loc && loc.start && loc.end && "filename" in loc && loc.filename === file && loc.start.line <= line && line <= loc.end.line);
}

/**
 * Checks whether the first source location is within the second source location.
 */
export function sourceLocationIn(loc1: SourceLocation, loc2: SourceLocation | undefined | null): boolean {
    if (!loc2)
        return false;
    let start = loc2.start.line < loc1.start.line ||
        (loc2.start.line === loc1.start.line && loc2.start.column <= loc1.start.column);
    let end = loc1.end.line < loc2.end.line ||
        (loc1.end.line === loc2.end.line && loc2.end.column <= loc1.end.column);
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

export function mapGetArray<K, V>(m: Map<K, Array<V>>, k: K): Array<V> {
    let mt = m.get(k);
    if (!mt) {
        mt = [];
        m.set(k, mt);
    }
    return mt;
}

export function getOrSet<K, V>(m: Map<K, V>, k: K, v: () => V): V {
    let r = m.get(k);
    if (!r) {
        r = v();
        m.set(k, r);
    }
    return r;
}

export function arrayToString(a: Array<any>, sep: string): string {
    return a.length === 0 ? "-" : sep + a.join(sep);
}

export function mapMapSize<K1, K2, V>(m: Map<K1, Map<K2, V>>): number {
    let c = 0;
    for (const n of m.values())
        c += n.size
    return c;
}

export function mapSetAddAll<K, V>(from: Map<K, Set<V>>, to: Map<K, Set<V>>) {
    for (const [k, vs] of from)
        addAll(vs, mapGetSet(to, k));
}

export function addAll<T>(from: Iterable<T> | Set<T> | Array<T> | undefined, to: Set<T>): number {
    if (!from)
        return 0;
    const before = to.size;
    for (const x of from)
        to.add(x);
    return to.size - before;
}

export function mapArrayAdd<K, V>(k: K, v: V, m: Map<K, Array<V>>) {
    let a = m.get(k);
    if (!a) {
        a = [];
        m.set(k, a);
    }
    a.push(v);
}

export function deleteAll<T>(xs: Iterable<T>, s: Set<T>) {
    for (const x of xs)
        s.delete(x);
}

export function deleteMapSetAll<K, V>(m: Map<K, Set<V>>, k: K, vs: Set<V>) {
    const s = m.get(k);
    if (s) {
        deleteAll(vs.values(), s);
        if (s.size === 0)
            m.delete(k);
    }
}

/**
 * Computes a hashcode for the given string.
 */
export function strHash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++)
        h = Math.imul(31, h) + s.charCodeAt(i) | 0;
    return h;
}

/**
 * Checks whether the given property name is an array index.
 */
export function isArrayIndex(prop: string): boolean {
    return Number.isSafeInteger(parseFloat(prop)) && parseInt(prop) >= 0; // TODO: more precise check for isArrayIndex?
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

    makeLocString(loc: SourceLocationWithFilename | SourceLocation | undefined | null): SourceLocationJSON {
        assert(loc && "filename" in loc); // TODO: assertion may fail?
        return `${this.getFileIndex(loc.filename)}:${loc.start.line}:${loc.start.column + 1}:${loc.end.line}:${loc.end.column + 1}`;
    }
}