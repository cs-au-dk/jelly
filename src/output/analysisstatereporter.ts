import logger from "../misc/logger";
import {
    addAll,
    deleteAll,
    FilePath,
    getOrSet,
    Location,
    locationToStringWithFile,
    locationToStringWithFileAndEnd,
    mapGetArray,
    SimpleLocation,
    stringify
} from "../misc/util";
import {GlobalState} from "../analysis/globalstate";
import {FunctionToken, NativeObjectToken, Token} from "../analysis/tokens";
import fs from "fs";
import {ConstraintVar, NodeVar, ObjectPropertyVar} from "../analysis/constraintvars";
import {FragmentState, RepresentativeVar} from "../analysis/fragmentstate";
import {relative, resolve} from "path";
import {options} from "../options";
import {DummyModuleInfo, FunctionInfo, ModuleInfo} from "../analysis/infos";
import {Function, isIdentifier, Node} from "@babel/types";
import assert from "assert";
import AnalysisDiagnostics from "../analysis/diagnostics";
import {CallGraph} from "../typings/callgraph";

/**
 * Functions for reporting information about the analysis state.
 */
export class AnalysisStateReporter {

    readonly f: FragmentState;

    readonly a: GlobalState;

    constructor(f: FragmentState) {
        this.f = f;
        this.a = f.a;
    }

    /**
     * Saves the constraint variables and their tokens to a JSON file.
     */
    saveTokens(outfile: string) {
        const varIndex = new Map<ConstraintVar, number>();
        const fd = fs.openSync(outfile, "w");
        fs.writeSync(fd, "[");
        let firstvar = true;
        for (const [v, ts] of this.f.getAllVarsAndTokens()) {
            varIndex.set(v, varIndex.size);
            if (firstvar)
                firstvar = false;
            else
                fs.writeSync(fd, ",");
            fs.writeSync(fd, `\n { "var": ${JSON.stringify(v.toString())}, "tokens": [`);
            let firsttoken = true;
            for (const t of ts) {
                if (firsttoken)
                    firsttoken = false;
                else
                    fs.writeSync(fd, ",");
                fs.writeSync(fd, `\n  ${JSON.stringify(t.toString())}`);
            }
            fs.writeSync(fd, "\n ] }");
        }
        for (const v of this.f.redirections.keys()) {
            const repi = varIndex.get(this.f.getRepresentative(v));
            if (repi !== undefined) {
                assert(!firstvar);
                fs.writeSync(fd, `,\n { "var": ${JSON.stringify(v.toString())}, "rep": ${repi} }`);
            }
        }
        fs.writeSync(fd, "\n]");
        fs.closeSync(fd);
        logger.info(`Analysis tokens written to ${outfile}`);
    }


    private makeLocStr(fileIndex: number, loc: SimpleLocation | undefined | null): string {
        return `${fileIndex}:${loc ? `${loc.start.line}:${loc.start.column + 1}:${loc.end.line}:${loc.end.column + 1}` : "?:?:?:?"}`;
    }

