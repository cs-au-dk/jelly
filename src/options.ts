import {OptionValues} from "commander";
import {resolve} from "path";
import logger from "./misc/logger";

export const VERSION = require("../package.json").version;
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
    callgraphJson: string | undefined,
    tokensJson: string | undefined,
    bottomUp: boolean,
    alloc: boolean,
    widening: boolean,
    cycleElimination: boolean,
    modulesOnly: boolean,
    printProgress: boolean,
    tty: boolean | undefined,
    dynamic: string | undefined,
    npmTest: string | undefined,
    graalHome: string | undefined,
    skipGraalTest: boolean,
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
    callgraphImplicit: boolean,
    callgraphNative: boolean,
    callgraphRequire: boolean,
    callgraphExternal: boolean,
    diagnosticsJson: string | undefined,
    maxRounds: number | undefined,
    diagnostics: boolean,
    patchDynamics: boolean,
    typescriptLibraryUsage: string | undefined,
    higherOrderFunctions: boolean,
    zeros: boolean,
    variableKinds: boolean,
    vulnerabilities: string | undefined,
    externalMatches: boolean,
    includePackages: Array<string> | undefined,
    excludePackages: Array<string> | undefined
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
    callgraphJson: undefined,
    tokensJson: undefined,
    bottomUp: false,
    alloc: true,
    widening: true,
    cycleElimination: true,
    modulesOnly: false,
    printProgress: true,
    tty: false,
    dynamic: undefined,
    npmTest: undefined,
    graalHome: undefined,
    skipGraalTest: false,
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
    callgraphImplicit: true,
    callgraphNative: true,
    callgraphRequire: true,
    callgraphExternal: true,
    diagnosticsJson: undefined,
    maxRounds: undefined,
    diagnostics: false,
    patchDynamics: true,
    typescriptLibraryUsage: undefined,
    higherOrderFunctions: false,
    zeros: false,
    variableKinds: false,
    vulnerabilities: undefined,
    externalMatches: false,
    includePackages: undefined,
    excludePackages: undefined
};

export function setOptions(opts: OptionValues & Partial<typeof options>) {
    for (const opt of Object.getOwnPropertyNames(options)) {
        const v = opts[opt];
        if (v !== undefined)
            (options as any)[opt] = v;
    }
    if (options.apiUsage)
        options.ignoreDependencies = true;
    if (options.vulnerabilities)
        options.externalMatches = true;
}

/**
 * Ensures that options.basedir is an absolute path.
 * Relative paths are resolved relative to the current working directory.
 */
export function resolveBaseDir() {
    options.basedir = resolve(process.cwd(), options.basedir);
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
