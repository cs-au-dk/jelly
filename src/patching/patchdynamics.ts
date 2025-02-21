import Solver from "../analysis/solver";
import {AccessPathToken, PackageObjectToken, Token} from "../analysis/tokens";
import {addAll} from "../misc/util";
import logger from "../misc/logger";
import {UnknownAccessPath} from "../analysis/accesspaths";
import {ConstraintVar, isObjectPropertyVarObj} from "../analysis/constraintvars";
import assert from "assert";

export type MaybeEmptyPropertyRead = {base: ConstraintVar} & (
    {typ: "read", result: ConstraintVar, pck: PackageObjectToken, prop: string | undefined} |
    {typ: "call", prop: string}
);

/**
 * Patches empty object property constraint variables that may be affected by dynamic property writes.
 */
export function patchDynamics(solver: Solver): boolean {
    const f = solver.fragmentState;
    const dyns = new Set<Token>();
    for (const v of f.dynamicPropertyWrites)
        addAll(f.getTokens(f.getRepresentative(v)), dyns);
    // constraint: for all E.p (or E[..]) where ⟦E.p⟧ (or ⟦E[..]⟧) is empty and ⟦E⟧ contains a token that is base of a dynamic property write
    const toPatch: typeof f.maybeEmptyPropertyReads = [];
    f.maybeEmptyPropertyReads = f.maybeEmptyPropertyReads.filter(e => {
        const {typ, base} = e;
        const bs = f.getTokens(f.getRepresentative(base));
        if (!Array.from(bs).some(t => dyns.has(t)))
            return true; // base does not contain a token that is base of a dynamic property write

        if (typ === "read") {
            const [size] = f.getTokensSize(f.getRepresentative(e.result));
            if (size > 0) // non-empty property read
                return false;
        } else {
            typ satisfies "call";
            for (const t of bs)
                if (isObjectPropertyVarObj(t)) {
                    const callees = f.varProducer.readResultVar(t, e.prop);
                    const [size] = f.getTokensSize(f.getRepresentative(callees));
                    if (size > 0) // non-empty method call
                        return false;
                } else {
                    assert(t instanceof AccessPathToken);
                    return false; // AP token results in call
                }
        }

        toPatch.push(e);
        return false; // discard reads that will be patched
    });
    // patching is delayed to prevent interference between adding tokens and deciding
    // whether to patch a property read
    for (const e of toPatch) {
        const {typ, base} = e;
        if (logger.isDebugEnabled())
            logger.debug(`Empty ${typ === "read" ? "object property read" : "method set"} with dynamic write to base object in ${base}`);

        // constraint: ...: @Unknown ∈ ⟦E⟧ and k ∈ ⟦E.p⟧ (or ⟦E[..]⟧) where k is the package containing the property read operation
        solver.addAccessPath(UnknownAccessPath.instance, base);
        if (typ === "read")
            solver.addTokenConstraint(e.pck, e.result); // TODO: omit?

        // TODO: enable extra patching for exports properties?
        /*
        // constraint: ...: ⟦%exports[m].p⟧ ⊆ ⟦E⟧ for each module m in the current package or a neighbor package
        if (prop !== undefined)
            for (const p of [pck.packageInfo, ...f.packageNeighbors.get(pck.packageInfo) ?? []]) {
                for (const m of p.modules.values()) {
                    const t = f.a.canonicalizeToken(new NativeObjectToken("exports", m));
                    const v = f.getRepresentative(solver.varProducer.objPropVar(t, prop));
                    if (f.vars.has(v))
                        solver.addSubsetConstraint(v, result);
                }
            }
        */
    }
    const count = toPatch.length;
    if (count > 0) {
        if (logger.isVerboseEnabled())
            logger.verbose(`${count} empty object property read${count === 1 ? "" : "s"} patched, propagating again`);
        return true;
    } else
        return false;
}