    /**
     * Saves the call graph to a JSON file using the format defined in callgraph.d.ts.
     */
    saveCallGraph(outfile: string, files: Array<string>) { // TODO: use callGraphToJSON?
        const fd = fs.openSync(outfile, "w");
        fs.writeSync(fd, `{\n "time": "${new Date().toUTCString()}",\n`);
        fs.writeSync(fd, ` "entries": [`);
        let first = true;
        for (const file of files) {
            fs.writeSync(fd, `${first ? "" : ","}\n  ${JSON.stringify(relative(options.basedir, resolve(options.basedir, file)))}`);
            first = false;
        }
        fs.writeSync(fd, `\n ],\n`);
        if (options.ignoreDependencies)
            fs.writeSync(fd, ` "ignoreDependencies": true,\n`);
        if (options.includePackages) {
            fs.writeSync(fd, ` "included": [`);
            first = true;
            for (const name of options.includePackages) {
                fs.writeSync(fd, `${first ? "" : ","}\n  ${JSON.stringify(name)}`);
                first = false;
            }
            fs.writeSync(fd, `\n ],\n`);
        }
        if (options.excludePackages) {
            fs.writeSync(fd, ` "excluded": [`);
            first = true;
            for (const name of options.excludePackages) {
                fs.writeSync(fd, `${first ? "" : ","}\n  ${JSON.stringify(name)}`);
                first = false;
            }
            fs.writeSync(fd, `\n ],\n`);
        }
        fs.writeSync(fd, ` "files": [`);
        const fileIndices = new Map<ModuleInfo, number>();
        first = true;
        for (const m of this.a.moduleInfos.values())
            if (m.loc) {
                fileIndices.set(m, fileIndices.size);
                fs.writeSync(fd, `${first ? "" : ","}\n  ${JSON.stringify(relative(options.basedir, m.getPath()))}`);
                first = false;
            }
        fs.writeSync(fd, `\n ],\n "functions": {`);
        const functionIndices = new Map<FunctionInfo | ModuleInfo, number>();
        first = true;
        for (const fun of [...this.a.functionInfos.values(), ...this.a.moduleInfos.values()])
            if (fun instanceof FunctionInfo || fun.loc) {
                const funIndex = functionIndices.size;
                functionIndices.set(fun, funIndex);
                const fileIndex = fileIndices.get(fun instanceof ModuleInfo ? fun : fun.moduleInfo);
                if (fileIndex === undefined)
                    assert.fail(`File index not found for ${fun}`);
                fs.writeSync(fd, `${first ? "" : ","}\n  "${funIndex}": ${JSON.stringify(this.makeLocStr(fileIndex, fun.loc))}`);
                first = false;
            }
        fs.writeSync(fd, `\n },\n "calls": {`);
        const callIndices = new Map<Node, number>();
        first = true;
        for (const call of this.f.callLocations) {
            const m = (call.loc as Location).module;
            assert(m);
            const callIndex = callIndices.size + functionIndices.size;
            callIndices.set(call, callIndex);
            const fileIndex = fileIndices.get(m);
            if (fileIndex === undefined)
                assert.fail(`File index not found for ${m}`);
            fs.writeSync(fd, `${first ? "" : ","}\n  "${callIndex}": ${JSON.stringify(this.makeLocStr(fileIndex, call.loc))}`);
            first = false;
        }
        fs.writeSync(fd, `\n },\n "fun2fun": [`);
        first = true;
        for (const [caller, callees] of [...this.f.functionToFunction, ...(options.callgraphRequire ? this.f.requireGraph : [])])
            if (caller instanceof FunctionInfo || caller.loc)
                for (const callee of callees)
                    if (callee instanceof FunctionInfo || callee.loc) {
                        const callerIndex = functionIndices.get(caller);
                        if (callerIndex === undefined)
                            assert.fail(`Function index not found for ${caller}`);
                        const calleeIndex = functionIndices.get(callee);
                        if (calleeIndex === undefined)
                            assert.fail(`Function index not found for ${callee}`);
                        fs.writeSync(fd, `${first ? "\n  " : ", "}[${callerIndex}, ${calleeIndex}]`);
                        first = false;
                    }
        fs.writeSync(fd, `${first ? "" : "\n "}],\n "call2fun": [`);
        first = true;
        for (const [call, callIndex] of callIndices) {
            const funs = this.f.callToFunction.get(call) || [];
            const mods = this.f.callToModule.get(call) || [];
            for (const callee of [...funs, ...mods])
                if (!(callee instanceof DummyModuleInfo) && callee.loc) { // skipping require/import edges to modules that haven't been analyzed
                    const calleeIndex = functionIndices.get(callee);
                    if (calleeIndex === undefined)
                        assert.fail(`Function index not found for ${callee}`);
                    fs.writeSync(fd, `${first ? "\n  " : ", "}[${callIndex}, ${calleeIndex}]`);
                    first = false;
                }
        }
        fs.writeSync(fd, `${first ? "" : "\n "}],\n "ignore": [`);
        first = true;
        for (const [m, loc] of this.f.artificialFunctions) {
            const fileIndex = fileIndices.get(m);
            if (fileIndex === undefined)
                assert.fail(`File index not found for ${m}`);
            fs.writeSync(fd, `${first ? "" : ","}\n  ${JSON.stringify(this.makeLocStr(fileIndex, loc))}`);
            first = false;
        }
        fs.writeSync(fd, `${first ? "" : "\n "}]\n}\n`);
        fs.closeSync(fd);
        logger.info(`Call graph written to ${outfile}`);
    }

