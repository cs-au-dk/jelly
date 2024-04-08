/**
 * Diagnostics from approximate interpretation.
 */
export type ApproxDiagnostics = {

    /**
     * Time (nanoseconds) spent on approximate interpretation.
     */
    time: bigint;

    /**
     * Number of visited packages.
     */
    visitedPackages: number;

    /**
     * Total code size (bytes) excluding dynamically generated code.
     */
    codeSize: number;

    /**
     * Number of modules executed with approximate interpretation.
     */
    modulesAnalyzed: number;

    /**
     * Number of visited modules.
     */
    modulesVisited: number;

    /**
     * Number of modules where approximate interpretation of top-level code resulted in uncaught exceptions.
     */
    moduleExceptions: number;

    /**
     * Number of functions that have been force-executed.
     */
    forceExecutedFunctions: number;

    /**
     * Total number of functions found statically in the visited files.
     */
    staticFunctions: number;

    /**
     * Number of function visited (excluding dynamically generated functions).
     */
    staticFunctionsVisited: number;

    /**
     * Number of force-executed functions that terminated with exception.
     */
    exceptions: number;

    /**
     * Number of property read hints.
     */
    readHints: number;

    /**
     * Number of property write hints.
     */
    writeHints: number;

    /**
     * Number of require/import hints
     */
    requireHints: number;

    /**
     * Number of eval/Function hints.
     */
    evalHints: number;
}

/**
 * Diagnostics from patching during static analysis using hints from approximate interpretation.
 */
export class PatchingDiagnostics {

    /**
     * Number of dynamic property reads (unsupported by static only) that have been patched.
     */
    patchedReads: number = 0;

    /**
     * Number of dynamic property writes (unsupported by static only) that have been patched.
     */
    patchedWrites: number = 0;

    /**
     * Number of tokens added at dynamic property writes.
     */
    writeTokensAdded: number = 0;

    /**
     * Number of tokens added at dynamic property reads.
     */
    readTokensAdded: number = 0;

    /**
     * Number of tokens not found at expected locations.
     */
    tokensNotFound: number = 0;

    /**
     * Number of hints that have not been used.
     * A hint is "unused" if one of its locations could not be found in the static analysis information.
     */
    unusedHints: number = 0;

    /**
     * Total number of hints.
     */
    totalHints: number = 0;

    /**
     * Files that appear in patch file but have not been analyzed statically.
     */
    modulesNotAnalyzed: number = 0;

    /**
     * Files that have been analyzed statically but do not appear in patch file.
     */
    modulesNotInHints: number = 0;

    /**
     * Functions that have been analyzed statically but not visited dynamically according to patch file.
     */
    functionsNotVisited: number = 0;
}
