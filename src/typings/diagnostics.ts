export interface AnalysisDiagnostics {

    packages: number;

    modules: number;

    functions: number;

    vars: number;

    listeners: number;

    tokens: number;

    subsetEdges: number;

    functionToFunctionEdges: number;

    iterations: number;

    uniqueTokens: number;

    time: number; // set when analysis is completed

    cpuTime: number; // set when analysis is completed

    aborted: boolean;

    timeout: boolean;

    codeSize: number;

    maxMemoryUsage: number;

    errors: number;

    warnings: number;

    totalCallSites: number;

    callsWithUniqueCallee: number;

    callsWithNoCallee: number;

    nativeOnlyCalls: number;

    externalOnlyCalls: number;

    nativeOrExternalCalls: number;

    functionsWithZeroCallers: number;
}