    /**
     * Creates a JSON representation of the call graph using the format defined in callgraph.d.ts.
     */
    callGraphToJSON(ifiles: Array<string>): CallGraph {
        type Edges = Array<[number, number]>;
        const files: Array<FilePath> = [],
            functions: Array<string> = [],
            calls: Array<string> = [],
            fun2fun: Edges = [],
            call2fun: Edges = [];
        const fileIndices = new Map<ModuleInfo, number>();
        for (const m of this.a.moduleInfos.values())
            if (m.loc) {
                fileIndices.set(m, fileIndices.size);
                files.push(relative(options.basedir, m.getPath()));
            }
        const functionIndices = new Map<FunctionInfo | ModuleInfo, number>();
        for (const fun of [...this.a.functionInfos.values(), ...this.a.moduleInfos.values()])
            if (fun instanceof FunctionInfo || fun.loc) {
                const funIndex = functions.length;
                functionIndices.set(fun, funIndex);
                const fileIndex = fileIndices.get(fun instanceof ModuleInfo ? fun : fun.moduleInfo);
                if (fileIndex === undefined)
                    assert.fail(`File index not found for ${fun}`);
                functions.push(this.makeLocStr(fileIndex, fun.loc));
            }
        const callIndices = new Map<Node, number>();
        for (const call of this.f.callLocations) {
            const m = (call.loc as Location).module;
            assert(m);
            const fileIndex = fileIndices.get(m);
            if (fileIndex === undefined)
                assert.fail(`File index not found for ${m}`);
            const callIndex = calls.length;
            callIndices.set(call, callIndex);
            calls.push(this.makeLocStr(fileIndex, call.loc));
        }
        for (const [caller, callees] of [...this.f.functionToFunction, ...(options.callgraphRequire ? this.f.requireGraph : [])])
            if (caller instanceof FunctionInfo || caller.loc)
                for (const callee of callees)
                    if (callee instanceof FunctionInfo || callee.loc) {
                        const callerIndex = functionIndices.get(caller);
                        if (callerIndex === undefined)
                            assert.fail(`Function index not found for ${caller}`);
                        const calleeIndex = functionIndices.get(callee);
                        if (calleeIndex === undefined)
                            assert.fail(`Function index not found for ${callee}`);
                        fun2fun.push([callerIndex, calleeIndex]);
                    }
        for (const [call, callIndex] of callIndices) {
            const funs = this.f.callToFunction.get(call) || [];
            const mods = this.f.callToModule.get(call) || [];
            for (const callee of [...funs, ...mods])
                if (!(callee instanceof DummyModuleInfo) && callee.loc) { // skipping require/import edges to modules that haven't been analyzed
                    const calleeIndex = functionIndices.get(callee);
                    if (calleeIndex === undefined)
                        assert.fail(`Function index not found for ${callee}`);
                    call2fun.push([callIndex, calleeIndex]);
                }
        }
        return {
            time: new Date().toUTCString(),
            entries: ifiles.map(file => relative(options.basedir, resolve(options.basedir, file))),
            ignoreDependencies: options.ignoreDependencies,
            includePackages: options.includePackages,
            excludePackages: options.excludePackages,
            files,
            functions,
            calls,
            fun2fun,
            call2fun,
            ignore: this.f.artificialFunctions.map(([m, loc]) => {
                const fileIndex = fileIndices.get(m);
                if (fileIndex === undefined)
                    assert.fail(`File index not found for ${m}`);
                return this.makeLocStr(fileIndex, loc);
            }),
        };
    }

