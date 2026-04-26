/**
 * callstacks-file serializer.
 *
 * Produces a JSON array of per-vulnerability call-stack records. Shape:
 *
 *     [
 *       {
 *         vulnerability: Vulnerability,
 *         paths: {
 *           analysisLevel: "function-level",
 *           stacks: Frame[][]
 *         }
 *       },
 *       ...
 *     ]
 *
 * Each inner Frame array is one call stack, ordered from the deepest
 * known caller at index 0 down to the vulnerability sink at the last
 * index. The deepest caller is an entry-package function when one is
 * reachable; otherwise it is the topmost function the reverse BFS
 * reached before exhausting callers (graph dead-end, or all remaining
 * callers were already on the path — i.e. a cycle). Multiple distinct
 * paths to the same vuln produce multiple stack arrays under the same
 * record's `paths.stacks`.
 *
 * Only vulnerabilities with at least one path appear in the output; vulns
 * submitted via -v that produce no paths are omitted entirely.
 */

import {writeFileSync} from "fs";
import type {Node as BabelNode} from "@babel/types";
import {FunctionInfo, ModuleInfo} from "../analysis/infos";
import Solver from "../analysis/solver";
import logger from "../misc/logger";
import {Location} from "../misc/util";
import {VulnerabilityResults} from "../patternmatching/vulnerabilitydetector";
import {getVulnerabilityId, Vulnerability} from "../typings/vulnerabilities";

export interface FrameSourceLocation {
    start: {line: number; column: number};
    end: {line: number; column: number};
    filename: string;
}

export interface Frame {
    package: string;
    sourceLocation: FrameSourceLocation;
    confidence: number;
}

export interface VulnPaths {
    vulnerability: Vulnerability;
    paths: {
        analysisLevel: "function-level";
        stacks: Frame[][];
    };
}

export type CallStacksOutput = VulnPaths[];

/**
 * Match-site map consumed by the path-finder. The key type is `unknown` on
 * purpose: the BFS treats keys opaquely (identity equality + dispatch
 * through CallGraphLike), so the same code handles both
 * `Map<BabelNode, ...>` (call sites) and `Map<FunctionInfo | ModuleInfo,
 * ...>` (function bodies) without parameterizing the serializer. The
 * adapter knows how to interpret each concrete key type.
 */
export type VulnSites = Map<unknown, Set<Vulnerability>>;

/**
 * Read-only adapter the serializer uses to walk the call graph.
 * `saveCallStacks` builds one over Solver state; tests build mock graphs.
 */
export interface CallGraphLike {
    callersOf(node: unknown): Iterable<unknown>;
    isEntry(node: unknown): boolean;
    frameFor(node: unknown): Frame | null;
}

/**
 * Optional caps on path enumeration.
 *
 * - `maxPathsPerSite` bounds the number of distinct paths emitted from a
 *   single match site.
 * - `maxSitesPerVuln` bounds the number of match sites traversed per vuln
 *   id; once reached, additional sites for that vuln are skipped.
 *
 * Both caps prevent unbounded output on large real-world graphs.
 */
export interface CallStackCaps {
    maxPathsPerSite?: number;
    maxSitesPerVuln?: number;
}

export const DEFAULT_MAX_PATHS_PER_SITE = 5;
export const DEFAULT_MAX_SITES_PER_VULN = 5;

interface VulnAccumulator {
    vulnerability: Vulnerability;
    stacks: Frame[][];
    seenStackKeys: Set<string>;
    sitesProcessed: number;
}

/**
 * Build the call-stacks JSON for the given match maps.
 *
 * `callMap` is the call-site match map (each key is a Babel Node).
 * `functionMap` is the function-body match map (each key is FunctionInfo or
 *   ModuleInfo). Both contribute match sites; the path-finder treats them
 *   uniformly via callGraph.frameFor().
 * `caps` bounds path enumeration (see CallStackCaps).
 */
