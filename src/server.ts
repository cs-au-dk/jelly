#!/usr/bin/env node

import * as readline from "readline";
import {logToFile, setLogLevel} from "./misc/logger";
import {
    AbortRequest,
    AnalyzeRequest,
    ApiUsageRequest,
    ApiUsageResponse,
    CallGraphRequest,
    CallGraphResponse,
    ClearRequest,
    DiagnosticsRequest,
    DiagnosticsResponse,
    ExpandPathsRequest,
    FilesRequest,
    HTMLCallGraphRequest,
    HTMLDataFlowGraphRequest,
    Message,
    OptionsRequest,
    PatternFilesRequest,
    PatternMatchRequest,
    PatternMatchResponse,
    PatternsRequest,
    ReachablePackagesRequest,
    ReachablePackagesResponse,
    Request,
    RequestCommands,
    ResetRequest,
    Response,
    TSLibraryUsageRequest,
    TSLibraryUsageResponse,
    TypeScriptRequest
} from "./typings/ipc";
import {
    COPYRIGHT,
    options,
    resetOptions,
    resolveBaseDir,
    setDefaultTrackedModules,
    setOptions,
    setPatternProperties
} from "./options";
import {autoDetectBaseDir, expand} from "./misc/files";
import {analyzeFiles} from "./analysis/analyzer";
import {TypeScriptTypeInferrer} from "./typescript/typeinferrer";
import {PatternWrapper, SemanticPatch} from "./typings/tapir";
import {DetectionPattern} from "./patternmatching/patterns";
import {
    convertTapirPatterns,
    getGlobs,
    getProperties,
    loadTapirDetectionPatternFiles,
    removeObsoletePatterns
} from "./patternmatching/patternloader";
import {convertPatternMatchesToJSON, PatternMatcher} from "./patternmatching/patternmatcher";
import {convertAPIUsageToJSON, getAPIUsage} from "./patternmatching/apiusage";
import Solver, {AbortedException} from "./analysis/solver";
import {program} from "commander";
import winston from "winston";
import {tmpdir} from "os";
import {AnalysisStateReporter} from "./output/analysisstatereporter";
import {exportCallGraphHtml, exportDataFlowGraphHtml} from "./output/visualizer";
import {VulnerabilityDetector} from "./patternmatching/vulnerabilitydetector";
import {readFileSync} from "fs";
import {Vulnerability} from "./typings/vulnerabilities";
import {addAll, stringify} from "./misc/util";
import {sep} from "path";

const VERSION = require("../package.json").version;

program
    .name("jelly-server")
    .version(VERSION)
    .addHelpText("before", COPYRIGHT)
    .option("-f, --logfile <file>", "log file (default: $TMP/jelly-PID.log)")
    .option("-l, --loglevel <level>", "analysis log level (info/warn/error)", "error")
    .option("-r, --loglevel-server <level>", "server log level (verbose/info/error)", "info")
    .action(main)
    .showHelpAfterError()
    .parse();

