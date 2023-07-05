import Solver from "./solver";
import {ObjectToken, PackageObjectToken, Token} from "./tokens";
import logger from "../misc/logger";
import {ConstraintVar, ObjectPropertyVar} from "./constraintvars";
import {addAll, getOrSet, mapGetMap, mapGetSet} from "../misc/util";
import {ModuleInfo} from "./infos";
import Timer from "../misc/timer";
import {CallResultAccessPath, ComponentAccessPath, PropertyAccessPath} from "./accesspaths";
import assert from "assert";

// TODO: OK to assume that all tokens in widened belong to the current fragment?
// TODO: measure effect of widening...

/**
 * Widens the selected objects from allocation-site to package abstraction.
 * This roughly takes time proportional to the size of the information stored for the constraint variables and tokens.
 */
export function widenObjects(m: ModuleInfo, widened: Set<ObjectToken>, solver: Solver) {
    const a = solver.globalState;
    const f = solver.fragmentState;
    if (logger.isVerboseEnabled())
        logger.verbose(`Widening (constraint vars: ${f.getNumberOfVarsWithTokens()}, widened tokens: ${widened.size})`);
    if (logger.isDebugEnabled())
        for (const t of widened)
            logger.debug(`Widening ${t}`);
    if (widened.size === 0)
        return;
    addAll(widened, f.widened);
    const timer = new Timer;

    const tokenMap: Map<ObjectToken, PackageObjectToken> = new Map;
    for (const t of widened)
        tokenMap.set(t, a.canonicalizeToken(new PackageObjectToken(t.packageInfo)));

    /**
     * Returns the widened version of the given token, or the given token itself if it is not being widened.
     */
    function widenToken<T extends Token>(t: T): T | PackageObjectToken {
        return (t instanceof ObjectToken && tokenMap.get(t)) || t;
    }

    function widenTokenSet<T extends Token>(ts: Iterable<T>): Set<T | PackageObjectToken> {
        const res: Set<T | PackageObjectToken> = new Set;
        for (const t of ts)
            res.add(widenToken(t));
        return res;
    }

    function widenTokenMapArrayValues<K>(m: Map<K, Array<Token>>): [Map<K, Array<Token>>, number] {
        const res: Map<K, Array<Token>> = new Map;
        let size = 0;
        for (const [v, ts] of m) {
            const s = widenTokenSet(ts);
            res.set(v, Array.from(s));
            size += s.size;
        }
        return [res, size];
    }

    function widenTokenMapSetKeys<T extends Token, V>(m: Map<T, Set<V>>): Map<T | PackageObjectToken, Set<V>> {
        const res: Map<T | PackageObjectToken, Set<V>> = new Map;
        for (const [t, vs] of m)
            addAll(vs, mapGetSet(res, widenToken(t)));
        return res;
    }

    function widenTokenMapSetKeysValues(m: Map<Token, Set<Token>>): Map<Token, Set<Token>> {
        const res: Map<Token, Set<Token>> = new Map;
        for (const [v, qs] of m) {
            const ws = mapGetSet(res, widenToken(v));
            for (const q of qs)
                ws.add(widenToken(q));
        }
        return res;
    }

    function widenTokenMapMapKeys<T extends Token, K, V>(m: Map<T, Map<K, V>>): Map<T | PackageObjectToken, Map<K, V>> {
        const res: Map<T | PackageObjectToken, Map<K, V>> = new Map;
        for (const [t, m2] of m) {
            const rm = mapGetMap(res, widenToken(t));
            for (const [k, v] of m2)
                rm.set(k, v); // possibly overriding existing different value, but should be a listener function with same behavior
        }
        return res;
    }

    const varMap: Map<ObjectPropertyVar, ObjectPropertyVar> = new Map; // cache for widenVar

    /**
     * Returns the widened version of the given constraint variable, or the constraint variable itself if it is not being widened.
     */
    function widenVar(v: ConstraintVar): ConstraintVar {
        if (v instanceof ObjectPropertyVar && v.obj instanceof ObjectToken && widened.has(v.obj)) {
            const vobj = v.obj;
            return getOrSet(varMap, v, () => f.varProducer.packagePropVar(vobj.packageInfo, v.prop, v.accessor));
        } else
            return v;
    }

    function widenVarSet(s: Set<ConstraintVar>): Set<ConstraintVar> {
        const res: Set<ConstraintVar> = new Set;
        for (const v of s)
            res.add(widenVar(v));
        return res;
    }

    function widenPropertyAccessPath(ap: PropertyAccessPath): PropertyAccessPath {
        const w = widenVar(ap.base);
        if (w === ap.base)
            return ap;
        return a.canonicalizeAccessPath(new PropertyAccessPath(w, ap.prop));
    }

    function widenCallResultAccessPath(ap: CallResultAccessPath): CallResultAccessPath {
        const w = widenVar(ap.caller);
        if (w === ap.caller)
            return ap;
        return a.canonicalizeAccessPath(new CallResultAccessPath(w));
    }

    function widenComponentAccessPath(ap: ComponentAccessPath): ComponentAccessPath {
        const w = widenVar(ap.component);
        if (w === ap.component)
            return ap;
        return a.canonicalizeAccessPath(new ComponentAccessPath(w));
    }

    // update the tokens
   [solver.unprocessedTokens, solver.unprocessedTokensSize] = widenTokenMapArrayValues(solver.unprocessedTokens);
    assert(solver.nodesWithNewEdges.size === 0);
    solver.replaceTokens(tokenMap);
    f.inherits = widenTokenMapSetKeysValues(f.inherits);
    f.reverseInherits = widenTokenMapSetKeysValues(f.reverseInherits);
    f.ancestorListeners = widenTokenMapMapKeys(f.ancestorListeners); // FIXME: if a token gets a new ancestor because of widening, ancestor listeners may need to be invoked?
    f.objectPropertiesListeners = widenTokenMapMapKeys(f.objectPropertiesListeners); // FIXME: if an ObjectPropertyVarObj token gets a new property because of widening, object properties listeners may need to be invoked?
    f.objectProperties = widenTokenMapSetKeys(f.objectProperties);

    // update the constraint variables
    for (const v of f.vars) {
        const rep = f.getRepresentative(widenVar(v));
        solver.addSubsetEdge(v, rep); // ensures that tokens get transferred at redirect
        solver.redirect(v, rep);
    }
    f.dynamicPropertyWrites = widenVarSet(f.dynamicPropertyWrites);
    for (const e of f.maybeEmptyPropertyReads) {
        e.result = widenVar(e.result);
        e.base = widenVar(e.base);
    }
    for (const e of f.unhandledDynamicPropertyWrites.values())
        e.src = widenVar(e.src);
    for (const m of [f.propertyReadAccessPaths, f.propertyWriteAccessPaths])
        for (const m1 of m.values())
            for (const m2 of m1.values())
                for (const e of m2.values()) {
                    e.sub = widenVar(e.sub);
                    e.bp = widenPropertyAccessPath(e.bp);
                }
    for (const m of f.callResultAccessPaths.values())
        for (const e of m.values()) {
            e.sub = widenVar(e.sub);
            e.bp = widenCallResultAccessPath(e.bp);
        }
    for (const m of f.componentAccessPaths.values())
        for (const e of m.values()) {
            e.sub = widenVar(e.sub);
            e.bp = widenComponentAccessPath(e.bp);
        }

    const ms = timer.elapsed();
    solver.totalWideningTime += ms;
    if (logger.isVerboseEnabled())
        logger.verbose(`Widening completed in ${ms}ms`);
}
