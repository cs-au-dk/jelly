import {PatternWrapper, SemanticPatch, SemanticPatchNew} from "../typings/tapir";
import {readFileSync} from "fs";
import {AccessPathPatternCanonicalizer, parseDetectionPattern} from "./patternparser";
import {DetectionPattern, ImportAccessPathPattern, PropertyAccessPathPattern} from "./patterns";
import logger from "../misc/logger";
import {addAll} from "../misc/util";

export function loadTapirDetectionPatternFiles(files: Array<string>): Array<PatternWrapper | SemanticPatch> {
    const res: Array<PatternWrapper | SemanticPatch> = [];
    for (const file of files) {
        logger.info(`Loading patterns from ${file}`);
        for (const p of JSON.parse(readFileSync(file, "utf8")) as Array<PatternWrapper | SemanticPatch>)
            res.push(p);
    }
    return res;
}

export function convertTapirPatterns(tapir: Array<PatternWrapper | SemanticPatch | SemanticPatchNew>, c: AccessPathPatternCanonicalizer = new AccessPathPatternCanonicalizer()): Array<DetectionPattern | undefined> {
    const res: Array<DetectionPattern | undefined> = [];
    for (const p of tapir) {
        const pattern = "detectionPattern" in p ? p.detectionPattern : "semanticPatchId" in p ? p.semanticPatch.detectionPattern : p.pattern;
        try {
            res.push(parseDetectionPattern(pattern, c));
        } catch (pos) {
            logger.error(`Error: Pattern parse error:\n${pattern}${"semanticPatchId" in p ? ` (pattern #${p.semanticPatchId} version ${p.version})` : ""}`);
            logger.error(`${" ".repeat(pos as number)}^ (column ${pos})`);
        }
    }
    return res;
}

export function removeObsoletePatterns(patterns: Array<PatternWrapper | SemanticPatch>): Array<PatternWrapper | SemanticPatch> {
    const m = new Map<string, PatternWrapper | SemanticPatch>();
    for (const p of patterns)
        if ("semanticPatchId" in p) {
            const q = m.get(p.semanticPatchId);
            if ((!q || ("version" in q && q.version < p.version)))
                if (p.enabled)
                    m.set(p.semanticPatchId, p);
                else
                    m.delete(p.semanticPatchId);
        } else if (!p.deprecation) {
            if (m.has(p.id))
                logger.warn(`Multiple patterns with ID ${p.id}`);
            m.set(p.id, p);
        }
    return Array.from(m.values());
}

/**
 * Returns the globs that appear in module patterns.
 */
export function getGlobs(ds: Array<DetectionPattern | undefined>): Set<string> {
    const s = new Set<string>();
    for (const d of ds)
        if (d)
            d.ap.visitAccessPathPatterns(p => {
                if (p instanceof ImportAccessPathPattern)
                    s.add(p.glob);
            });
    return s;
}

/**
 * Returns the property names that appear in property access path patterns.
 */
export function getProperties(ds: Array<DetectionPattern | undefined>): Set<string> {
    const s = new Set<string>();
    for (const d of ds)
        if (d)
            d.ap.visitAccessPathPatterns(p => {
                if (p instanceof PropertyAccessPathPattern)
                    addAll(p.props, s);
            });
    return s;
}