    /**
     * Reports the call graph (call sites -> functions).
     */
    reportCallGraph() {
        logger.info("Call graph:");
        for (const [src, dsts] of this.f.callToFunctionOrModule)
            for (const dst of dsts)
                if (dst instanceof FunctionInfo)
                    logger.info(`  ${locationToStringWithFileAndEnd(src.loc)} -> ${locationToStringWithFile(dst.loc)}`);
    }

    /**
     * Reports the token sets for all constraint variables.
     * Native variables and object properties with one value are omitted.
     */
    reportTokens() {
        logger.info("Tokens:");
        const redir = new Map<ConstraintVar, Array<ConstraintVar>>();
        for (const [v, w] of this.f.redirections)
            mapGetArray(redir, this.f.getRepresentative(w)).push(v);
        for (const [v, ts, size] of this.f.getAllVarsAndTokens()) {
            if (size === 0)
                continue;
            if (size === 1) {
                let any = false;
                for (const w of [v, ...redir.get(v) ?? []])
                    if (!((w instanceof ObjectPropertyVar && w.obj instanceof NativeObjectToken) || // TODO: don't omit native variables that contain non-native values?
                        (w instanceof NodeVar && isIdentifier(w.node) && w.node.loc?.start.line === 0))) {
                        any = true;
                        break;
                    }
                if (!any)
                    continue;
            }
            logger.info(`  ${v}: (size ${size})`);
            for (const w of redir.get(v) ?? [])
                logger.info(`  ${w} (redirected)`);
            for (const t of ts)
                logger.info(`    ${t}`);
        }
    }

    /**
     * Returns the call sites that have zero callees,
     * excluding call sites to known native functions or external functions.
     */
    getZeroCalleeCalls(): Set<Node> {
        const calls = new Set<Node>();
        for (const c of this.f.callLocations) {
            if (!this.f.nativeCallLocations.has(c) && !this.f.externalCallLocations.has(c)) {
                const cs = this.f.callToFunction.get(c);
                if (!cs || cs.size === 0)
                    calls.add(c);
            }
        }
        return calls;
    }

    /**
     * Reports the given set of call sites that have zero callees.
     */
    reportZeroCalleeCalls(calls: Set<Node>) {
        for (const c of calls)
            logger.info(`Call with zero callees at ${locationToStringWithFileAndEnd(c.loc)}`);
    }

    /**
     * Returns the number of call sites that have zero callees but may call a known native functions (and not an external function).
     */
    getZeroButNativeCalleeCalls(): number {
        let r = 0;
        for (const c of this.f.callLocations) {
            if (this.f.nativeCallLocations.has(c) && !this.f.externalCallLocations.has(c)) {
                const cs = this.f.callToFunction.get(c);
                if (!cs || cs.size === 0) {
                    r++;
                    if (logger.isDebugEnabled())
                        logger.debug(`Call with native-only callees at ${locationToStringWithFile(c.loc)}`);
                }
            }
        }
        return r;
    }

    /**
     * Returns the number of call sites that have zero callees but may call an external function (and not a known native function).
     */
    getZeroButExternalCalleeCalls(): number {
        let r = 0;
        for (const c of this.f.callLocations) {
            if (this.f.externalCallLocations.has(c) && !this.f.nativeCallLocations.has(c)) {
                const cs = this.f.callToFunction.get(c);
                if (!cs || cs.size === 0) {
                    r++;
                    if (logger.isDebugEnabled())
                        logger.debug(`Call with external-only callees at ${locationToStringWithFile(c.loc)}`);
                }
            }
        }
        return r;
    }

