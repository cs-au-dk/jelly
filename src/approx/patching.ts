import {ConstraintVar, ObjectPropertyVarObj} from "../analysis/constraintvars";
import {LocationJSON, locationToStringWithFileAndEnd, mapArrayAdd, mapArraySize} from "../misc/util";
import {
    AllocationSiteToken,
    ArrayToken,
    FunctionToken,
    NativeObjectToken,
    PrototypeToken,
    Token
} from "../analysis/tokens";
import Solver from "../analysis/solver";
import {isClassMethod, Node} from "@babel/types";
import assert from "assert";
import logger from "../misc/logger";
import {options} from "../options";
import {EvalHint, ReadHint, RequireHint, WriteHint} from "../typings/hints";
import {Hints} from "./hints";
import {FunctionInfo} from "../analysis/infos";

export const APPROX_READ = true;
export const APPROX_WRITE = true;
export const APPROX_ONLY_EMPTY = false;
export const APPROX_DEVEL = false;

export class Patching {

    /**
     * Maps allocation sites and object types to tokens.
     */
    private readonly allocToToken = new Map<string, ObjectPropertyVarObj>();

    /**
     * Dynamic property reads.
     */
    private dynamicReads: Array<{ // TODO: also stored in fragmentstate?
        node: Node,
        dstVar: ConstraintVar
    }> = [];

    private usedHints = new Set<ReadHint | WriteHint | RequireHint | EvalHint>();

    constructor(readonly hints: Hints) {
        assert(!options.widening, "Option --widening is not supported with approximate interpretation patching"); // TODO: widen allocSite2Token...
        assert(!options.oldobj, "Option --oldobj is not supported with approximate interpretation patching");
    }

    /**
     * Registers a token for an allocation site during analysis.
     */
    registerAllocationSite(t: Token) {
        assert(t instanceof AllocationSiteToken || t instanceof FunctionToken || t instanceof NativeObjectToken);
        let loc;
        if (t instanceof AllocationSiteToken) {
            if (t.kind === "PromiseResolve" || t.kind === "PromiseReject")
                return; // ignore
            loc = locationToStringWithFileAndEnd(t.allocSite.loc, true);
        } else if (t instanceof FunctionToken)
            loc = locationToStringWithFileAndEnd(t.fun.loc, true);
        else { // NativeObjectToken representing exports objects
            assert(t.moduleInfo);
            loc = `${t.moduleInfo.toString()}:-1:-1:-1:-1`;
        }
        let type;
        if (t instanceof PrototypeToken)
            type = "Prototype";
        else if (t instanceof FunctionToken) {
            if (isClassMethod(t.fun) && t.fun.kind === "constructor")
                type = "Class";
            else
                type = "Function";
        } else if (t instanceof ArrayToken)
            type = "Array";
        else
            type = "Object";
        if (logger.isDebugEnabled())
            logger.debug(`Registering token ${type}[${loc}]`);
        const key = `${loc}:${type}`;
        const q = this.allocToToken.get(key);
        if (q && q !== t)
            logger.error(`Error: token conflict for ${key}: ${q} !== ${t}`);
        this.allocToToken.set(key, t);
    }

    /**
     * Records a dynamic property read operation during analysis.
     */
    recordDynamicRead(node: Node, dstVar: ConstraintVar | undefined) {
        if (!APPROX_READ || !dstVar)
            return;
        this.dynamicReads.push({node, dstVar});
    }

    /**
     * Returns strings for dynamic require hints for the specified location.
     * @param mod module name
     * @param loc location in module
     * @return array of require strings, or undefined if no hints available for that location
     */
    getRequireHints(mod: string | undefined, loc: string): Array<string> | undefined {
        if (mod !== undefined) {
            const i = this.hints.moduleIndex.get(mod);
            if (i !== undefined) {
                const hints = this.hints.requires.get(`${i}:${loc}`);
                if (hints) {
                    const s = hints.map(h => {
                        this.usedHints.add(h);
                        return h.str;
                    });
                    if (logger.isVerboseEnabled())
                        logger.verbose(`Patching dynamic require/import: ${mod}:${loc} <- [${s.join(",")}]`);
                    return s;
                }
            }
        }
        return undefined;
    }