export function serializeCallStacks(
    callMap: VulnSites,
    functionMap: VulnSites,
    callGraph: CallGraphLike,
    caps: CallStackCaps = {},
): CallStacksOutput {
    const limits = {
        maxPathsPerSite: caps.maxPathsPerSite ?? DEFAULT_MAX_PATHS_PER_SITE,
        maxSitesPerVuln: caps.maxSitesPerVuln ?? DEFAULT_MAX_SITES_PER_VULN,
    };
    const byId = new Map<string, VulnAccumulator>();
    walkSites(callMap, callGraph, byId, limits);
    walkSites(functionMap, callGraph, byId, limits);

    const out: CallStacksOutput = [];
    for (const acc of byId.values()) {
        if (acc.stacks.length === 0) continue;
        out.push({
            vulnerability: acc.vulnerability,
            paths: {
                analysisLevel: "function-level",
                stacks: acc.stacks,
            },
        });
    }
    return out;
}

function walkSites(
    sites: VulnSites,
    callGraph: CallGraphLike,
    byId: Map<string, VulnAccumulator>,
    limits: {maxPathsPerSite: number; maxSitesPerVuln: number},
): void {
    for (const [matchNode, vulns] of sites) {
        const matchFrame = callGraph.frameFor(matchNode);
        if (!matchFrame) continue;

        // Collect (id -> Vulnerability) for vulns at this site that haven't
        // yet hit their per-vuln site cap. Deduplicating by id ensures one
        // site consumes exactly one slot of maxSitesPerVuln even when the
        // vulns Set holds multiple Vulnerability objects (e.g. osv + npm)
        // resolving to the same id. Skip the BFS when nothing is live.
        const live = new Map<string, Vulnerability>();
        for (const v of vulns) {
            const id = getVulnerabilityId(v);
            if (live.has(id)) continue;
            const acc = byId.get(id);
            if (acc && acc.sitesProcessed >= limits.maxSitesPerVuln) continue;
            live.set(id, v);
        }
        if (live.size === 0) continue;

        const stacks = reverseBFS(matchNode, matchFrame, callGraph, limits.maxPathsPerSite);
        if (stacks.length === 0) continue;

        for (const [id, vuln] of live) {
            let acc = byId.get(id);
            if (!acc) {
                acc = {vulnerability: vuln, stacks: [], seenStackKeys: new Set(), sitesProcessed: 0};
                byId.set(id, acc);
            }
            acc.sitesProcessed += 1;
            for (const s of stacks) {
                const key = stackKey(s);
                if (acc.seenStackKeys.has(key)) continue;
                acc.seenStackKeys.add(key);
                acc.stacks.push(s);
            }
        }
    }
}

function reverseBFS(
    matchNode: unknown,
    matchFrame: Frame,
    callGraph: CallGraphLike,
    maxPathsPerSite: number,
): Frame[][] {
    interface PartialPath {
        head: unknown;          // identity of the node at the deepest end of the partial stack
        frames: Frame[];        // accumulator: index 0 is the deepest (sink) frame; reversed before emit
        visited: Set<unknown>;  // node identities seen on this path (cycle break)
    }

    const seedVisited = new Set<unknown>([matchNode]);
    let worklist: PartialPath[] = [{head: matchNode, frames: [matchFrame], visited: seedVisited}];
    const completed: Frame[][] = [];
    const seenKeys = new Set<string>();

    const tryComplete = (frames: Frame[]): void => {
        const stack = [...frames].reverse();
        const key = stackKey(stack);
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        completed.push(stack);
    };

    while (worklist.length > 0 && completed.length < maxPathsPerSite) {
        const next: PartialPath[] = [];
        for (const cur of worklist) {
            if (completed.length >= maxPathsPerSite) break;
            if (callGraph.isEntry(cur.head)) {
                tryComplete(cur.frames);
                continue;
            }
            const callers = Array.from(callGraph.callersOf(cur.head));
            if (callers.length === 0) {
                tryComplete(cur.frames);
                continue;
            }
            let pushed = false;
            for (const caller of callers) {
                if (cur.visited.has(caller)) continue; // cycle
                const callerFrame = callGraph.frameFor(caller);
                if (!callerFrame) continue;
                const visited = new Set(cur.visited);
                visited.add(caller);
                next.push({
                    head: caller,
                    frames: [...cur.frames, callerFrame],
                    visited,
                });
                pushed = true;
            }
            // All callers filtered (cycle / unframeable) — emit the partial
            // path so the caller knows the BFS reached this dead-end. The
            // `callers.length === 0` case above is the same semantic.
            if (!pushed) tryComplete(cur.frames);
        }
        worklist = next;
    }

    return completed;
}

