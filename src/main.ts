#!/usr/bin/env node

import {analyzeFiles} from "./analysis/analyzer";
import {closeSync, openSync, readdirSync, readFileSync, unlinkSync} from "fs";
import {program} from "commander";
import logger, {logToFile, setLogLevel} from "./misc/logger";
import {testSoundness} from "./dynamic/soundnesstester";
import {options, setDefaultTrackedModules, setOptions, setPatternProperties} from "./options";
import {spawnSync} from "child_process";
import path from "path";
import {autoDetectBaseDir, expand, writeStreamedStringify} from "./misc/files";
import {tapirPatternMatch} from "./patternmatching/tapirpatterns";
import {toDot} from "./output/graphviz";
import {AnalysisStateReporter} from "./output/analysisstatereporter";
import {TypeScriptTypeInferrer} from "./typescript/typeinferrer";
import {getAPIUsage, reportAPIUsage} from "./patternmatching/apiusage";
import {
    convertTapirPatterns,
    getGlobs,
    getProperties,
    loadTapirDetectionPatternFiles,
    removeObsoletePatterns
} from "./patternmatching/patternloader";
import {compareCallGraphs} from "./output/compare";
import {getMemoryLimit} from "./misc/memory";
import Solver from "./analysis/solver";
import {exportCallGraphHtml, exportDataFlowGraphHtml} from "./output/visualizer";
import {VulnerabilityDetector, VulnerabilityResults} from "./patternmatching/vulnerabilitydetector";
import {Vulnerability} from "./typings/vulnerabilities";
import {addAll} from "./misc/util";
import {getAPIExported, reportAccessPaths, reportAPIExportedFunctions} from "./patternmatching/apiexported";
import {merge} from "./output/merge";
import {CallGraph} from "./typings/callgraph";

const VERSION = require("../package.json").version;
const PKG = "pkg" in process;

