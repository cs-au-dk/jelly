import {ReadHint, HintsJSON, WriteHint, RequireHint, EvalHint} from "../typings/hints";
import {getOrSet, LocationJSON, mapArrayAddNoDuplicates} from "../misc/util";
import {APPROX_READ, APPROX_WRITE} from "./patching";

export class Hints {

    /**
     * Names of modules (including eval code) that have been executed dynamically.
     */
    readonly modules: Array<string> = [];

    /**
     * Map from module name to index in LocationJSON strings.
     */
    readonly moduleIndex = new Map<string, number>();

    /**
     * Functions that have been visited (either via module execution or by forced execution).
     */
    readonly functions = new Set<LocationJSON>();

    /**
     * Read hints grouped by location of the read operation.
     */
    readonly reads = new Map<LocationJSON, Array<ReadHint>>();

    /**
     * Write hints grouped by location of the write operation.
     */
    readonly writes = new Map<LocationJSON, Array<WriteHint>>();

    /**
     * Require/import hints grouped by location of the require/import operation.
     */
    readonly requires = new Map<LocationJSON, Array<RequireHint>>();

    /**
     * Eval/Function hints grouped by the location of the eval/Function operation.
     */
    readonly evals = new Map<LocationJSON, Array<EvalHint>>();

    addModule(m: string): number {
        return getOrSet(this.moduleIndex, m, () => {
            this.modules.push(m);
            return this.modules.length - 1;
        })
    }

    addFunction(f: LocationJSON) {
        this.functions.add(f);
    }

    addReadHint(h: ReadHint) {
        if (APPROX_READ)
            mapArrayAddNoDuplicates(h.loc, h, this.reads, (v1: ReadHint, v2: ReadHint) =>
                v1.prop === v2.prop && v1.valLoc === v2.valLoc && v1.valType === v2.valType
            );
    }

    addWriteHint(h: WriteHint) {
        if (APPROX_WRITE)
            mapArrayAddNoDuplicates(h.loc, h, this.writes, (v1: WriteHint, v2: WriteHint) =>
                v1.type === v2.type && v1.baseLoc === v2.baseLoc && v1.baseType === v2.baseType &&
                v1.prop === v2.prop && v1.valLoc === v2.valLoc && v1.valType === v2.valType
            );
    }

    addRequireHint(h: RequireHint) {
        mapArrayAddNoDuplicates(h.loc, h, this.requires, (v1: RequireHint, v2: RequireHint) =>
            v1.str === v2.str
        );
    }

    addEvalHint(h: EvalHint) {
        mapArrayAddNoDuplicates(h.loc, h, this.evals, (v1: EvalHint, v2: EvalHint) =>
            v1.str === v2.str
        );
    }

    toJSON(): HintsJSON {
        return {
            modules: this.modules,
            functions: Array.from(this.functions),
            reads: Array.from(this.reads.values()).flat(),
            writes: Array.from(this.writes.values()).flat(),
            requires: Array.from(this.requires.values()).flat(),
            evals: Array.from(this.evals.values()).flat()
        }
    }

    clearHints() {
        this.reads.clear();
        this.writes.clear();
        this.requires.clear();
        this.evals.clear();
    }
}