    /**
     * Returns the number of call sites that have zero callees but may call a known native function or an external function.
     */
    getZeroButNativeOrExternalCalleeCalls(): number {
        let r = 0;
        for (const c of this.f.callLocations) {
            if (this.f.nativeCallLocations.has(c) && this.f.externalCallLocations.has(c)) {
                const cs = this.f.callToFunction.get(c);
                if (!cs || cs.size === 0) {
                    r++;
                    if (logger.isDebugEnabled())
                        logger.debug(`Call with native-or-external-only callees at ${locationToStringWithFile(c.loc)}`);
                }
            }
        }
        return r;
    }

    /**
     * Returns the number of call sites that have exactly one callee.
     */
    getOneCalleeCalls(): number {
        let r = 0;
        for (const c of this.f.callLocations) {
            const cs = this.f.callToFunction.get(c);
            if (cs)
                if (cs.size === 1)
                    r++;
        }
        return r;
    }

    /**
     * Returns the number of call sites that have multiple callees.
     */
    getMultipleCalleeCalls(): number {
        let r = 0;
        for (const c of this.f.callLocations) {
            const cs = this.f.callToFunction.get(c);
            if (cs) {
                if (cs.size > 1) {
                    r++;
                    if (logger.isDebugEnabled())
                        logger.debug(`Call with multiple callees at ${locationToStringWithFile(c.loc)}: ${cs.size}`);
                }
            }
        }
        return r;
    }

    /**
     * Returns the functions that have zero callers.
     */
    getZeroCallerFunctions(): Set<FunctionInfo> {
        const funs = new Set(this.a.functionInfos.values());
        for (const fs of this.f.functionToFunction.values())
            deleteAll(fs.values(), funs);
        return funs;
    }

    /**
     * Reports the given set of functions that have zero callers.
     */
    reportZeroCallerFunctions(funs: Set<FunctionInfo>) {
        for (const f of funs)
            logger.info(`Function with zero callers at ${f}`);
    }

    /**
     * Returns the entry modules.
     */
    getEntryModules(): Set<ModuleInfo> {
        return new Set(Array.from(this.a.moduleInfos.values()).filter(m => m.isEntry));
    }

    /**
     * Returns the modules and functions that are reachable from the given entries.
     */
    getReachableModulesAndFunctions(entries: Set<FunctionInfo | ModuleInfo>): Set<FunctionInfo | ModuleInfo> {
        const res = new Set<FunctionInfo | ModuleInfo>(entries);
        const w = Array.from(entries);
        while (w.length > 0) {
            const f = w.pop()!;
            for (const g of [...this.f.functionToFunction.get(f) ?? [], ...this.f.requireGraph.get(f) ?? []]) {
                if (!res.has(g)) {
                    res.add(g);
                    w.push(g);
                    if (logger.isVerboseEnabled())
                        logger.verbose(`${g instanceof FunctionInfo ? "Function" : "Module"} ${g} is reachable`);
                }

            }
        }
        return res;
    }

    /**
     * Saves analysis diagnostics in JSON file.
     */
    saveDiagnostics(stats: AnalysisDiagnostics, file: string) {
        const fd = fs.openSync(file, "w");
        fs.writeSync(fd, stringify(stats));
        fs.closeSync(fd);
        logger.info(`Analysis diagnostics written to ${file}`);
    }

    /**
     * Reports the reachable packages and modules.
     */
    reportReachablePackagesAndModules() {
        logger.info("Packages and modules:");
        for (const p of this.a.packageInfos.values()) {
            logger.info(`${p} (${p.dir})`);
            for (const m of p.modules.values())
                logger.info(`  ${m.getOfficialName()} (${m.relativePath})`);
        }
    }