async function main() {
    setOptions(program.opts());
    options.logfile ??= `${tmpdir()}${sep}jelly-${process.pid}.log`;
    logToFile(options.logfile);
    if (options.loglevel === "debug" || options.loglevel === "verbose")
        options.loglevel = "info"; // prevent internal analysis log messages in server mode
    setLogLevel(options.loglevel);
    const logger = winston.createLogger({
        level: options.loglevelServer,
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.printf(({level, message, timestamp}) =>
                `${timestamp} [${level}]: ${message}`)
        ),
        transports: new winston.transports.File({
            filename: options.logfile
        })
    });

    logger.info(`Starting server, analysis log level: ${options.loglevel}, server log level: ${options.loglevelServer}`);

    type RequestHandlers = { [Property in RequestCommands]: (req?: Request) => Promise<Response | never | null> };

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });

    rl.on("line", async (input: string) => {
        const trimmed = input.trim();
        if (logger.isVerboseEnabled())
            logger.verbose(`Message received: ${trimmed}`);
        try {
            const message = JSON.parse(trimmed) as Message;
            if (message.type === "request") {
                const req = message as Request;
                const handler = (requestHandlers as RequestHandlers)[req.command];
                if (handler) {
                    try {
                        const res = await handler(req);
                        if (res)
                            sendResponse(res);
                    } catch (err) {
                        sendErrorResponse((err as any)?.message, req);
                    }
                } else
                    sendErrorResponse(`Unrecognized command: ${req.command}`, req);
            } else
                sendErrorResponse(`Unexpected message type: ${message.type}`);
        } catch (err) {
            sendErrorResponse("Unable to parse request");
        }
    });

    rl.on("close", () => {
        logger.info("Connection closed, shutting down");
        process.exit(0);
    });

    process.on("SIGINT", () => {
        logger.info("Received SIGINT, shutting down");
        process.exit(0);
    });

    let seq = 1;

    function prepareResponse<S extends boolean, M extends string | undefined, B>(success: S, req: Request | undefined, extra: {message?: M & string, body?: B} = {}): Response & {success: S, message: typeof extra.message, body: typeof extra.body} {
        return {
            type: "response",
            seq: seq++,
            command: req?.command,
            request_seq: req?.seq,
            success,
            message: extra.message,
            body: extra.body
        };
    }

    function sendResponse(res: Response) {
        const str = stringify(res, 0);
        process.stdout.write(`Content-Length: ${str.length}\r\n\r\n`);
        process.stdout.write(str);
        process.stdout.write("\r\n");
        if (logger.isVerboseEnabled())
            logger.verbose(`Message sent: ${stringify(res)}`);
    }

    function sendErrorResponse(message: string, req?: Request) {
        logger.error(message);
        sendResponse(prepareResponse(false, req, {message}));
    }

    let analyzing: boolean = false;
    let aborting: boolean = false;
    let files: Array<string> | undefined;
    let solver: Solver | undefined;
    let typer: TypeScriptTypeInferrer | undefined;
    let tapirPatterns: Array<PatternWrapper | SemanticPatch> | undefined;
    let patterns: Array<DetectionPattern | undefined> | undefined;
    let globs: Set<string> | undefined;
    let props: Set<string> | undefined;
    let vulnerabilityDetector: VulnerabilityDetector | undefined;

    function clearAnalysisData() {
        files = solver = typer = tapirPatterns = patterns = globs = props = undefined;
        if (typeof gc === "function")
            gc();
    }

    const requestHandlers = {

        exit: async () => {
            logger.info("Received exit command, shutting down");
            process.exit(0);
        },

        options: async (req: OptionsRequest) => {
            setOptions(req.arguments);
            setLogLevel(options.loglevel);
            if (options.vulnerabilities) { // TODO: support loading from network?
                logger.info(`Loading vulnerability patterns from ${options.vulnerabilities}`);
                vulnerabilityDetector = new VulnerabilityDetector(JSON.parse(readFileSync(options.vulnerabilities, "utf8")) as Array<Vulnerability>); // TODO: use when setting globs and props? (see also main.ts)
            }
            logger.info("Options set");
            return prepareResponse(true, req);
        },

        expandpaths: async (req: ExpandPathsRequest) => {
            try {
                const body = expand(req.arguments);
                const res = prepareResponse(true, req, {body});
                logger.info("Expanded paths");
                return res;
            } catch (e) {
                return prepareResponse(false, req, {message: `Error: ${e instanceof Error ? e.message : "Unable to expand paths"}`});
            }
        },

        files: async (req: FilesRequest) => {
            if (analyzing)
                return prepareResponse(false, req, {message: "Analysis in progress"});
            files = req.arguments;
            autoDetectBaseDir(files);
            resolveBaseDir();
            logger.info("Files selected");
            return prepareResponse(true, req);
        },

        analyze: async (req: AnalyzeRequest) => {
            if (!files)
                return prepareResponse(false, req, {message: "Files have not been selected"});
            if (analyzing)
                return prepareResponse(false, req, {message: "Analysis already in progress"});
            solver = undefined;
            let gs, ps;
            if (globs || vulnerabilityDetector) {
                gs = new Set<string>();
                addAll(globs, gs);
                ps = new Set<string>();
                addAll(props, ps);
                if (vulnerabilityDetector) {
                    const qs = vulnerabilityDetector.getPatterns();
                    addAll(getGlobs(qs), gs);
                    addAll(getProperties(qs), ps);
                }
            }
            setDefaultTrackedModules(gs);
            setPatternProperties(options.apiUsage ? undefined : (ps || new Set));
            analyzing = true;
            aborting = false;
            logger.info("Starting analysis");
            try {
                solver = new Solver(() => aborting);
                await analyzeFiles(files, solver);
                logger.info(`Analysis completed${solver.diagnostics.aborted ? " (aborted)" : solver.diagnostics.timeout ? " (timeout)" : ""}`);
                return prepareResponse(true, req);
            } catch (ex) {
                logger.info("Analysis terminated unsuccessfully");
                if (ex instanceof AbortedException)
                    return prepareResponse(false, req, {message: "Analysis was aborted"});
                throw ex;
            } finally {
                analyzing = aborting = false;
            }
        },

        abort: async (req: AbortRequest) => {
            if (!analyzing)
                return prepareResponse(false, req, {message: "Analysis not currently running"});
            logger.info("Aborting analysis");
            aborting = true;
            return prepareResponse(true, req);
        },

        clear: async (req: ClearRequest) => {
            if (analyzing)
                return prepareResponse(false, req, {message: "Analysis in progress"});
            clearAnalysisData();
            logger.info("Analysis data cleared");
            return prepareResponse(true, req);
        },

        reset: async (req: ResetRequest) => {
            if (analyzing)
                return prepareResponse(false, req, {message: "Analysis in progress"});
            clearAnalysisData();
            resetOptions();
            logger.info("Reset completed");
            return prepareResponse(true, req);
        },

        typescript: async (req: TypeScriptRequest) => {
            if (!files)
                return prepareResponse(false, req, {message: "No files selected"});
            typer = new TypeScriptTypeInferrer(files);
            logger.info("TypeScript parsing done");
            return prepareResponse(true, req);
        },

        diagnostics: async (req: DiagnosticsRequest) => {
            if (!solver)
                return prepareResponse(false, req, {message: "Analysis results not available"});
            solver.updateDiagnostics();
            const res: DiagnosticsResponse = prepareResponse(true, req, {body: solver.diagnostics});
            logger.info("Sending analysis diagnostics");
            return res;
        },

        apiusage: async (req: ApiUsageRequest) => {
            if (!solver || analyzing)
                return prepareResponse(false, req, {message: "Analysis results not available"});
            if (!options.apiUsage)
                return prepareResponse(false, req, {message: "API usage not enabled, must be enabled before analyze"});
            const [r1] = getAPIUsage(solver.fragmentState);
            const body = convertAPIUsageToJSON(r1);
            const res: ApiUsageResponse = prepareResponse(true, req, {body});
            logger.info("Sending API usage");
            return res;
        },

        patternfiles: async (req: PatternFilesRequest) => {
            if (analyzing)
                return prepareResponse(false, req, {message: "Analysis in progress"});
            tapirPatterns = removeObsoletePatterns(loadTapirDetectionPatternFiles(req.arguments));
            patterns = convertTapirPatterns(tapirPatterns);
            globs = getGlobs(patterns);
            props = getProperties(patterns);
            logger.info("Patterns loaded from files");
            return prepareResponse(true, req);
        },

        patterns: async (req: PatternsRequest) => {
            if (analyzing)
                return prepareResponse(false, req, {message: "Analysis in progress"});
            tapirPatterns = removeObsoletePatterns(req.arguments);
            patterns = convertTapirPatterns(tapirPatterns);
            globs = getGlobs(patterns);
            props = getProperties(patterns);
            logger.info("Patterns loaded");
            return prepareResponse(true, req);
        },

        patternmatch: async (req: PatternMatchRequest) => {
            if (!solver || analyzing)
                return prepareResponse(false, req, {message: "Analysis results not available"});
            if (!tapirPatterns || !patterns)
                return prepareResponse(false, req, {message: "Patterns have not been loaded"});
            const matcher = new PatternMatcher(solver.fragmentState, typer);
            const body = convertPatternMatchesToJSON(patterns, matcher, solver.diagnostics);
            const res: PatternMatchResponse = prepareResponse(true, req, {body});
            logger.info("Sending pattern matching results");
            return res;
        },

        callgraph: async (req: CallGraphRequest) => {
            if (!solver || !files)
                return prepareResponse(false, req, {message: "Analysis results not available"});
            const res: CallGraphResponse = prepareResponse(true, req, {body: new AnalysisStateReporter(solver.fragmentState).callGraphToJSON(files)});
            logger.info("Sending call graph");
            return res;
        },

        htmlcallgraph: async (req: HTMLCallGraphRequest) => {
            if (!solver || !files)
                return prepareResponse(false, req, {message: "Analysis results not available"});
            if (!options.callgraphHtml)
                return prepareResponse(false, req, {message: "Option callgraphHtml not set"});
            const vr = options.vulnerabilities && vulnerabilityDetector?.collectAllVulnerabilityResults(solver, typer) || {};
            exportCallGraphHtml(solver.fragmentState, options.callgraphHtml, vr);
            logger.info("Call graph HTML file generated");
            return prepareResponse(true, req);
        },

        htmldataflowgraph: async (req: HTMLDataFlowGraphRequest) => {
            if (!solver || !files)
                return prepareResponse(false, req, {message: "Analysis results not available"});
            if (!options.dataflowHtml)
                return prepareResponse(false, req, {message: "Option dataflowHtml not set"});
            exportDataFlowGraphHtml(solver.fragmentState, options.dataflowHtml);
            logger.info("Data-flow graph HTML file generated");
            return prepareResponse(true, req);
        },

        tslibraryusage: async (req: TSLibraryUsageRequest) => {
            if (!typer)
                return prepareResponse(false, req, {message: "TypeScript parsing result not available"});
            const res: TSLibraryUsageResponse = prepareResponse(true, req, {body: typer.libraryUsageToJSON(typer.getLibraryUsage())});
            logger.info("Sending TypeScript library usage");
            return res;
        },

        reachablepackages: async (req: ReachablePackagesRequest) => {
            if (!solver)
                return prepareResponse(false, req, {message: "Analysis results not available"});
            const packages: ReachablePackagesResponse["body"] = [];
            for (const p of solver.globalState.packageInfos.values())
                packages.push({
                    name: p.name,
                    version: p.version
                });
            const res: ReachablePackagesResponse = prepareResponse(true, req, {body: packages});
            logger.info("Sending reachable packages");
            return res;
        },
    };
}