program
    .name("jelly")
    .version(VERSION)
    .addHelpText("before", "Copyright (C) 2023 Anders Møller\n")
    .option("-b, --basedir <directory>", "base directory for files to analyze (default: auto-detect)")
    .option("-f, --logfile <file>", "log to file (default: log to stdout)")
    .option("-l, --loglevel <level>", "log level (debug/verbose/info/warn/error)", "info")
    .option("-i, --timeout <seconds>", "limit analysis time")
    .option("-a, --dataflow-html <file>", "save data-flow graph as HTML file")
    .option("-m, --callgraph-html <file>", "save call graph as HTML file")
    .option("-j, --callgraph-json <file>", "save call graph as JSON file")
    .option("-s, --soundness <file>", "compare with dynamic call graph")
    .option("-n, --graal-home <directory>", "home of graal-nodejs (default: $GRAAL_HOME)")
    .option("-d, --dynamic <file>", "generate call graph dynamically, no static analysis")
    .option("-e, --exclude <glob...>", "files to exclude when specifying entry directories")
    .option("-p, --patterns <file...>", "files containing API usage patterns to detect")
    .option("-v, --vulnerabilities <file>", "report vulnerability matches")
    // .option("-g, --callgraph-graphviz <file>", "save call graph as Graphviz dot file") // TODO: graphviz output disabled for now
    .option("--npm-test <dir>", "run 'npm test' instead of 'node' (use with -d)")
    // .option("--graphviz-packages <package...>", "packages to include in Graphviz dot file (use with -g)")
    // .option("--graphviz-elide-functions", "elide functions (use with -g)")
    // .option("--graphviz-dependencies-only", "show module dependencies only (use with -g)")
    .option("--tokens-json <file>", "save tokens for constraint variables as JSON file")
    .option("--tokens", "report tokens for constraint variables")
    .option("--largest", "report largest token sets and subset relations")
    // .option("--bottom-up", "analyze bottom-up in package dependency structure") // TODO: bottom-up analysis disabled for now
    .option("--no-alloc", "disable light-weight allocation site abstraction")
    .option("--no-widening", "disable widening")
    .option("--no-patch-dynamics", "disable patching of dynamic property accesses")
    .option("--no-cycle-elimination", "disable cycle elimination")
    .option("--no-natives", "disable nonessential models of native libraries")
    .option("--skip-graal-test", "skip graal-nodejs test (use with -d)")
    .option("--ignore-dependencies", "don't include dependencies in analysis")
    .option("--ignore-unresolved", "don't report errors about unresolved modules")
    .option("--no-print-progress", "don't print analysis progress information")
    .option("--no-tty", "don't print solver progress for TTY")
    .option("--warnings-unsupported", "print warnings about unsupported features")
    .option("--gc", "enable garbage collection for more accurate memory usage reporting")
    .option("--typescript", "enable TypeScript type inference (use with -p)")
    .option("--api-usage", "report API usage of external packages (implies --ignore-dependencies)")
    .option("--api-exported", "report API of modules")
    .option("--find-access-paths <location>", "find access paths for source location (file:line)")
    .option("--higher-order-functions", "report higher-order functions")
    .option("--zeros", "report calls with zero callees and functions with zero callers")
    .option("--tracked-modules <glob...>", "modules to track usage of (default: empty unless using -p, -v or --api-usage)")
    .option("--no-callgraph-implicit", "omit implicit calls in call graph") // TODO: not yet including implicit valueOf/toString calls
    .option("--no-callgraph-native", "omit native calls in call graph") // TODO: not yet including the native functions themselves, only callbacks from native functions
    .option("--no-callgraph-require", "omit module loading in call graph") // TODO: currently works only for modules that are resolved successfully (and included even if --ignore-dependencies is used)?
    .option("--no-callgraph-external", "omit heuristic external callbacks in call graph")
    .option("--diagnostics", "report internal analysis diagnostics")
    .option("--diagnostics-json <file>", "save analysis diagnostics in JSON file")
    .option("--variable-kinds", "report constraint variable kinds")
    .option("--max-rounds <number>", "limit number of fixpoint rounds for each module and package")
    .option("--typescript-library-usage <file>", "save TypeScript library usage in JSON file, no analysis")
    .option("--modules-only", "report reachable packages and modules only, no analysis")
    .option("--compare-callgraphs", "compare two call graphs given as JSON files, no analysis")
    .usage("[options] [files]")
    .addHelpText("after",
        "\nAll modules reachable by require/import from the given files are included in the analysis\n" +
        "(except when using --ignore-dependencies). If specifying directories instead\n" +
        "of files, the files in the directories and their subdirectories are used as entry points.\n" +
        "The special argument -- can be used indicate end of options, typically after multi-argument options.\n" +
        `Memory limit is ${getMemoryLimit()}MB.${PKG ? "" : " Change with, for example: NODE_OPTIONS=--max-old-space-size=4096"}`)
    .action(main)
    .showHelpAfterError()
    .parse();

