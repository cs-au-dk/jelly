import {Match, PatchType, PatternWrapper, SemanticPatch} from "../typings/tapir";
import {DetectionPattern} from "./patterns";
import {
    convertTapirPatterns,
    getGlobs,
    getProperties,
    loadTapirDetectionPatternFiles,
    removeObsoletePatterns
} from "./patternloader";
import {setDefaultTrackedModules, setPatternProperties} from "../options";
import {TypeScriptTypeInferrer} from "../typescript/typeinferrer";
import logger, {writeStdOutIfActive} from "../misc/logger";
import {Location, locationToStringWithFileAndEnd} from "../misc/util";
import {TimeoutException} from "../misc/timer";
import {DetectionPatternMatch, generateQuestion, PatternMatcher} from "./patternmatcher";
import Solver from "../analysis/solver";

/**
 * Loads patterns from TAPIR pattern files.
 * Also sets default external modules according to globs in patterns (so this function should be run *before* analyzeFiles).
 */
export function tapirLoadPatterns(patternFiles: Array<string>): [Array<PatternWrapper | SemanticPatch>, Array<DetectionPattern | undefined>] {
    const tapirPatterns = removeObsoletePatterns(loadTapirDetectionPatternFiles(patternFiles));
    const patterns = convertTapirPatterns(tapirPatterns);
    setDefaultTrackedModules(getGlobs(patterns));
    setPatternProperties(getProperties(patterns));
    return [tapirPatterns, patterns];
}

/**
 * Performs pattern matching on the given analysis state.
 * @param tapirPatterns TAPIR patterns
 * @param patterns parsed patterns (or 'undefined', in case of parse errors)
 * @param solver analysis solver
 * @param typer TypeScript type inferrer
 * @param expected expected matches (optional)
 * @return number of matches and misses of different categories
 */
