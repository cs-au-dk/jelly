import Solver from "../analysis/solver";
import {options} from "../options";
import {Token} from "../analysis/tokens";
import {addAll} from "../misc/util";
import logger from "../misc/logger";
import {UnknownAccessPath} from "../analysis/accesspaths";

/**
 * Patches empty object property constraint variables that may be affected by dynamic property writes.
 */
export function patchDynamics(solver: Solver): boolean {
    if (!options.patchDynamics)
        return false;
    const f = solver.fragmentState;
    const dyns = new Set<Token>();
    for (const v of f.dynamicPropertyWrites)
        addAll(f.getTokens(f.getRepresentative(v)), dyns);
    // constraint: for all E.p (or E[..]) where ⟦E.p⟧ (or ⟦E[..]⟧) is empty and ⟦E⟧ contains a token that is base of a dynamic property write
    let count = 0;
    const r: typeof f.maybeEmptyPropertyReads = [];
    for (const e of f.maybeEmptyPropertyReads) {
        const {result, base, pck/*, prop*/} = e;
        const bs = f.getTokens(f.getRepresentative(base));
        const [size] = f.getTokensSize(f.getRepresentative(result));
        if (size === 0) {
            let dpw = false;
            for (const t of bs)
                if (dyns.has(t)) {
                    dpw = true; // base has a token that is base of a dynamic property write
                    break;
                }
            if (dpw) {
                if (logger.isDebugEnabled())
                    logger.debug(`Empty object property read ${result} with dynamic write to base object ${base}`);

                // constraint: ...: @Unknown ∈ ⟦E⟧ and k ∈ ⟦E.p⟧ (or ⟦E[..]⟧) where k is the package containing the property read operation
                solver.addAccessPath(UnknownAccessPath.instance, base);
                solver.addTokenConstraint(pck, result); // TODO: omit?

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

                count++;
            } else
                r.push(e); // keep only the property reads that are still empty
        }
    }
    f.maybeEmptyPropertyReads = r;
    if (count > 0) {
        if (logger.isVerboseEnabled())
            logger.verbose(`${count} empty object property read${count === 1 ? "" : "s"} patched`);
        return true;
    } else
        return false;
}
