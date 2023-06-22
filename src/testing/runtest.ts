import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {options} from "../options";
import {tapirLoadPatterns, tapirPatternMatch} from "../patternmatching/tapirpatterns";
import {analyzeFiles} from "../analysis/analyzer";
import assert from "assert";
import {testSoundness} from "../dynamic/soundnesstester";
import {AnalysisStateReporter} from "../output/analysisstatereporter";
import Solver from "../analysis/solver";
import {getAPIUsage} from "../patternmatching/apiusage";
import {FragmentState} from "../analysis/fragmentstate";
import logger from "../misc/logger";
import {compareCallGraphs} from "../output/compare";

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
                                  apiUsageAccessPathPatternsAtNodes?: number
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

    if (options.soundness)
        // ensure that calls are registered
        options.callgraphJson = "truthy";

    const files = Array.isArray(app) ? app : [app]
    const solver = new Solver();
    await analyzeFiles(files, solver);

    let funFound, funTotal, callFound, callTotal;
    if (args.soundness) {
        [funFound, funTotal, callFound, callTotal] = testSoundness(args.soundness, solver.fragmentState);

        // test that the output of compareCallGraphs agrees with the soundness tester
        const output: string[] = [];
        const spy = jest.spyOn(logger, "info").mockImplementation((line) => output.push(line as unknown as string) as any);
        const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), "jelly-runTest-cgcompare-"));
        try {
            const cgpath = path.join(tmpdir, "callgraph.json")
            new AnalysisStateReporter(solver.fragmentState).saveCallGraph(cgpath, files);
            compareCallGraphs(args.soundness, cgpath)
        } finally {
            spy.mockRestore();
            await fs.rm(tmpdir, { recursive: true });
        }

        const [_, funRecall, __, callRecall] = [...output.join("\n").matchAll(/: (\d+\/\d+) \(/g)].map((match) => match[1]);
        expect(funRecall).toBe(`${funFound}/${funTotal}`);
        expect(callRecall).toBe(`${callFound}/${callTotal}`);
    }

    if (args.functionInfos !== undefined)
        expect(solver.globalState.functionInfos.size).toBe(args.functionInfos);
    if (args.moduleInfos !== undefined)
        expect(solver.globalState.moduleInfos.size).toBe(args.moduleInfos);
    if (args.numberOfFunctionToFunctionEdges !== undefined)
        expect(solver.fragmentState.numberOfFunctionToFunctionEdges).toBe(args.numberOfFunctionToFunctionEdges);
    if (args.oneCalleeCalls !== undefined)
        expect(new AnalysisStateReporter(solver.fragmentState).getOneCalleeCalls()).toBe(args.oneCalleeCalls);
    if (args.funFound !== undefined)
        expect(funFound).toBe(args.funFound);
    if (args.funTotal !== undefined)
        expect(funTotal).toBe(args.funTotal);
    if (args.callFound !== undefined)
        expect(callFound).toBe(args.callFound);
    if (args.callTotal !== undefined)
        expect(callTotal).toBe(args.callTotal);
    if (args.matches) {
        assert(tapirPatterns !== undefined && detectionPatterns !== undefined);
        const {matches, matchesLow} = tapirPatternMatch(tapirPatterns, detectionPatterns, solver.fragmentState);
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