export function tapirPatternMatch(tapirPatterns: Array<PatternWrapper | SemanticPatch>, patterns: Array<DetectionPattern | undefined>, solver: Solver, typer?: TypeScriptTypeInferrer, expected?: (PatchType | Match)[]): {
    matches: number,
    matchesLow: number,
    expectedMatches: number,
    unexpectedMatches: number,
    misses: number,
    expectedLow: number,
    expectedHigh: number,
    unexpectedLow: number,
    unexpectedHigh: number,
    matchesTapirFalsePositives: number,
    missesTapirFalsePositives: number,
    missesParseErrors: number,
    missesFileNotAnalyzed: number
} {
    writeStdOutIfActive("Pattern matching...");
    const matcher = new PatternMatcher(solver.fragmentState, typer);
    let matches = 0, matchesLow = 0, expectedMatches = 0, unexpectedMatches = 0,
        expectedLow = 0, expectedHigh = 0, unexpectedLow = 0, unexpectedHigh = 0,
        matchesTapirFalsePositives = 0, missesTapirFalsePositives = 0,
        missesParseErrors = 0, missesFileNotAnalyzed = 0;
    const expectedRemaining = Array.from(expected || []);
    function isTapirFalsePositive(q: PatchType | Match) {
        return "questions" in q && q.questions.find(e => e.answer === "no" && !["transformation", "extra", "ask-before-patch"].includes(e.type));
    }
    function isHigh(m: DetectionPatternMatch): boolean {
        return !m.uncertainties?.length;
    }
    try {
        for (let i = 0; i < patterns.length; i++) {
            const tp = tapirPatterns[i];
            const tpId = "semanticPatchId" in tp ? tp.semanticPatchId : tp.id;
            const tpPattern = "semanticPatchId" in tp ? tp.semanticPatch.detectionPattern : tp.pattern;
            const tpVersion = "version" in tp ? ` (version ${tp.version})` : "";
            const p = patterns[i];
            if (p) {
                solver.globalState.timeoutTimer.checkTimeout();
                const ms = matcher.findDetectionPatternMatches(p); // the set of expressions that match tp and p
                for (const m of ms) {
                    logger.info(`Pattern #${tpId}: ${tpPattern}${tpVersion} matches ${locationToStringWithFileAndEnd(m.exp.loc)} (confidence: ${isHigh(m) ? "high" : "low"})`);
                    if (m.uncertainties && m.uncertainties.length > 0) {
                        for (const u of m.uncertainties)
                            logger.info(`Uncertainty: ${generateQuestion(u) ?? "Access path match uncertain"}`);
                        matchesLow++;
                    }
                }
                matches += ms.length;
                if (expected)
                    for (const m of ms) {
                        let anyMatch = false;
                        for (const q of expected) {
                            // noinspection CommaExpressionJS
                            if (("classification" in q ? q.classification : q.semanticPatchId) === tpId && m.exp.loc && "module" in m.exp.loc && (m.exp.loc as Location).module?.getPath().endsWith(q.file) &&
                                ("semanticPatchVersion" in q && "version" in tp ? q.semanticPatchVersion === tp.version : true) &&
                                ("lineNumber" in q ? q.lineNumber === m.exp.loc?.start.line :
                                    new RegExp(`^${m.exp.loc?.start.line}:\\d+:${m.exp.loc?.end.line}:\\d+$`).test(q.loc)
                                    // TODO: Babel parser tab width is apparently hardwired to 1, unfortunately
                                    // q.loc === `${exp.loc?.start.line}:${exp.loc?.start.column}:${exp.loc?.end.line}:${exp.loc?.end.column}`
                                )) {
                                anyMatch = true;
                                const qi = expectedRemaining.indexOf(q);
                                if (qi !== -1) {
                                    expectedRemaining.splice(qi, 1);
                                    let confidence;
                                    if ("highConfidence" in q) {
                                        if (q.highConfidence === isHigh(m)) {
                                            confidence = `expected ${isHigh(m) ? "high" : "low"}`;
                                            if (q.highConfidence)
                                                expectedHigh++;
                                            else
                                                expectedLow++;
                                        } else if (q.highConfidence) {
                                            confidence = "unexpected low";
                                            unexpectedLow++;
                                        } else {
                                            confidence = "unexpected high";
                                            unexpectedHigh++;
                                        }
                                    }
                                    const tapirFalsePositive = isTapirFalsePositive(q);
                                    logger.info(`Expected match for pattern #${tpId}${tpVersion} at ${q.file}:${"lineNumber" in q ? q.lineNumber : q.loc}` +
                                        (confidence ? ` (confidence: ${confidence})` : "") +
                                        (tapirFalsePositive ? " (TAPIR false positive)" : ""));
                                    if (tapirFalsePositive)
                                        matchesTapirFalsePositives++;
                                    expectedMatches++;
                                }
                            }
                        }
                        if (!anyMatch) {
                            logger.warn(`Unexpected match for pattern #${tpId}${tpVersion} at ${locationToStringWithFileAndEnd(m.exp.loc)} (confidence: ${isHigh(m) ? "high" : "low"})`);
                            unexpectedMatches++;
                        }
                    }
            } else
                logger.info(`Skipping pattern #${tpId}${tpVersion} due to parse error`);
        }
    } catch (ex) {
        if (ex instanceof TimeoutException) {
            logger.error("Time limit reached, pattern matching aborted");
            if (solver.diagnostics)
                solver.diagnostics.timeout = true;
        } else
            throw ex;
    }
    if (solver.globalState.filesAnalyzed.length === 0)
        logger.warn("Zero files analyzed");
    if (expected)
        for (const q of expectedRemaining) {
            const tapirFalsePositive = isTapirFalsePositive(q);
            const id = "classification" in q ? q.classification : q.semanticPatchId;
            const version = "semanticPatchVersion" in q ? ` (version ${q.semanticPatchVersion})` : "";
            const fileAnalyzed = solver.globalState.filesAnalyzed.find(f => f.endsWith(q.file)) !== undefined;
            logger.warn(`Missed match for pattern #${id}${version} at ${q.file}:${"lineNumber" in q ? q.lineNumber : q.loc}` +
                (tapirFalsePositive ? " (TAPIR false positive)" : "") +
                ("highConfidence" in q ? ` (${q.highConfidence ? "high" : "low"} confidence)` : "") +
                (fileAnalyzed ? "" : " (file not analyzed)"));
            if (tapirFalsePositive)
                missesTapirFalsePositives++;
            if (solver.globalState.filesWithParseErrors.find(f => f.endsWith(q.file)))
                missesParseErrors++;
            if (!fileAnalyzed)
                missesFileNotAnalyzed++;
        }
    logger.info(`Matches: ${matches}${expected ? `, expected: ${expected.length}` : ""} (patterns: ${patterns.length})`);
    if (expected) {
        logger.info(`Expected matches: ${expectedMatches}, unexpected: ${unexpectedMatches}, misses: ${expectedRemaining.length}`);
        logger.info(`Confidence expected low: ${expectedLow}, expected high: ${expectedHigh}, unexpected low: ${unexpectedLow}, unexpected high: ${unexpectedHigh}`);
        logger.info(`TAPIR false positives matches: ${matchesTapirFalsePositives}, misses: ${missesTapirFalsePositives}`);
        logger.info(`Misses in files with parse errors: ${missesParseErrors}, misses in files not analyzed: ${missesFileNotAnalyzed}`);
    }
    const misses = expectedRemaining.length;
    return {
        matches, matchesLow, expectedMatches, unexpectedMatches, misses,
        expectedLow, expectedHigh, unexpectedLow, unexpectedHigh,
        matchesTapirFalsePositives, missesTapirFalsePositives,
        missesParseErrors, missesFileNotAnalyzed
    };
}
