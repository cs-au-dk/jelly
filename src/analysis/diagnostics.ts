import {ApproxDiagnostics, PatchingDiagnostics} from "../approx/diagnostics";

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

    propagations: number = 0;

    uniqueTokens: number = 0;

    aborted: boolean = false;

    timeout: boolean = false;

    analysisTime: bigint = 0n; // set when analysis is completed

    codeSize: number = 0;

    codeSizeMain: number = 0;

    codeSizeDependencies: number = 0;

    maxMemoryUsage: number = 0;

    errors: number = 0; // set when analysis is completed

    warnings: number = 0; // set when analysis is completed

    totalCallSites: number = 0; // set when analysis is completed

    callsWithUniqueCallee: number = 0; // set when analysis is completed

    callsWithMultipleCallees: number = 0; //set when analysis is completed

    callsWithNoCallee: number = 0; // set when analysis is completed

    nativeOnlyCalls: number = 0; // set when analysis is completed

    externalOnlyCalls: number = 0; // set when analysis is completed

    nativeOrExternalCalls: number = 0; // set when analysis is completed

    functionsWithZeroCallers: number = 0; // set when analysis is completed

    reachableFunctions: number = 0; // set when analysis is completed

    unprocessedTokensSize: number = 0;

    wave: number = 0;

    round: number = 0;

    listenerNotificationRounds: number = 0;

    lastPrintDiagnosticsTime: number = 0;

    tokenListenerNotifications: number = 0;

    tokenListener2Notifications: number = 0;

    packageNeighborListenerNotifications: number = 0;

    arrayEntriesListenerNotifications: number = 0;

    objectPropertiesListenerNotifications: number = 0;

    waveLimitReached: number = 0;

    indirectionsLimitReached: number = 0;

    totalCycleEliminationTime: bigint = 0n;

    totalCycleEliminationRuns: number = 0;

    totalPropagationTime: bigint = 0n;

    totalListenerCallTime: bigint = 0n;

    totalWideningTime: bigint = 0n;

    totalFragmentMergeTime: bigint = 0n;

    totalEscapePatchingTime: bigint = 0n;

    totalApproxPatchingTime: bigint = 0n;

    totalOtherPatchingTime: bigint = 0n;

    finalizationTime: bigint = 0n;

    patternMatchingTime: bigint = 0n;

    vulnerabilityCollectionTime: bigint = 0n;

    unhandledDynamicPropertyWrites: number = 0;

    unhandledDynamicPropertyReads: number = 0;

    approx?: ApproxDiagnostics; // set when analysis is completed if --approx enabled

    patching?: PatchingDiagnostics; // set if --approx or --approx-load enabled
}