async function main() {
    options.tty = true;
    setOptions(program.opts());
    if (options.logfile)
        logToFile(options.logfile);
    setLogLevel(options.loglevel);

    if (PKG)
        for (const opt of ["dynamic"] as const)
            if (options[opt]) {
                logger.error(`Error: Option --${opt} not available in binary executable`);
                process.exitCode = -1;
                return;
            }

    if (options.compareCallgraphs) {
        if (program.args.length !== 2) {
            logger.error(`Error: Option --compare-callgraphs expects two files`);
            process.exitCode = -1;
            return;
        }
        compareCallGraphs(program.args[0], program.args[1]);
        return;
    }

    if (options.patterns && options.vulnerabilities) { // TODO: also check this in server.ts
        logger.error(`Error: Options --patterns and --vulnerabilities cannot be used together`); // pattern match confidence computation requires relevant libraries to be external
        process.exitCode = -1;
        return;
    }

    if (options.gc && typeof gc !== "function") {
        // restart with node option --expose-gc if --gc is enabled
        const args = process.argv.slice(1);
        args.unshift("--expose-gc");
        const t = spawnSync(process.execPath, args, {stdio: "inherit"});
        if (t.status === null) {
            logger.error("Error: Unable to restart with --expose-gc");
            process.exitCode = -1;
        } else
            process.exitCode = t.status;
        return;
    }

    if (options.dynamic) {

        const graalHome = options.graalHome || process.env.GRAAL_HOME;
        const node = graalHome ? path.resolve(graalHome, "bin/node") : "node";
        if (!options.skipGraalTest) {
            logger.info("Testing graal-nodejs")
            const t = spawnSync(node, ["-e", "process.exit(typeof Graal === 'object' ? 0 : -1)"]);
            if (t.status === null) {
                logger.error(`Error: Unable to execute ${node}`);
                process.exitCode = -1;
                return;
            }
            if (t.status !== 0) {
                logger.error("Error: 'node' is not graal-nodejs, try option --graal-home or environment variable GRAAL_HOME");
                process.exitCode = -1;
                return;
            }
        }
        logger.info("Generating dynamic call graph");
        let cmd, args, cwd;
        if (options.npmTest) {
            cmd = "npm";
            args = ["test", ...program.args];
            cwd = path.resolve(options.npmTest)
        } else {
            if (program.args.length === 0) {
                logger.info("File missing, aborting");
                return;
            }
            cmd = `${__dirname}/../bin/node`;
            args = program.args;
            cwd = process.cwd()
        }
        const dyn = path.resolve(options.dynamic);
        const t = spawnSync(cmd, args, {
            stdio: "inherit",
            cwd,
            env: {
                ...process.env,
                JELLY_OUT: dyn,
                GRAAL_HOME: graalHome ? path.resolve(graalHome) : undefined,
                PATH: `${__dirname}/bin${path.delimiter}${process.env.PATH}`
            }
        });
        if (t.status === null) {
            logger.error(`Error: Unable to execute ${cmd}`);
            process.exitCode = -1;
            return;
        }

        const dir = path.dirname(dyn);
        const cgs: Array<CallGraph> = [];
        for (const f of readdirSync(dir, {withFileTypes: true}))
            if (f.isFile()) {
                const p = path.resolve(dir, f.name);
                if (p.startsWith(`${dyn}-`)) { // instrumented execution has produced $JELLY-OUT-<PID> files
                    cgs.push(JSON.parse(readFileSync(p, 'utf-8')) as CallGraph);
                    unlinkSync(p);
                }
            }
        const fd = openSync(dyn, "w");
        writeStreamedStringify(merge(cgs), fd); // TODO: alert if the call graph is empty?
        closeSync(fd);
        logger.info(`Dynamic call graph written to ${dyn}`);

    } else {

        if (program.args.length === 0) {
            logger.info("No files to analyze (use --help to see usage)");
            return;
        }

        if (!autoDetectBaseDir(program.args))
            return;
        const files = expand(program.args);
        if (logger.isVerboseEnabled()) {
            logger.verbose("Entry files:");
            for (const file of files)
                logger.verbose(`  ${file}`);
        }

        if (options.typescriptLibraryUsage) {

            const ts = new TypeScriptTypeInferrer(files);
            const fd = openSync(options.typescriptLibraryUsage, "w");
            writeStreamedStringify(ts.libraryUsageToJSON(ts.getLibraryUsage()), fd);
            closeSync(fd);
            logger.info(`TypeScript library usage written to ${options.typescriptLibraryUsage}`);

        } else {

            let tapirPatterns, patterns, globs, props, vulnerabilityDetector;
            if (options.patterns) {
                tapirPatterns = removeObsoletePatterns(loadTapirDetectionPatternFiles(options.patterns));
                patterns = convertTapirPatterns(tapirPatterns);
                globs = getGlobs(patterns);
                props = getProperties(patterns);
            }
            if (options.vulnerabilities) {
                logger.info(`Loading vulnerability patterns from ${options.vulnerabilities}`);
                vulnerabilityDetector = new VulnerabilityDetector(JSON.parse(readFileSync(options.vulnerabilities, "utf8")) as Array<Vulnerability>); // TODO: use when setting globs and props? (see also server.ts)
                const ps = vulnerabilityDetector.getPatterns();
                addAll(getGlobs(ps), (globs = (globs ?? new Set<string>())));
                addAll(getProperties(ps), (props = (props ?? new Set<string>())));
            }

            setDefaultTrackedModules(globs);
            setPatternProperties(options.apiUsage ? undefined : (props || new Set()));

            const solver = new Solver();
            const a = solver.globalState;
            a.vulnerabilities = vulnerabilityDetector;
            await analyzeFiles(files, solver);
            const f = solver.fragmentState;
            const out = new AnalysisStateReporter(f);

            let typer: TypeScriptTypeInferrer | undefined;
            if (options.typescript)
                typer = new TypeScriptTypeInferrer(files);

            let vr: VulnerabilityResults = {};
            if (vulnerabilityDetector) {
                vr.package = vulnerabilityDetector.findPackagesThatMayDependOnVulnerablePackages(f);
                vr.module = vulnerabilityDetector.findModulesThatMayDependOnVulnerableModules(f);
                vr.function = vulnerabilityDetector.findFunctionsThatMayReachVulnerableFunctions(f);
                vr.call = vulnerabilityDetector.findCallsThatMayReachVulnerableFunctions(f, vr.function);
                vulnerabilityDetector.reportResults(f, vr);
                vr.matches = vulnerabilityDetector.patternMatch(f, typer, solver.diagnostics);
                // TODO: find functions that may reach functions in vulnerabilities.matches
            }

            if (options.callgraphHtml) {
                const file = options.callgraphHtml;
                exportCallGraphHtml(f, file, vr);
                logger.info(`Call graph written to ${file}`);
            }

            if (options.dataflowHtml) {
                const file = options.dataflowHtml;
                exportDataFlowGraphHtml(f, file); // TODO: also show pattern matches and reachability
                logger.info(`Data-flow graph written to ${file}`);
            }

            if (options.callgraphGraphviz) {
                const file = options.callgraphGraphviz;
                const fd = openSync(file, "w");
                toDot(f, fd);
                closeSync(fd);
                logger.info(`Call graph written to ${file}`);
            }

            if (options.tokens)
                out.reportTokens();

            if (options.tokensJson)
                out.saveTokens(options.tokensJson);

            if (options.largest) {
                out.reportLargestSubsetEdges();
                out.reportLargestTokenSets();
            }

            if (options.callgraphJson)
                out.saveCallGraph(options.callgraphJson, files);

            if (options.diagnosticsJson)
                out.saveDiagnostics(solver.diagnostics, options.diagnosticsJson);

            if (options.modulesOnly)
                out.reportReachablePackagesAndModules();

            if (options.soundness)
                testSoundness(options.soundness, f);

            if (tapirPatterns && patterns)
                tapirPatternMatch(tapirPatterns, patterns, f, typer, undefined, solver.diagnostics);

            if (options.apiUsage) {
                const [r1, r2] = getAPIUsage(f);
                reportAPIUsage(r1, r2);
            }

            if (options.apiExported || options.findAccessPaths) {
                const r = getAPIExported(f);
                if (options.apiExported)
                    reportAPIExportedFunctions(r);
                if (options.findAccessPaths)
                    reportAccessPaths(f, r, options.findAccessPaths);
            }

            if (options.higherOrderFunctions)
                out.reportHigherOrderFunctions();

            if (options.zeros) {
                const funs = out.getZeroCallerFunctions();
                out.reportZeroCallerFunctions(funs);
                const calls = out.getZeroCalleeCalls();
                out.reportZeroCalleeCalls(calls);
            }

            if (options.variableKinds)
                out.reportVariableKinds();
        }
    }
}