import Solver from "./solver";
import {ObjectToken, PackageObjectToken, Token} from "./tokens";
import logger from "../misc/logger";
import {AncestorsVar, ConstraintVar, ObjectPropertyVar, ReadResultVar} from "./constraintvars";
import {addAll, getOrSet, mapGetMap} from "../misc/util";
import Timer, {nanoToMs} from "../misc/timer";
import {CallResultAccessPath, ComponentAccessPath, PropertyAccessPath} from "./accesspaths";
import assert from "assert";

// TODO: OK to assume that all tokens in widened belong to the current fragment?
// TODO: measure effect of widening...

/**
 * Widens the selected objects from allocation-site to package abstraction.
 * This roughly takes time proportional to the size of the information stored for the constraint variables and tokens.
 */
export function widenObjects(widened: Set<ObjectToken>, solver: Solver) {
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
        tokenMap.set(t, a.canonicalizeToken(new PackageObjectToken(t.getPackageInfo())));

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

    function widenTokenMapArrayValues<K>(m: Map<K, Array<Token> | Token>): [Map<K, Array<Token> | Token>, number] {
        const res: Map<K, Array<Token> | Token> = new Map;
        let size = 0;
        for (const [v, ts] of m) {
            if (ts instanceof Token) {
                const s = widenToken(ts);
                res.set(v, s);
                size += 1;
            } else {
                const s = widenTokenSet(ts);
                res.set(v, Array.from(s));
                size += s.size;
            }
        }
        return [res, size];
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

    const varMap: Map<ObjectPropertyVar | AncestorsVar, ObjectPropertyVar | AncestorsVar> = new Map; // cache for widenVar

    /**
     * Returns the widened version of the given constraint variable, or the constraint variable itself if it is not being widened.
     */
    function widenVar(v: ConstraintVar): ConstraintVar {
        if (v instanceof ObjectPropertyVar && v.obj instanceof ObjectToken && widened.has(v.obj)) {
            const vobj = v.obj;
            return getOrSet(varMap, v, () => f.varProducer.packagePropVar(vobj.getPackageInfo(), v.prop, v.accessor));
        } else if (v instanceof AncestorsVar && v.t instanceof ObjectToken && widened.has(v.t))
            return getOrSet(varMap, v, () => f.varProducer.ancestorsVar(v.t));
        else if (v instanceof ReadResultVar && v.t instanceof ObjectToken && widened.has(v.t))
            return getOrSet(varMap, v, () => f.varProducer.readResultVar(v.t, v.prop));
        else
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
    [solver.unprocessedTokens, solver.diagnostics.unprocessedTokensSize] = widenTokenMapArrayValues(solver.unprocessedTokens);
    assert(solver.nodesWithNewEdges.size === 0);
    solver.replaceTokens(tokenMap);

    // remove token listeners that use widened tokens as keys
    for (const [_, ls] of f.tokenListeners)
        for (const [id, _] of ls) {
            const {t} = solver.listeners.get(id)!;
            if (t instanceof ObjectToken && widened.has(t)) {
                // this looks suspicious, but all listeners that use widened tokens as keys
                // will get re-added after tokens are replaced and listeners are re-run.
                // i.e. our uses of listeners that are parameterized by tokens are enclosed
                // in a forall constraint that binds the parameterizing token.
                // if this changes we might have to re-add them directly here
                ls.delete(id);
                // solver.addForAllTokensConstraint(v, l, {t: tokenMap.get(t)!, ...rest}, listener);
            }
        }

    f.objectPropertiesListeners = widenTokenMapMapKeys(f.objectPropertiesListeners);
    // transfer object properties from widened objects
    for (const [t, pt] of tokenMap) {
        const props = f.objectProperties.get(t);
        if (props !== undefined) {
            f.objectProperties.delete(t);
            for (const prop of props)
                solver.addObjectProperty(pt, prop);
        }
    }

    // update the constraint variables
    for (const v of [...f.vars, ...f.redirections.keys()]) {
        const vRep = f.getRepresentative(v);
        const wRep = f.getRepresentative(widenVar(v));
        solver.addSubsetEdge(vRep, wRep); // ensures that tokens get transferred at redirect
        solver.redirect(vRep, wRep);
    }
    f.dynamicPropertyWrites = widenVarSet(f.dynamicPropertyWrites);
    for (const e of f.propertyReads)
        e.base = widenVar(e.base);
    for (const e of f.maybeEmptyPropertyReads) {
        if ("result" in e)
            e.result = widenVar(e.result);
        e.base = widenVar(e.base);
    }
    for (const e of f.maybeEmptyMethodCalls.values()) {
        e.baseVar = widenVar(e.baseVar);
        e.calleeVar = widenVar(e.calleeVar);
        for (let i = 0; i < e.argVars.length; i++) {
            const a = e.argVars[i];
            if (a)
                e.argVars[i] = widenVar(a);
        }
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
    solver.diagnostics.totalWideningTime += ms;
    if (logger.isVerboseEnabled())
        logger.verbose(`Widening completed in ${nanoToMs(ms)}`);
}
