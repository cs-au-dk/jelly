/**
 * Diagnostics for vulnerability detection.
 */
export class VulnerabilityDiagnostics {

    /**
     * Time for collecting vulnerability information.
     */
    vulnerabilityCollectionTime: bigint = 0n;

    /**
     * Number of distinct vulnerabilities found in total.
     */
    distinctVulnerabilities: number = 0;

    /**
     * Number of packages with vulnerability location matches.
     */
    packagesWithVulnerabilityLocationMatches: number = 0;

    /**
     * Number of modules with vulnerability location matches.
     */
    modulesWithVulnerabilityLocationMatches: number = 0;

    /**
     * Number of functions with vulnerability location matches.
     */
    functionsWithVulnerabilityLocationMatches: number = 0;

    /**
     * Number of nodes with vulnerability pattern matches.
     */
    nodesWithVulnerabilityPatternMatches: number = 0;

    /**
     * Number of packages that may depend on a vulnerable package,
     * according to package-level dependency structure (code, not package.json).
     */
    packagesThatMayDependOnVulnerablePackages: number = 0;

    /**
     * Number of modules that may depend on a vulnerable module.
     */
    modulesThatMayDependOnVulnerableModules: number = 0;

    /**
     * Number of functions that may reach a vulnerable function.
     */
    functionsThatMayReachVulnerableFunctions: number = 0;

    /**
     * Number of calls that may reach on a vulnerable function.
     */
    callsThatMayReachVulnerableFunctions: number = 0;

    /**
     * Number of entry-package packages with vulnerability location matches.
     */
    entryPackagesWithVulnerabilityLocationMatches: number = 0;

    /**
     * Number of entry-package modules with vulnerability location matches.
     */
    entryPackageModulesWithVulnerabilityLocationMatches: number = 0;

    /**
     * Number of entry-package functions with vulnerability location matches.
     */
    entryPackageFunctionsWithVulnerabilityLocationMatches: number = 0;

    /**
     * Number of entry-package nodes with vulnerability pattern matches.
     */
    entryPackageNodesWithVulnerabilityPatternMatches: number = 0;

    /**
     * Number of entry-package packages that may depend on a vulnerable package,
     * according to package-level dependency structure (code, not package.json).
     */
    entryPackagesThatMayDependOnVulnerablePackages: number = 0;

    /**
     * Number of entry-package modules that may depend on a vulnerable module.
     */
    entryPackageModulesThatMayDependOnVulnerableModules: number = 0;

    /**
     * Number of entry-package functions that may reach a vulnerable function.
     */
    entryPackageFunctionsThatMayReachVulnerableFunctions: number = 0;

    /**
     * Number of entry-package calls that may reach on a vulnerable function.
     */
    entryPackageCallsThatMayReachVulnerableFunctions: number = 0;
}