    /**
     * Reports the largest token sets.
     */
    reportLargestTokenSets() {
        const a: Array<{v: ConstraintVar, ts: Iterable<Token>, size: number}> = [];
        for (const [v, ts, size] of this.f.getAllVarsAndTokens())
            a.push({v, ts, size});
        a.sort((x, y) => y.size - x.size);
        logger.info("Largest token sets:");
        // for (let i = Math.min(9, a.length - 1); i >= 0; i--) {
        for (let i = 0; i < 10 && i < a.length; i++) {
            logger.info(`  ${a[i].v}: ${a[i].size}`);
            if (logger.isVerboseEnabled())
                for (const t of a[i].ts)
                    logger.info(`    ${t}`);
        }
    }

    /**
     * Reports the largest number of outgoing subset edges.
     */
    reportLargestSubsetEdges() {
        const a: Array<{v: ConstraintVar, vs: Set<ConstraintVar>}> = [];
        for (const [v, vs] of this.f.subsetEdges)
            a.push({v, vs});
        a.sort((x, y) => y.vs.size - x.vs.size);
        logger.info("Largest subset outs:");
        // for (let i = Math.min(9, a.length - 1); i >= 0; i--) {
        for (let i = 0; i < 10 && i < a.length; i++) {
            logger.info(`  ${a[i].v}: ${a[i].vs.size}`);
            if (logger.isVerboseEnabled())
                for (const v of a[i].vs)
                    logger.info(`    ${v}`);
        }
    }

    /**
     * Reports higher-order functions.
     * Shows the number of function arguments and function return values for each higher-order function.
     */
    reportHigherOrderFunctions() {
        const funargs = new Map<Function, number>();
        for (const [f, vs] of this.f.functionParameters) {
            for (const v of vs)
                for (const t of this.f.getTokens(this.f.getRepresentative(v)))
                    if (t instanceof FunctionToken)
                        funargs.set(f, (funargs.get(f) || 0) + 1);
        }
        const funreturns = new Map<Function, number>();
        for (const f of this.a.functionInfos.keys()) {
            const v = this.f.varProducer.returnVar(f);
            for (const t of this.f.getTokens(this.f.getRepresentative(v)))
                if (t instanceof FunctionToken)
                    funreturns.set(f, (funreturns.get(f) || 0) + 1);
        }
        logger.info("Higher-order functions (function arguments + function return values):");
        const a = [];
        for (const f of [...funargs.keys(), ...funreturns.keys()])
            a.push(`${locationToStringWithFileAndEnd(f.loc)} (${funargs.get(f) ?? 0}+${funreturns.get(f) ?? 0})`);
        a.sort();
        for (const f of a)
            logger.info(f);

    }

    /**
     * Reports the kinds of constraint variables and the number of occurrences for each kind.
     */
    reportVariableKinds() {
        const varsWithListeners = new Set<RepresentativeVar>();
        addAll(this.f.tokenListeners.keys(), varsWithListeners);
        addAll(this.f.tokenListeners2.keys(), varsWithListeners);
        const counts = new Map<string, number>();
        const withListenersCounts = new Map<string, number>();
        const srcCounts = new Map<string, number>();
        const dstCounts = new Map<string, number>();
        for (const v of this.f.vars) {
            const k = v.getKind();
            counts.set(k, getOrSet(counts, k, () => 0) + 1);
            if (varsWithListeners.has(v))
                withListenersCounts.set(k, getOrSet(withListenersCounts, k, () => 0) + 1);
            if (this.f.subsetEdges.has(v))
                srcCounts.set(k, getOrSet(srcCounts, k, () => 0) + 1);
            if (this.f.reverseSubsetEdges.has(v))
                dstCounts.set(k, getOrSet(dstCounts, k, () => 0) + 1);
        }
        logger.info("Constraint variable kinds (with listeners, sources, targets):");
        for (const [k, n] of Array.from(counts.entries()).sort(([, n1], [, n2]) => n2 - n1))
            logger.info(`${k}: ${n} (${withListenersCounts.get(k) ?? 0}, ${srcCounts.get(k) ?? 0}, ${dstCounts.get(k) ?? 0})`);
        logger.info(`Total: ${this.f.vars.size} (${varsWithListeners.size})`);
    }
}
