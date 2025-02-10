import {options, resetOptions, resolveBaseDir, setDefaultTrackedModules, setPatternProperties} from "../options";
import {tapirLoadPatterns, tapirPatternMatch} from "../patternmatching/tapirpatterns";
import {analyzeFiles} from "../analysis/analyzer";
import assert from "assert";
import {expect} from "@jest/globals";
import {AnalysisStateReporter} from "../output/analysisstatereporter";
import Solver from "../analysis/solver";
import {getAPIUsage} from "../patternmatching/apiusage";
import {FragmentState, RepresentativeVar} from "../analysis/fragmentstate";
import {compareCallGraphs} from "../output/compare";
import {VulnerabilityDetector} from "../patternmatching/vulnerabilitydetector";
import {getGlobs, getProperties} from "../patternmatching/patternloader";
import {Vulnerability} from "../typings/vulnerabilities";
import logger from "../misc/logger";
import "./compare";

/*
 * runTest registers a group of jest tests for the provided analysis configuration.
 * The tests test various properties of the results based on the provided test arguments.
 * Tests that test whether the analysis has the same result in different
 * configurations are also run.
 */
export function runTest(basedir: string,
                        app: string | Array<string>,
                        args: {
                            options?: Partial<typeof options>,
                            soundness?: string,
                            patterns?: Array<string>,
                            matches?: {total: number, low?: number},
                            functionInfos?: number,
                            moduleInfos?: number,
                            packageInfos?: number,
                            numberOfFunctionToFunctionEdges?: number,
                            oneCalleeCalls?: number,
                            funFound?: number,
                            funTotal?: number,
                            callFound?: number,
                            callTotal?: number,
                            reachableFound?: number,
                            reachableTotal?: number,
                            apiUsageAccessPathPatternsAtNodes?: number
                            vulnerabilities?: Array<Vulnerability>,
                            vulnerabilitiesMatches?: number,
                            hasEdges?: Array<[string, string]>,
                            containsTokens?: Array<[string, number]>
                        }) {

    const files = Array.isArray(app) ? app : [app];

    // remove extension from file
    describe(files[0].replace(/\..*/, ""), () => {

        type TapirT = ReturnType<typeof tapirLoadPatterns>;
        let tapirPatterns: TapirT[0], detectionPatterns: TapirT[1];
        let vulnerabilityDetector: VulnerabilityDetector;

        const solver = new Solver();

        beforeAll(async () => {
            resetOptions();
            logger.transports[0].level = options.loglevel = "error";

            Object.assign(options, args.options ?? {});

            options.basedir = basedir;
            resolveBaseDir();
            options.patterns = args.patterns;
            options.soundness = args.soundness;

            if (args.patterns)
                [tapirPatterns, detectionPatterns] = tapirLoadPatterns(args.patterns);

            if (args.apiUsageAccessPathPatternsAtNodes !== undefined) {
                options.apiUsage = options.ignoreDependencies = true;
                options.trackedModules ??= ["**"];
            }

            if (args.vulnerabilities) {
                options.vulnerabilities = "someFile"; // dummy value for the analysis to know that vulnerabilities is used
                vulnerabilityDetector = new VulnerabilityDetector(args.vulnerabilities);
                const qs = vulnerabilityDetector.getPatterns();
                setDefaultTrackedModules(getGlobs(qs));
                setPatternProperties(getProperties(qs));
                solver.globalState.vulnerabilities = vulnerabilityDetector;
            }

            await analyzeFiles(files, solver);
        });

        test("analysis facts", () => {
            if (args.functionInfos !== undefined)
                expect(solver.globalState.functionInfos.size).toBe(args.functionInfos);
            if (args.moduleInfos !== undefined)
                expect(solver.globalState.moduleInfos.size).toBe(args.moduleInfos);
            if (args.packageInfos !== undefined)
                expect(solver.globalState.packageInfos.size).toBe(args.packageInfos);
            if (args.numberOfFunctionToFunctionEdges !== undefined)
                expect(solver.fragmentState.numberOfFunctionToFunctionEdges).toBe(args.numberOfFunctionToFunctionEdges);
            if (args.oneCalleeCalls !== undefined)
                expect(new AnalysisStateReporter(solver.fragmentState).getOneCalleeCalls()).toBe(args.oneCalleeCalls);
        });

        test("merge regression", () => {
            // test that merging a fragmentState to a fresh one preserves key results
            const solver2 = new Solver();
            (solver2 as any).globalState = solver.globalState; // copy globalState reference...
            solver2.prepare();
            solver2.merge(solver.fragmentState);
            expect(solver2).toMatchAnalysisResults(solver);
        });

        /* test("callgraph-regression", () => {
            // FIXME: This is not robust against re-orderings
            const cg = new AnalysisStateReporter(solver.fragmentState).callGraphToJSON(files);
            expect(cg).toMatchSnapshot({
                time: expect.any(String),
            }, "static call graph");
        }); */

        if (args.soundness)
            test("soundness", () => {
                const soundness = compareCallGraphs(
                    args.soundness!, "<computed>",
                    new AnalysisStateReporter(solver.fragmentState).callGraphToJSON(files),
                    false, true);

                if (args.funTotal !== undefined)
                    expect(soundness.fun2funTotal).toBe(args.funTotal);
                if (args.callTotal !== undefined)
                    expect(soundness.call2funTotal).toBe(args.callTotal);
                if (args.reachableTotal !== undefined)
                    expect(soundness.reachableTotal).toBe(args.reachableTotal);

                // unless the args specify something else, assume that we want full soundness
                expect(soundness.fun2funFound).toBe(args.funFound ?? soundness.fun2funTotal);
                expect(soundness.call2funFound).toBe(args.callFound ?? soundness.call2funTotal);
                expect(soundness.reachableFound).toBe(args.reachableFound ?? soundness.reachableTotal);
            });

        if (args.matches)
            test("matches", () => {
                assert(args.matches && tapirPatterns !== undefined && detectionPatterns !== undefined);
                const {matches, matchesLow} = tapirPatternMatch(tapirPatterns, detectionPatterns, solver);
                expect(matches).toBe(args.matches.total);
                if (args.matches.low !== undefined)
                    expect(matchesLow).toBe(args.matches.low);
            });

        if (args.apiUsageAccessPathPatternsAtNodes !== undefined)
            test("API usage", () => {
                const [r1] = getAPIUsage(solver.fragmentState);
                let numAccessPathPatternsAtNodes = 0;
                for (const m of Object.values(r1))
                    for (const ns of m.values())
                        numAccessPathPatternsAtNodes += ns.size;
                expect(numAccessPathPatternsAtNodes).toBe(args.apiUsageAccessPathPatternsAtNodes);
            });

        if (args.vulnerabilitiesMatches !== undefined)
            test("vulnerabilities", () => {
                if (!vulnerabilityDetector)
                    throw new Error("vulnerabilitiesMatches can only be checked if vulnerabilities has been given.");
                const matches = vulnerabilityDetector.patternMatch(solver.fragmentState, undefined, solver.diagnostics);
                expect(matches.size).toBe(args.vulnerabilitiesMatches);
            });

        if (options.cycleElimination)
            describe("cycle elimination regression", () => {
                test("data structure invariants", () => {
                    // checks that all data structures that are supposed to
                    // contain representatives actually contain representatives
                    const check = (s: Set<RepresentativeVar> | Map<RepresentativeVar, object>) => {
                        for (const v of s.keys())
                            assert(f.isRepresentative(v));
                    };

                    const f = solver.fragmentState;
                    for (const [v] of f.getAllVarsAndTokens())
                        assert(f.isRepresentative(v));

                    for (const edges of [f.subsetEdges, f.reverseSubsetEdges])
                        for (const [v, es] of edges) {
                            assert(f.isRepresentative(v));
                            check(es);
                        }

                    check(f.tokenListeners);

                    for (const v of f.redirections.keys())
                        assert(!f.vars.has(v as RepresentativeVar));
                });

                test("results equivalence", async () => {
                    // test that analyzing with cycleElimination=false produces the same result
                    try {
                        options.cycleElimination = false;

                        const solver2 = new Solver();
                        await analyzeFiles(files, solver2);

                        expect(solver2).toMatchAnalysisResults(solver);
                    } finally {
                        options.cycleElimination = true;
                    }
                });
            });

        if (args.hasEdges)
            test("has edges", () => {
                for (const [src, dst] of args.hasEdges!)
                    if (!hasEdge(solver.fragmentState, src, dst))
                        assert.fail(`Call edge missing: ${src} -> ${dst}`);
            });

        if (args.containsTokens)
            test("contains tokens", () => {
                const allRepsAndTokens: Array<[string, number]> = [];
                for (const [rep, _, actualSize] of solver.fragmentState.getAllVarsAndTokens())
                    allRepsAndTokens.push([rep.toString(), actualSize]);
                for (const [cvar, expectedSize] of args.containsTokens!) {
                    let found = false;
                    for (const [repString, actualSize] of allRepsAndTokens)
                        if (repString.includes(cvar)) {
                            expect(actualSize).toBe(expectedSize);
                            found = true;
                        }
                    if (expectedSize === 0)
                        expect(found).toBe(false);
                    else if (!found)
                        assert.fail(`Specified constraint variable ${cvar} was not found`);
                }
            })
    });
}

export function hasEdge(f: FragmentState, fromStr: string, toStr: string): boolean {
    for (const [from, tos] of f.functionToFunction)
        for (const to of tos) {
            // console.log(`${from} -> ${to}`);
            if (from.toString() === fromStr && to.toString() === toStr)
                return true;
        }
    return false;
}
