import {InvalidArgumentError, OptionValues} from "commander";
import {resolve} from "path";
import logger from "./misc/logger";
import {realpathSync} from "fs";

export const VERSION = require("../package.json").version;
export const COPYRIGHT = "Copyright (C) 2023-2026 Anders Møller & Oskar Haarklou Veileborg\n";
export const PKG = "pkg" in process;

/**
 * Command line options (see usage in main.ts).
 */
export const options: {
    callgraphHtml: string | undefined,
    dataflowHtml: string | undefined,
    callgraphGraphviz: string | undefined,
    graphvizElideFunctions: boolean,
    graphvizPackages: Array<string> | undefined,
    dependenciesOnly: boolean,
    logfile: string | undefined,
    loglevel: string,
    loglevelServer: string,
    tokens: boolean,
    largest: boolean,
    soundness: string | undefined,
    basedir: string,
    callgraph: boolean,
    callgraphJson: string | undefined,
    tokensJson: string | undefined,
    cycleElimination: boolean,
    modulesOnly: boolean,
    printProgress: boolean,
    tty: boolean | undefined,
    dynamic: string | undefined,
    approx: boolean,
    approxOnly: string | undefined,
    approxLoad: string | undefined,
    npmTest: string | undefined,
    graalHome: string | undefined,
    testGraal: boolean,
    ignoreDependencies: boolean,
    ignoreUnresolved: boolean,
    excludeEntries: Array<string> | undefined,
    patterns: Array<string> | undefined,
    natives: boolean,
    warningsUnsupported: boolean,
    timeout: number | undefined,
    gc: boolean,
    typescript: boolean,
    apiUsage: boolean,
    apiExported: boolean,
    findAccessPaths: string | undefined,
    trackedModules: Array<string> | undefined,
    compareCallgraphs: boolean,
    reachability: boolean,
    callgraphImplicit: boolean,
    callgraphNative: boolean,
    callgraphRequire: boolean,
    callgraphExternal: boolean,
    diagnosticsJson: string | undefined,
    matchesFile: string | undefined,
    reachableFile: string | undefined,
    callstacksFile: string | undefined,
    maxFileSize: number | undefined,
    maxWaves: number | undefined,
    maxIndirections: number | undefined,
    fullIndirectionBounding: boolean,
    diagnostics: boolean,
    patchEscaping: boolean,
    patchDynamics: boolean,
    patchMethodCalls: boolean,
    patchThis: boolean,
    typescriptLibraryUsage: string | undefined,
    higherOrderFunctions: boolean,
    zeros: boolean,
    variableKinds: boolean,
    vulnerabilities: string | undefined,
    externalMatches: boolean,
    includePackages: Array<string> | undefined,
    excludePackages: Array<string> | undefined,
    library: boolean,
    skipTests: boolean,
    proto: boolean,
    objSpread: boolean,
    nativeOverwrites: boolean,
    ignoreImpreciseNativeCalls: boolean,
    vulnerabilitiesFull: boolean,
    eagerPropagation: boolean,
    interops: boolean,
} = {
    callgraphHtml: undefined,
    dataflowHtml: undefined,
    callgraphGraphviz: undefined,
    graphvizElideFunctions: false,
    graphvizPackages: undefined,
    dependenciesOnly: false,
    logfile: undefined,
    loglevel: "info",
    loglevelServer: "info",
    tokens: false,
    largest: false,
    soundness: undefined,
    basedir: "",
    callgraph: false,
    callgraphJson: undefined,
    tokensJson: undefined,
    cycleElimination: true,
    modulesOnly: false,
    printProgress: true,
    tty: false,
    dynamic: undefined,
    approx: false,
    approxOnly: undefined,
    approxLoad: undefined,
    npmTest: undefined,
    graalHome: undefined,
    testGraal: false,
    ignoreDependencies: false,
    ignoreUnresolved: false,
    excludeEntries: undefined,
    patterns: undefined,
    natives: true,
    warningsUnsupported: false,
    timeout: undefined,
    gc: false,
    typescript: false,
    apiUsage: false,
    apiExported: false,
    findAccessPaths: undefined,
    trackedModules: undefined,
    compareCallgraphs: false,
    reachability: false,
    callgraphImplicit: true,
    callgraphNative: true,
    callgraphRequire: true,
    callgraphExternal: true,
    diagnosticsJson: undefined,
    matchesFile: undefined,
    reachableFile: undefined,
    callstacksFile: undefined,
    maxFileSize: undefined,
    maxWaves: undefined,
    maxIndirections: undefined,
    fullIndirectionBounding: false,
    diagnostics: false,
    patchEscaping: true,
    patchDynamics: false,
    patchMethodCalls: false,
    patchThis: true,
    typescriptLibraryUsage: undefined,
    higherOrderFunctions: false,
    zeros: false,
    variableKinds: false,
    vulnerabilities: undefined,
    externalMatches: false,
    includePackages: undefined,
    excludePackages: undefined,
    library: false,
    skipTests: false,
    proto: false,
    objSpread: false,
    nativeOverwrites: false,
    ignoreImpreciseNativeCalls: false,
    vulnerabilitiesFull: false,
    eagerPropagation: false,
    interops: true,
};

/**
 * Commander argument parser that requires a positive integer. Use as the
 * third argument to `.option(...)` declarations for flags whose value is
 * compared as a number (e.g. --timeout, --max-waves, --max-indirections,
 * --max-file-size). Without this, commander returns the raw string and use
 * sites rely on JavaScript coercion, which silently misbehaves on bad input.
 */
export function parsePositiveInt(raw: string): number {
    const n = Number.parseInt(raw, 10);
    // The round-trip check is the strict part: rejects "+5", "05", "5.0",
    // and "5abc" even though parseInt would otherwise accept them.
    if (!Number.isFinite(n) || n <= 0 || String(n) !== raw.trim()) {
        throw new InvalidArgumentError("expected a positive integer");
    }
    return n;
}

export function setOptions(opts: OptionValues & Partial<typeof options>) {
    for (const opt of Object.getOwnPropertyNames(options)) {
        const v = opts[opt];
        if (v !== undefined)
            (options as any)[opt] = v;
    }
    if (options.apiUsage)
        options.ignoreDependencies = true;
    if (options.excludeEntries)
        options.excludeEntries =
            options.excludeEntries.length === 0 ? undefined : // micromatch bug workaround
                options.excludeEntries.map(p => `**/${p}`);
}

/**
 * Ensures that options.basedir is an absolute path without symlinks.
 * Relative paths are resolved relative to the current working directory.
 */
export function resolveBaseDir() {
    options.basedir = realpathSync(resolve(process.cwd(), options.basedir));
}

const original = Object.assign({}, options);

/**
 * Reset options to defaults.
 */
export function resetOptions() {
    Object.assign(options, original);
}

/**
 * Sets default options.trackedModules according to options.patterns and options.apiUsage.
 */
export function setDefaultTrackedModules(globs: Set<string> | undefined) {
    options.trackedModules ??= globs !== undefined ? Array.from(globs) : options.apiUsage ? ["**"] : undefined;
    if (logger.isVerboseEnabled() && options.trackedModules) {
        logger.verbose(`Tracked modules:${options.trackedModules.length > 0 ? "" : " (none)"}`);
        for (const g of options.trackedModules)
            logger.verbose(`  ${g}`);
    }
}

export let patternProperties: Set<string> | undefined = undefined;

/**
 * Sets pattern properties. If defined, object properties not in this set are not tracked in access paths.
 */
export function setPatternProperties(props?: Set<string>) {
    patternProperties = props;
}
