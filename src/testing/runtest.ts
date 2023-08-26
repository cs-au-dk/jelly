import {options, setDefaultTrackedModules, setPatternProperties} from "../options";
import {tapirLoadPatterns, tapirPatternMatch} from "../patternmatching/tapirpatterns";
import {analyzeFiles} from "../analysis/analyzer";
import assert from "assert";
import {AnalysisStateReporter} from "../output/analysisstatereporter";
import Solver from "../analysis/solver";
import {getAPIUsage} from "../patternmatching/apiusage";
import {FragmentState} from "../analysis/fragmentstate";
import {compareCallGraphs} from "../output/compare";
import {VulnerabilityDetector} from "../patternmatching/vulnerabilitydetector";
import {getGlobs, getProperties} from "../patternmatching/patternloader";
import {Vulnerability} from "../typings/vulnerabilities";

export async function runTest(basedir: string,
                              app: string | Array<string>,
                              args: {
                                  soundness?: string,
                                  patterns?: Array<string>,
                                  matches?: {total: number, low?: number},
                                  functionInfos?: number,
                                  moduleInfos?: number,
                                  numberOfFunctionToFunctionEdges?: number,
                                  oneCalleeCalls?: number,
                                  funFound?: number,
                                  funTotal?: number,
                                  callFound?: number,
                                  callTotal?: number,
                                  reachableFound?: number,
                                  reachableTotal?: number,
                                  apiUsageAccessPathPatternsAtNodes?: number
                                  vulnerabilities?: Vulnerability[],
                                  vulnerabilitiesMatches?: number
                              }) {
    options.basedir = basedir;
    options.patterns = args.patterns;
    options.soundness = args.soundness;

    let tapirPatterns, detectionPatterns;
    if (args.patterns)
        [tapirPatterns, detectionPatterns] = tapirLoadPatterns(args.patterns);

    if (args.apiUsageAccessPathPatternsAtNodes !== undefined) {
        options.apiUsage = options.ignoreDependencies = true;
        options.trackedModules ??= ['**'];
    }

    const files = Array.isArray(app) ? app : [app]
    const solver = new Solver();
    let vulnerabilityDetector;
    if (args.vulnerabilities) {
        options.vulnerabilities = 'someFile'; // dummy value for the analysis to know that vulnerabilities is used
        vulnerabilityDetector = new VulnerabilityDetector(args.vulnerabilities);
        const qs = vulnerabilityDetector.getPatterns();
        setDefaultTrackedModules(getGlobs(qs));
        setPatternProperties(getProperties(qs));
        solver.globalState.vulnerabilities = vulnerabilityDetector;
    }
    await analyzeFiles(files, solver);

    let soundness;
    if (args.soundness)
        soundness = compareCallGraphs(
            args.soundness, "<computed>",
            new AnalysisStateReporter(solver.fragmentState).callGraphToJSON(files),
            /* compareBothWays */ false,
        );

    if (args.functionInfos !== undefined)
        expect(solver.globalState.functionInfos.size).toBe(args.functionInfos);
    if (args.moduleInfos !== undefined)
        expect(solver.globalState.moduleInfos.size).toBe(args.moduleInfos);
    if (args.numberOfFunctionToFunctionEdges !== undefined)
        expect(solver.fragmentState.numberOfFunctionToFunctionEdges).toBe(args.numberOfFunctionToFunctionEdges);
    if (args.oneCalleeCalls !== undefined)
        expect(new AnalysisStateReporter(solver.fragmentState).getOneCalleeCalls()).toBe(args.oneCalleeCalls);
    if (args.funFound !== undefined)
        expect(soundness?.fun2funFound).toBe(args.funFound);
    if (args.funTotal !== undefined)
        expect(soundness?.fun2funTotal).toBe(args.funTotal);
    if (args.callFound !== undefined)
        expect(soundness?.call2funFound).toBe(args.callFound);
    if (args.callTotal !== undefined)
        expect(soundness?.call2funTotal).toBe(args.callTotal);
    if (args.reachableFound !== undefined)
        expect(soundness?.reachableFound).toBe(args.reachableFound);
    if (args.reachableTotal !== undefined)
        expect(soundness?.reachableTotal).toBe(args.reachableTotal);
    if (args.matches) {
        assert(tapirPatterns !== undefined && detectionPatterns !== undefined);
        const {matches, matchesLow} = tapirPatternMatch(tapirPatterns, detectionPatterns, solver);
        expect(matches).toBe(args.matches.total);
        if (args.matches.low !== undefined)
            expect(matchesLow).toBe(args.matches.low);
    }
    if (args.apiUsageAccessPathPatternsAtNodes !== undefined) {
        const [r1,] = getAPIUsage(solver.fragmentState);
        let numAccessPathPatternsAtNodes = 0;
        for (const m of Object.values(r1))
            for (const ns of m.values())
                numAccessPathPatternsAtNodes += ns.size;
        expect(numAccessPathPatternsAtNodes).toBe(args.apiUsageAccessPathPatternsAtNodes);
    }
    if (args.vulnerabilitiesMatches !== undefined) {
        if (!vulnerabilityDetector)
            throw new Error("vulnerabilitiesMatches can only be checked if vulnerabilities has been given.");
        const matches = vulnerabilityDetector.patternMatch(solver.fragmentState, undefined, solver.diagnostics)
        expect(matches.size).toBe(args.vulnerabilitiesMatches);
    }
}

export function hasEdge(f: FragmentState, fromStr: string, toStr: string): boolean {
    for (const [from, tos] of f.functionToFunction)
        for (const to of tos) {
            // console.log(`${from} -> ${to}`);
            if (from.toString().includes(fromStr) && to.toString().includes(toStr))
                return true;
        }
    return false;
}
