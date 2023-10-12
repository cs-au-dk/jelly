export default class AnalysisDiagnostics {

    packages: number = 0;

    modules: number = 0;

    functions: number = 0;

    vars: number = 0;

    listeners: number = 0;

    tokens: number = 0;

    subsetEdges: number = 0;

    functionToFunctionEdges: number = 0;

    callToFunctionEdges: number = 0;

    iterations: number = 0;

    uniqueTokens: number = 0;

    aborted: boolean = false;

    timeout: boolean = false;

    time: number = 0; // set when analysis is completed

    cpuTime: number = 0; // set when analysis is completed

    codeSize: number = 0;

    maxMemoryUsage: number = 0;

    errors: number = 0; // set when analysis is completed

    warnings: number = 0; // set when analysis is completed

    totalCallSites: number = 0; // set when analysis is completed

    callsWithUniqueCallee: number = 0; // set when analysis is completed

    callsWithNoCallee: number = 0; // set when analysis is completed

    nativeOnlyCalls: number = 0; // set when analysis is completed

    externalOnlyCalls: number = 0; // set when analysis is completed

    nativeOrExternalCalls: number = 0; // set when analysis is completed

    functionsWithZeroCallers: number = 0; // set when analysis is completed

    unprocessedTokensSize: number = 0;

    fixpointRound: number = 0;

    listenerNotificationRounds: number = 0;

    lastPrintDiagnosticsTime: number = 0;

    tokenListenerNotifications: number = 0;

    pairListenerNotifications: number = 0;

    packageNeighborListenerNotifications: number = 0;

    ancestorListenerNotifications: number = 0;

    arrayEntriesListenerNotifications: number = 0;

    objectPropertiesListenerNotifications: number = 0;
    
    roundLimitReached: number = 0;
    
    totalCycleEliminationTime: number = 0;
    
    totalCycleEliminationRuns: number = 0;
    
    totalPropagationTime: number = 0;
    
    totalListenerCallTime: number = 0;
    
    totalWideningTime: number = 0;
}
