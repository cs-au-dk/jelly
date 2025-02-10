import {ChildProcess, fork} from "child_process";
import logger from "../misc/logger";
import {options} from "../options";
import {HintsJSON, RequestType, ResponseType} from "../typings/hints";
import {addPairArrayToMapSet, FilePath, LocationJSON, mapArraySize, percent, stringify} from "../misc/util";
import {closeSync, openSync, writeSync} from "fs";
import {checkFile} from "./transform";
import {GlobalState} from "../analysis/globalstate";
import {Hints} from "./hints";
import Timer, {nanoToMs} from "../misc/timer";
import {extname, resolve} from "path";
import {isLocalRequire, isShebang, requireResolve, writeStreamedStringify} from "../misc/files";
import {ApproxDiagnostics} from "./diagnostics";

/**
 * Manager for approximate interpretation processes.
 */
export class ProcessManager {

    private readonly p: ChildProcess;

    /**
     * Analysis hints from approximate interpretation.
     */
    readonly hints = new Hints();

    /**
     * Number of modules executed with approximate interpretation.
     */
    numExecutions = 0;

    /**
     * Number of functions that have been force-executed.
     */
    numForced = 0;

    /**
     * Number of force-executed functions that terminated with exception.
     */
    numForcedExceptions = 0;

    /**
     * Number of modules where approximate interpretation of top-level code resulted in uncaught exceptions.
     */
    numModuleExceptions = 0;

    /**
     * Total number of functions found statically in the visited files.
     */
    numStaticFunctions = 0;

    /**
     * Map from module name to set of statically resolvable requires (excluding built-ins and aliases).
     */
    staticRequires = new Map<string, Set<string>>();

    /**
     * Time (nanoseconds) spent on approximate interpretation.
     */
    approxTime: bigint = 0n;

    /**
     * Total code size (bytes) excluding dynamically generated code.
     */
    totalCodeSize: number = 0;

    /**
     * Resolve function for the 'execute' result promise.
     */
    private resultPromiseResolve: (() => void) | undefined;

    /**
     * Timer for measuring approximate interpretation time.
     */
    private timer: Timer | undefined;

    /**
     * Starts approximate interpretation process.
     */
    constructor(readonly a: GlobalState = new GlobalState) {
        logger.verbose("Starting approximate interpretation process");
        // When running from test, __dirname is the .ts equivalent file so resolve this to the corresponding .js file.
        const resolvedDirname = __dirname.endsWith(".js") ? __dirname : `${__dirname}/../../lib/approx`
        this.p = fork(`${resolvedDirname}/approx.js`, [JSON.stringify(options)], {stdio: "inherit"});
        this.p.on('message', (msg: ResponseType) => {
            if (!this.resultPromiseResolve) {
                logger.error("Unexpected message from child process");
                return;
            }
            if (logger.isDebugEnabled())
                logger.debug(`Hints received from approximate interpretation process:\n${JSON.stringify(msg, undefined, 2)}`);
            this.add(msg.hints);
            this.numForced += msg.numForced;
            this.numForcedExceptions += msg.numForcedExceptions;
            this.numModuleExceptions += msg.moduleException ? 1 : 0;
            this.numStaticFunctions += msg.numStaticFunctions;
            addPairArrayToMapSet(msg.staticRequires, this.staticRequires);
            this.totalCodeSize = msg.totalCodeSize;
            this.resultPromiseResolve();
            this.resultPromiseResolve = undefined;
            this.approxTime += this.timer!.elapsed();
            this.timer = undefined;
        });
    }

