/**
 * matches-file serializer.
 *
 * Produces a flat JSON shape mapping vulnerability ids to their matched
 * source-code locations. The shape is:
 *
 *     { [vulnId: string]: string[] }
 *
 * where each string is "filename:startLine:startColumn:endLine:endColumn"
 * (1-indexed columns).
 */

import {writeFileSync} from "fs";
import {FunctionInfo, ModuleInfo} from "../analysis/infos";
import logger from "../misc/logger";
import {VulnerabilityResults} from "../patternmatching/vulnerabilitydetector";
import {getVulnerabilityId, Vulnerability} from "../typings/vulnerabilities";

export interface SourceLocation {
    filename: string;
    start: { line: number; column: number };
    end:   { line: number; column: number };
}

export interface NodeWithLoc {
    loc: SourceLocation | null | undefined;
}

export type VulnToCallSites = Map<NodeWithLoc, Set<Vulnerability>>;

/**
 * Transform Jelly's match maps (`VulnerabilityDetector.vulnerabilities.{function,call}`)
 * into the matches-file shape.
 *
 * `submittedIds` is the list of vuln ids passed in via `-v`. Each submitted
 * id that produces no matches still appears in the output with an empty
 * array — consumers use key-presence to distinguish "analyzed, zero matches"
 * from "never submitted".
 */
export function serializeMatches(
    functionMap: VulnToCallSites,
    callMap: VulnToCallSites,
    submittedIds: string[] = [],
): Record<string, string[]> {
    const out: Record<string, string[]> = {};

    // Seed empty arrays for every submitted id so the key is always present.
    for (const id of submittedIds) {
        out[id] = [];
    }

    mergeMatches(functionMap, out);
    mergeMatches(callMap, out);
    return out;
}

function mergeMatches(m: VulnToCallSites, out: Record<string, string[]>): void {
    for (const [node, vulns] of m) {
        if (!node.loc) continue;
        const sl = formatLocation(node.loc);
        for (const v of vulns) {
            (out[getVulnerabilityId(v)] ??= []).push(sl);
        }
    }
}

/**
 * Build the matches-file from the vulnerability detector's results and
 * write it to `path`. `vulns` is the list submitted via `-v`; each id is
 * seeded as a key in the output (empty array if no matches found).
 */
export function saveMatches(
    vr: VulnerabilityResults,
    vulns: Array<Vulnerability> | undefined,
    path: string,
): void {
    const submittedIds = (vulns ?? []).map(getVulnerabilityId);
    const callMap = (vr.call ?? new Map()) as VulnToCallSites;
    const funcMap: VulnToCallSites = new Map();
    for (const [info, matchedVulns] of (vr.function ?? new Map())) {
        const loc = normalizeInfoLoc(info);
        if (!loc) continue;
        funcMap.set({loc}, matchedVulns);
    }
    const json = JSON.stringify(serializeMatches(funcMap, callMap, submittedIds), null, 2);
    writeFileSync(path, json);
    logger.info(`Vulnerability matches written to ${path}`);
}

function normalizeInfoLoc(info: FunctionInfo | ModuleInfo): SourceLocation | null {
    const moduleInfo = info instanceof ModuleInfo ? info : info.moduleInfo;
    const filename = moduleInfo.getPath();
    if (!filename) return null;
    const loc = info.loc;
    if (!loc) return null;
    return {
        filename,
        start: {line: loc.start.line, column: loc.start.column},
        end:   {line: loc.end.line,   column: loc.end.column},
    };
}

function formatLocation(loc: SourceLocation): string {
    // Jelly's columns are 0-indexed internally; consumers of this file
    // (editors, downstream tooling) expect 1-indexed.
    const sc = loc.start.column + 1;
    const ec = loc.end.column + 1;
    return `${loc.filename}:${loc.start.line}:${sc}:${loc.end.line}:${ec}`;
}