function stackKey(stack: Frame[]): string {
    return stack
        .map(f => {
            const sl = f.sourceLocation;
            return (
                `${f.package}|${sl.filename}|` +
                `${sl.start.line}:${sl.start.column}-` +
                `${sl.end.line}:${sl.end.column}`
            );
        })
        .join(">");
}

/**
 * Run the path-finder over the solver's call graph and write the resulting
 * call-stacks JSON to `path`.
 */
export function saveCallStacks(solver: Solver, vr: VulnerabilityResults, path: string): void {
    const callGraph = makeCallGraphAdapter(solver);
    const json = JSON.stringify(
        serializeCallStacks(
            (vr.call ?? new Map()) as VulnSites,
            (vr.function ?? new Map()) as VulnSites,
            callGraph,
        ),
        null,
        2,
    );
    writeFileSync(path, json);
    logger.info(`Vulnerability call-stacks written to ${path}`);
}

function makeCallGraphAdapter(solver: Solver): CallGraphLike {
    const f = solver.fragmentState;

    // Build reverse map: callee (FunctionInfo | ModuleInfo) -> callers (FunctionInfo | ModuleInfo).
    // functionToFunction is caller->callees; requireGraph is also caller->callees.
    const reverseCallers = new Map<FunctionInfo | ModuleInfo, Set<FunctionInfo | ModuleInfo>>();
    const addReverseEdges = (forward: Iterable<[FunctionInfo | ModuleInfo, Iterable<FunctionInfo | ModuleInfo>]>) => {
        for (const [caller, callees] of forward) {
            for (const callee of callees) {
                let s = reverseCallers.get(callee);
                if (!s) {
                    s = new Set();
                    reverseCallers.set(callee, s);
                }
                s.add(caller);
            }
        }
    };
    addReverseEdges(f.functionToFunction);
    addReverseEdges(f.requireGraph);

    return {
        callersOf(node: unknown): Iterable<unknown> {
            if (node instanceof FunctionInfo || node instanceof ModuleInfo) {
                return reverseCallers.get(node) ?? [];
            }
            // Babel Node (call site): its containing function/module is the
            // immediate caller context to walk up from.
            const containing = f.callToContainingFunction.get(node as BabelNode);
            return containing ? [containing] : [];
        },
        isEntry(node: unknown): boolean {
            if (node instanceof FunctionInfo) return node.moduleInfo.packageInfo.isEntry;
            if (node instanceof ModuleInfo) return node.packageInfo.isEntry;
            // Babel Node: check via loc.module
            const loc = (node as BabelNode)?.loc as Location | null | undefined;
            return loc?.module?.packageInfo?.isEntry === true;
        },
        frameFor(node: unknown): Frame | null {
            if (node instanceof FunctionInfo || node instanceof ModuleInfo) {
                const moduleInfo = node instanceof ModuleInfo ? node : node.moduleInfo;
                const filename = moduleInfo.getPath();
                const pkg = moduleInfo.packageInfo?.name;
                const loc = node.loc;
                if (!filename || !pkg || !loc) return null;
                return {
                    package: pkg,
                    sourceLocation: {
                        start: {line: loc.start.line, column: loc.start.column},
                        end:   {line: loc.end.line,   column: loc.end.column},
                        filename,
                    },
                    confidence: 1,
                };
            }
            // Babel Node (call site): derive location from loc.module (Jelly's Location type).
            const babelLoc = (node as BabelNode)?.loc as Location | null | undefined;
            if (!babelLoc) return null;
            const moduleInfo = babelLoc.module;
            if (!moduleInfo) return null;
            const filename = moduleInfo.getPath();
            const pkg = moduleInfo.packageInfo?.name;
            if (!filename || !pkg) return null;
            return {
                package: pkg,
                sourceLocation: {
                    start: {line: babelLoc.start.line, column: babelLoc.start.column},
                    end:   {line: babelLoc.end.line,   column: babelLoc.end.column},
                    filename,
                },
                confidence: 1,
            };
        },
    };
}