    /**
     * Performs approximate interpretation of the given files including files found to be reachable.
     */
    async analyzeFiles(files: Array<string>) {
        for (const file of files)
            this.a.reachedFile(resolve(options.basedir, file));
        while (this.a.pendingFiles.length > 0) {
            const file = this.a.pendingFiles.shift()!;
            const m = this.a.getModuleInfo(file);
            if (this.hints.moduleIndex.has(m.toString())) {
                if (logger.isDebugEnabled())
                    logger.debug(`Skipping ${file}, module already visited`);
            } else if (!([".js", ".jsx", ".es", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"].includes(extname(file)) ||
                (extname(file) === "" && isShebang(file)))) {
                logger.info(`Skipping ${file}, unsupported extension`);
            } else {
                if (options.printProgress)
                    logger.info(`Analyzing ${file}`);
                this.numExecutions++;
                await this.execute(file);
            }
            // include static requires found in the ASTs of the module and the modules reached dynamically
            const rs = this.staticRequires.get(file);
            if (rs)
                for (const r of rs)
                    try {
                        const filepath = requireResolve(r, file, this.a);
                        if (filepath)
                            this.a.reachedFile(filepath, m, isLocalRequire(r));
                    } catch {
                        logger.warn(`Unable to resolve module '${r}' from ${file}`);
                    }
        }
    }

    /**
     * Terminates approximate interpretation process.
     */
    stop() {
        logger.verbose("Stopping approximate interpretation process");
        this.p.kill();
    }

    /**
     * Performs approximate interpretation on the given module.
     * @param file module path
     */
    async execute(file: FilePath) {
        checkFile(file);
        this.timer = new Timer();
        return new Promise<void>((resolve) => {
            this.resultPromiseResolve = resolve;
            this.p.send({file} satisfies RequestType);
        });
    }

    /**
     * Adds the given hints.
     */
    add(newHints: HintsJSON) {
        const moduleReindex = new Map<number, number>();
        for (const [i, s] of newHints.modules.entries()) {
            let m: string;
            if (s[0] === "/") {
                // convert file name to module name and register the file as reached
                const i = s.indexOf(":eval["),
                    file = i === -1 ? s : s.substring(0, i),
                    rest = i === -1 ? "" : s.substring(i);
                const mod = this.a.reachedFile(file);
                m = mod.toString() + rest;
            } else
                m = s;
            moduleReindex.set(i, this.hints.addModule(m));
        }
        const convert = (loc: LocationJSON): LocationJSON => `${moduleReindex.get(parseInt(loc))}${loc.substring(loc.indexOf(":"))}`;
        for (const f of newHints.functions)
            this.hints.addFunction(convert(f)!);
        for (const {loc, prop, valLoc, valType} of newHints.reads) {
            this.hints.addReadHint({
                loc: convert(loc)!,
                prop,
                valLoc: convert(valLoc),
                valType
            });
        }
        for (const {type, loc, baseLoc, baseType, prop, valLoc, valType} of newHints.writes) {
            this.hints.addWriteHint({
                type,
                loc: convert(loc)!,
                baseLoc: convert(baseLoc),
                baseType,
                prop,
                valLoc: convert(valLoc),
                valType
            });
        }
        for (const {loc, str} of newHints.requires)
            this.hints.addRequireHint({
                loc: convert(loc)!,
                str
            });
        for (const {loc, str} of newHints.evals)
            this.hints.addEvalHint({
                loc: convert(loc)!,
                str
            });
    }

    /**
     * Saves the hints to a file.
     */
    saveHintsToFile(file: string) {
        const fd = openSync(file, "w");
        writeStreamedStringify(this.hints.toJSON(), fd);
        closeSync(fd);
        logger.info(`Approximate interpretation hints written to ${file}`);
    }

    /**
     * Prints diagnostics.
     */
    printDiagnostics() {
        const staticFunctionsVisited = this.getStaticFunctionsVisited();
        logger.info(`Approximate interpretation time: ${nanoToMs(this.approxTime)}, packages visited: ${this.a.packageInfos.size}, code size: ${Math.ceil(this.totalCodeSize / 1024)}KB`);
        logger.info(`Modules analyzed dynamically: ${this.numExecutions}, visited: ${this.a.moduleInfos.size}, exceptions: ${this.numModuleExceptions}`); // TODO: this.a.moduleInfos currently doesn't include pseudo-modules for eval code (see also getStaticFunctionsVisited)
        logger.info(`Force-executed functions: ${this.numForced}/${this.numStaticFunctions}, ` +
            `visited: ${staticFunctionsVisited}${this.numStaticFunctions > 0 ? ` (${percent(staticFunctionsVisited / this.numStaticFunctions)})` : ""}, ` +
            `exceptions: ${this.numForcedExceptions}`);
        logger.info(`Produced hints reads: ${mapArraySize(this.hints.reads)}, writes: ${mapArraySize(this.hints.writes)}, ` +
            `requires: ${mapArraySize(this.hints.requires)}, evals: ${mapArraySize(this.hints.evals)}`);
    }

    /**
     * Returns diagnostics object.
     */
    getDiagnostics(): ApproxDiagnostics {
        return {
            time: this.approxTime,
            visitedPackages: this.a.packageInfos.size,
            codeSize: Math.ceil(this.totalCodeSize / 1024),
            modulesAnalyzed: this.numExecutions,
            modulesVisited: this.a.moduleInfos.size,
            moduleExceptions: this.numModuleExceptions,
            forceExecutedFunctions: this.numForced,
            staticFunctions: this.numStaticFunctions,
            staticFunctionsVisited: this.getStaticFunctionsVisited(),
            exceptions: this.numModuleExceptions,
            readHints: mapArraySize(this.hints.reads),
            writeHints: mapArraySize(this.hints.writes),
            requireHints: mapArraySize(this.hints.requires),
            evalHints: mapArraySize(this.hints.evals)
        };
    }

    private getStaticFunctionsVisited(): number {
        let c = 0;
        for (const f of this.hints.functions) {
            const i = parseInt(f);
            if (!this.hints.modules[i].endsWith("]")) // skips "...:eval[...]"
                c++;
        }
        return c;
    }

    /**
     * Saves diagnostics to JSON file.
     */
    saveDiagnosticsToFile(file: string) {
        const fd = openSync(file, "w");
        writeSync(fd, stringify(this.getDiagnostics()));
        closeSync(fd);
        logger.info(`Approximate interpretation diagnostics written to ${file}`);
    }
}