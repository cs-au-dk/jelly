export interface AnalysisDiagnostics {

    packages: number;

    modules: number;

    functions: number;

    functionToFunctionEdges: number;

    iterations: number;

    uniqueTokens: number;

    time: number; // set when analysis is completed

    cpuTime: number; // set when analysis is completed

    aborted: boolean;

    timeout: boolean;

    codeSize: number;

    maxMemoryUsage: number;
}