    /**
     * Patches the analysis state using read/write hints.
     */
    patch(solver: Solver) {
        const d = solver.diagnostics.patching!;
        d.totalHints = mapArraySize(this.hints.reads) + mapArraySize(this.hints.writes) + mapArraySize(this.hints.requires) + mapArraySize(this.hints.evals);
        d.modulesNotAnalyzed = 0;
        const mods = new Set(Array.from(solver.globalState.moduleInfos.values()).filter(m => m.loc));
        const fileToModule = this.hints.modules.map(m => {
            const mod = solver.globalState.moduleInfos.get(m);
            if (!mod) {
                if (logger.isVerboseEnabled() || APPROX_DEVEL)
                    logger[APPROX_DEVEL ? "warn" : "verbose"](`Module has been analyzed dynamically but not statically: ${m} (possibly excluded from analysis)`); // TODO: adjust log levels
                d.modulesNotAnalyzed++;
            } else
                mods.delete(mod);
            if (mod && !mod.loc)
                return undefined; // module found but excluded from analysis
            return mod?.toString();
        });
        if (logger.isVerboseEnabled() || APPROX_DEVEL)
            for (const m of mods)
                logger[APPROX_DEVEL ? "warn" : "verbose"](`Module analyzed statically but not dynamically: ${m}`);
        d.modulesNotInHints = mods.size;
        const canonicalizeDynamicLocation = (loc: LocationJSON): string | undefined => {
            const i = loc.indexOf(":");
            if (i === -1)
                assert.fail(`Unable to parse location: ${loc}`);
            const m = fileToModule[parseInt(loc)]; // XXX: use this.hints.modules instead of fileToModule?
            if (m !== undefined)
                return `${m}:${loc.substring(i + 1)}`;
            else
                return undefined; // possibly due to module excluded from analysis
        };
        const visitedFunctions = new Set<string>();
        for (const fun of this.hints.functions) {
            const loc = canonicalizeDynamicLocation(fun);
            if (loc)
                visitedFunctions.add(loc);
        }
        d.functionsNotVisited = 0;
        function checkFunctionVisited(fun: FunctionInfo) {
            if (!visitedFunctions.has(locationToStringWithFileAndEnd(fun.loc, true)) &&
                !fun.isDummyConstructor) {
                if (logger.isVerboseEnabled() || APPROX_DEVEL)
                    logger[APPROX_DEVEL ? "warn" : "verbose"](`Function analyzed statically but not dynamically: ${fun}`);
                d.functionsNotVisited++;
            }
            for (const fun2 of fun.functions)
                checkFunctionVisited(fun2);
        }
        for (const mod of solver.globalState.moduleInfos.values())
            for (const fun of mod.functions)
                checkFunctionVisited(fun);
        const patch = (dstVar: ConstraintVar, valToken: Token, hint: ReadHint | WriteHint): boolean => {
            if (options.diagnostics || options.diagnosticsJson)
                this.usedHints.add(hint); // static analysis handles dynamic accesses with constant strings, so don't count those as added (but still count as used)
            const repVar = solver.fragmentState.getRepresentative(dstVar);
            if (!solver.fragmentState.hasToken(repVar, valToken) &&
                (!APPROX_ONLY_EMPTY || solver.fragmentState.getTokensSize(repVar)[0] === 0)) { // TODO: optionally only patch if exactly one patch token is available for repVar? (may avoid precision losses)
                solver.addToken(valToken!, repVar);
                return true;
            }
            return false;
        }
        if (APPROX_READ) {
            const locationToHints = new Map<string, Array<ReadHint>>();
            for (const hs of this.hints.reads.values())
                for (const hint of hs) {
                    const dl = canonicalizeDynamicLocation(hint.loc);
                    if (dl !== undefined)
                        mapArrayAdd(dl, hint, locationToHints);
                }
            for (const {node, dstVar} of this.dynamicReads) {
                const nodeLoc = locationToStringWithFileAndEnd(node.loc, true);
                const hints = locationToHints.get(nodeLoc);
                if (hints)
                    for (const hint of hints) {
                        const valLoc = canonicalizeDynamicLocation(hint.valLoc);
                        if (valLoc !== undefined) {
                            const valToken = this.allocToToken.get(`${valLoc}:${hint.valType}`);
                            if (!valToken) {
                                if (logger.isVerboseEnabled() || APPROX_DEVEL)
                                    logger[APPROX_DEVEL ? "warn" : "verbose"](`Token not found: ${hint.valType}[${valLoc}] for value at read`);
                                d.tokensNotFound++;
                                continue;
                            }
                            if (logger.isVerboseEnabled())
                                logger.verbose(`Patching dynamic read: ${dstVar} <- ${valToken}`);
                            if (patch(dstVar, valToken, hint)) {
                                d.readTokensAdded++;
                                if (solver.fragmentState.unhandledDynamicPropertyReads.has(node)) {
                                    solver.fragmentState.unhandledDynamicPropertyReads.delete(node);
                                    d.patchedReads++;
                                }
                            }
                        }
                    }
            }
        }
        if (APPROX_WRITE) {
            const nodes = new Map<LocationJSON, Array<Node>>();
            for (const node of solver.fragmentState.unhandledDynamicPropertyWrites.keys()) {
                const nodeLoc = locationToStringWithFileAndEnd(node.loc, true);
                mapArrayAdd(nodeLoc, node, nodes);
            }
            for (const hs of this.hints.writes.values())
                for (const hint of hs) {
                    const baseLoc = hint.baseLoc ? canonicalizeDynamicLocation(hint.baseLoc) : undefined;
                    const valLoc = hint.valLoc ? canonicalizeDynamicLocation(hint.valLoc) : undefined;
                    if (baseLoc !== undefined && valLoc !== undefined) {
                        const baseToken = this.allocToToken.get(`${baseLoc}:${hint.baseType}`);
                        if (!baseToken) {
                            if (logger.isVerboseEnabled() || APPROX_DEVEL)
                                logger[APPROX_DEVEL ? "warn" : "verbose"](`Token not found: ${hint.baseType}[${baseLoc}] for base at write`);
                            d.tokensNotFound++;
                            continue;
                        }
                        const valToken = this.allocToToken.get(`${valLoc}:${hint.valType}`);
                        if (!valToken) {
                            if (logger.isVerboseEnabled() || APPROX_DEVEL)
                                logger[APPROX_DEVEL ? "warn" : "verbose"](`Token not found: ${hint.valType}[${valLoc}] for value at write`);
                            d.tokensNotFound++;
                            continue;
                        }
                        const dstVar = solver.varProducer.objPropVar(baseToken!, hint.prop, hint.type);
                        if (logger.isVerboseEnabled())
                            logger.verbose(`Patching dynamic write: ${dstVar.obj}["${hint.prop}"] <- ${valToken}`);
                        if (patch(dstVar, valToken, hint)) {
                            d.writeTokensAdded++;
                            const hintLoc = canonicalizeDynamicLocation(hint.loc);
                            if (hintLoc) {
                                const ns = nodes.get(hintLoc);
                                if (ns)
                                    for (const node of ns)
                                        if (solver.fragmentState.unhandledDynamicPropertyWrites.has(node)) {
                                            solver.fragmentState.unhandledDynamicPropertyWrites.delete(node);
                                            d.patchedWrites++;
                                        }
                            }
                        }
                    }
                }
        }
        if (options.diagnostics || options.diagnosticsJson) {
            for (const hs of this.hints.reads.values())
                for (const hint of hs)
                    if (!this.usedHints.has(hint)) {
                        const loc = canonicalizeDynamicLocation(hint.loc);
                        const valLoc = canonicalizeDynamicLocation(hint.valLoc);
                        if (loc && valLoc) {
                            if (logger.isVerboseEnabled() || APPROX_DEVEL)
                                logger[APPROX_DEVEL ? "warn" : "verbose"](`Unused read hint: ${loc} <- ${valLoc}:${hint.valType}[${hint.prop ? `"${hint.prop}"` : "?"}]`);
                            d.unusedHints++;
                        }
                    }
            for (const hs of this.hints.writes.values())
                for (const hint of hs)
                    if (!this.usedHints.has(hint)) {
                        const baseLoc = canonicalizeDynamicLocation(hint.baseLoc);
                        const valLoc = canonicalizeDynamicLocation(hint.valLoc);
                        if (baseLoc && valLoc) {
                            if (logger.isVerboseEnabled() || APPROX_DEVEL)
                                logger[APPROX_DEVEL ? "warn" : "verbose"](`Unused write hint: ${baseLoc}:${hint.baseType}["${hint.prop}"] <- ${valLoc}:${hint.valType}`);
                            d.unusedHints++;
                        }
                    }
            for (const hs of this.hints.requires.values())
                for (const hint of hs)
                    if (!this.usedHints.has(hint)) {
                        const loc = canonicalizeDynamicLocation(hint.loc);
                        if (loc) {
                            if (logger.isVerboseEnabled() || APPROX_DEVEL)
                                logger[APPROX_DEVEL ? "warn" : "verbose"](`Unused require hint: ${loc} "${hint.str}"`);
                            d.unusedHints++;
                        }
                    }
            for (const hs of this.hints.evals.values())
                for (const hint of hs)
                    if (!this.usedHints.has(hint)) {
                        const loc = canonicalizeDynamicLocation(hint.loc);
                        if (loc) {
                            if (logger.isVerboseEnabled() || APPROX_DEVEL)
                                logger[APPROX_DEVEL ? "warn" : "verbose"](`Unused eval hint: ${loc} "${hint.str.substring(0, 40).replaceAll("\n", "\u2424")}${hint.str.length > 40 ? "..." : ""}"`);
                            d.unusedHints++;
                        }
                    }
        }
    }

    /**
     * Prints diagnostics.
     */
    printDiagnostics(solver: Solver) {
        const p = solver.diagnostics.patching!;
        logger.info(`Patching tokens added: ${p.readTokensAdded} reads, ${p.writeTokensAdded} writes`);
        logger.info(`Dynamic reads patched: ${p.patchedReads}, remaining unpatched: ${solver.fragmentState.unhandledDynamicPropertyReads.size}`);
        logger.info(`Dynamic writes patched: ${p.patchedWrites}, remaining unpatched: ${solver.fragmentState.unhandledDynamicPropertyWrites.size}`);
        logger.info(`Modules analyzed statically but not dynamically: ${p.modulesNotInHints}, dynamically but not statically: ${p.modulesNotAnalyzed}`);
        logger.info(`Functions analyzed statically but not dynamically: ${p.functionsNotVisited}/${solver.globalState.functionInfos.size}`);
        logger.info(`Tokens not found: ${p.tokensNotFound}`);
        logger.info(`Unused hints: ${p.unusedHints}/${p.totalHints}`);
    }
}