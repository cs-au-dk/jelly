import {writeStdOutIfActive} from "../misc/logger";
import Timer from "../misc/timer";
import assert from "assert";
import {FunctionToken} from "./tokens";
import {RepresentativeVar} from "./fragmentstate";
import {Node} from "@babel/types";
import {FunctionInfo, ModuleInfo} from "./infos";
import {mapGetArray, mapGetMap, mapGetSet} from "../misc/util";
import {ConstraintVar, isObjectPropertyVarObj, ObjectPropertyVar, ObjectPropertyVarObj} from "./constraintvars";
import Solver from "./solver";

/**
 * Collects final call edges.
 */
export function finalizeCallEdges(solver: Solver) {
    writeStdOutIfActive("Finalizing...");
    const finalTimer = new Timer;
    const f = solver.fragmentState;
    const a = solver.globalState;
    const d = solver.diagnostics;

    // ordinary calls
    if (d.aborted || d.timeout || d.waveLimitReached > 0 || d.indirectionsLimitReached > 0) {
        for (const n of f.callLocations) {
            const caller = f.callToContainingFunction.get(n);
            assert(caller);
            const vs = f.callToCalleeVars.get(n);
            if (vs)
                for (const v of vs) {
                    const vRep = f.getRepresentative(v);
                    for (const t of f.getTokens(vRep))
                        if (t instanceof FunctionToken)
                            f.registerCallEdge(n, caller, a.functionInfos.get(t.fun)!);
                }
        }
    }

    // getter calls
    const pm = new Map<RepresentativeVar, Map<string, Array<[Node, FunctionInfo | ModuleInfo]>>>();
    for (const {base, prop, node, encl} of f.propertyReads)
        mapGetArray(mapGetMap(pm, f.getRepresentative(base)), prop).push([node, encl]);
    const tm = new Map<ObjectPropertyVarObj, Set<Map<string, Array<[Node, FunctionInfo | ModuleInfo]>>>>();
    for (const [base, ms] of pm)
        for (const t1 of f.getTokens(base)) {
            if (isObjectPropertyVarObj(t1)) {
                mapGetSet(tm, t1).add(ms);
                for (const t2 of f.getTokens(f.getRepresentative(f.varProducer.ancestorsVar(t1))))
                    if (isObjectPropertyVarObj(t2))
                        mapGetSet(tm, t2).add(ms);
            }
        }
    const getters = new Map<ObjectPropertyVarObj, Map<string, ConstraintVar>>();
    const collectGetters = (v: ConstraintVar) => {
        if (v instanceof ObjectPropertyVar && v.accessor === "get")
            mapGetMap(getters, v.obj).set(v.prop, v);
    };
    for (const v of f.vars)
        collectGetters(v);
    for (const v of f.redirections.keys())
        collectGetters(v);
    for (const [t, qs] of tm)
        for (const ms of qs) {
            const gs = getters.get(t);
            if (gs)
                for (const [prop, targets] of ms) {
                    const v = gs.get(prop);
                    if (v) {
                        const ts = f.getTokens(f.getRepresentative(v));
                        for (const t3 of ts)
                            if (t3 instanceof FunctionToken && t3.fun.params.length === 0)
                                for (const [node, enclosing] of targets) {
                                    f.registerCall(node, enclosing, undefined, {accessor: true});
                                    f.registerCallEdge(node, enclosing, a.functionInfos.get(t3.fun)!, {accessor: true});
                                }
                    }
                }
        }

    solver.diagnostics.finalizationTime = finalTimer.elapsed();
}