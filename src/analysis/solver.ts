import {ConstraintVar, IntermediateVar, NodeVar, ObjectPropertyVarObj} from "./constraintvars";
import logger, {isTTY, writeStdOut} from "../misc/logger";
import {AccessPathToken, AllocationSiteToken, ArrayToken, FunctionToken, ObjectToken, PackageObjectToken, Token} from "./tokens";
import {GlobalState} from "./globalstate";
import {PackageInfo} from "./infos";
import {
    addAll,
    addAllMapHybridSet,
    isArrayIndex,
    Location,
    locationToStringWithFileAndEnd,
    mapArrayPushAll,
    mapGetArray,
    mapGetMap,
    mapGetSet,
    mapMapMapSetAll,
    mapMapSetAll,
    mapMapSize,
    mapSetAddAll,
    nodeToString,
    setAll,
    strHash
} from "../misc/util";
import assert from "assert";
import {AccessPath, CallResultAccessPath, ComponentAccessPath, IgnoredAccessPath, ModuleAccessPath, PropertyAccessPath, UnknownAccessPath} from "./accesspaths";
import {isAssignmentExpression, Node} from "@babel/types";
import {FragmentState, ListenerID, MergeRepresentativeVar, RepresentativeVar} from "./fragmentstate";
import {TokenListener} from "./listeners";
import {nuutila} from "../misc/scc";
import {options, patternProperties} from "../options";
import Timer from "../misc/timer";
import {setImmediate} from "timers/promises";
import {getMemoryUsage} from "../misc/memory";
import {JELLY_NODE_ID} from "../parsing/extras";
import AnalysisDiagnostics from "./diagnostics";
import {ARRAY_UNKNOWN} from "../natives/ecmascript";

export class AbortedException extends Error {}

export default class Solver {

    readonly globalState: GlobalState = new GlobalState;

    fragmentState: FragmentState = new FragmentState(this);

    get varProducer() {
        return this.fragmentState.varProducer;
    }

    unprocessedTokens: Map<RepresentativeVar, Array<Token>> = new Map;

    nodesWithNewEdges: Set<ConstraintVar> = new Set;

    restored: Set<ConstraintVar> = new Set;

    readonly listeners: Map<ListenerID, [TokenListener, Node | Token]> = new Map;

    diagnostics = new AnalysisDiagnostics;

    readonly abort?: () => boolean;

    fixpointIterationsThrottled: number = 0;

    constructor(abort?: () => boolean) {
        this.abort = abort;
    }

    updateDiagnostics() {
        const a = this.globalState;
        const f = this.fragmentState;
        const d = this.diagnostics;
        d.functions = a.functionInfos.size;
        d.vars = f.getNumberOfVarsWithTokens();
        d.listeners = [
            f.tokenListeners, f.pairListeners1, f.pairListeners2, f.packageNeighborListeners,
            f.ancestorListeners, f.arrayEntriesListeners, f.objectPropertiesListeners,
        ].reduce((acc, l: Map<Object, Map<Object, Object>>) => acc + mapMapSize(l), 0);
        d.tokens = f.numberOfTokens;
        d.subsetEdges = f.numberOfSubsetEdges;
        d.functionToFunctionEdges = f.numberOfFunctionToFunctionEdges;
        d.callToFunctionEdges = f.numberOfCallToFunctionEdges;
        d.uniqueTokens = a.canonicalTokens.size;
        d.maxMemoryUsage = Math.max(d.maxMemoryUsage, getMemoryUsage());
    }

    /**
     * Adds a single token constraint.
     */
    addTokenConstraint(t: Token, to: ConstraintVar | undefined) {
        if (to === undefined)
            return;
        if (logger.isDebugEnabled()) // (avoid building message string if not needed)
            logger.debug(`Adding constraint ${t} \u2208 ${to}`);
        this.addToken(t, this.fragmentState.getRepresentative(to));
    }

    /**
     * Enqueues a listener call consisting of a listener and its argument(s).
     */
    private enqueueListenerCall(la: [(t: Token) => void, Token]
        | [(t1: AllocationSiteToken, t2: FunctionToken | AccessPathToken) => void, [AllocationSiteToken, FunctionToken | AccessPathToken]]
        | [(neighbor: PackageInfo) => void, PackageInfo]
        | [(prop: string) => void, string]) {
        this.fragmentState.postponedListenerCalls.push(la);
    }

    /**
     * Adds a single token if not already present.
     * Also enqueues notification of listeners and registers object properties and array entries from the constraint variable.
     */
    addToken(t: Token, toRep: RepresentativeVar): boolean {
        const f = this.fragmentState;
        if (f.addToken(t, toRep)) {
            if (logger.isVerboseEnabled())
                assert(!f.redirections.has(toRep));
            f.vars.add(toRep);
            this.tokenAdded(toRep, t);
            return true;
        }
        return false;
    }

    /**
     * Adds a set of tokens if not already present.
     * By default also adds to worklist and notifies listeners.
     */
    private addTokens(ts: Iterable<Token>, toRep: RepresentativeVar, propagate: boolean = true) {
        const f = this.fragmentState;
        f.vars.add(toRep);
        let ws: Array<Token> | undefined = undefined;
        for (const t of f.addTokens(ts, toRep)) {
            if (propagate)
                ws = this.tokenAdded(toRep, t, ws);
        }
    }

    /**
     * Replaces all tokens according to the given map.
     * Also triggers token listeners for newly added tokens.
     */
    replaceTokens(m: Map<ObjectToken, PackageObjectToken>) {
        const f = this.fragmentState;
        for (const [v, ts, size] of f.getAllVarsAndTokens()) {
            const r = new Set<Token>();
            let any = false;
            let ws: Array<Token> | undefined = undefined;
            for (const t of ts) {
                const q = t instanceof ObjectToken && m.get(t);
                if (q) {
                    if (!(Array.isArray(ts) ? ts.includes(q) : ts.has(q)) && !r.has(q))
                        ws = this.tokenAdded(v, q, ws);
                    r.add(q);
                    any = true;
                } else
                    r.add(t);
            }
            if (any)
                f.replaceTokens(v, r, size);
        }
    }

    private tokenAdded(toRep: ConstraintVar, t: Token, ws?: Array<Token>): Array<Token> | undefined {
        if (logger.isDebugEnabled())
            logger.debug(`Added token ${t} to ${toRep}`);
        // add to worklist
        (ws ??= mapGetArray(this.unprocessedTokens, toRep)).push(t);
        this.diagnostics.unprocessedTokensSize++;
        if (this.diagnostics.unprocessedTokensSize % 100 === 0)
            this.printDiagnostics();
        return ws;
    }

    /**
     * Adds an access path token if not already present (and not at an AssignmentExpression).
     * Also collects information for PatternMatcher about where access paths are created.
     * @param ap    the access path to add
     * @param to    the AST node (constraint variable) where to add the token (if not an AssignmentExpression)
     * @param subap access path of the sub-expression (for call or property access expressions)
     */
    addAccessPath(ap: AccessPath, to: ConstraintVar | undefined, subap?: AccessPath) { // TODO: store access paths separately from other tokens?
        if (!to)
            return;
        const abstractProp = ap instanceof PropertyAccessPath && !(subap instanceof ModuleAccessPath && ap.prop === "default") && patternProperties && !patternProperties.has(ap.prop);
        const ap2 = this.globalState.canonicalizeAccessPath(subap instanceof IgnoredAccessPath || (subap instanceof UnknownAccessPath && (ap instanceof CallResultAccessPath || ap instanceof ComponentAccessPath || abstractProp)) ? subap :
            abstractProp ? new PropertyAccessPath((ap as PropertyAccessPath).base, "?") : ap); // abstracting irrelevant access paths
        if (logger.isDebugEnabled())
            logger.debug(`Adding access path ${ap2}${ap2 !== ap ? ` (${ap})` : ""} at ${to}${subap ? ` (sub-expression access path: ${subap})` : ""}`);
        const f = this.fragmentState;
        const asn = to instanceof NodeVar && isAssignmentExpression(to.node);
        if (!asn)
            this.addToken(f.a.canonicalizeToken(new AccessPathToken(ap2)), f.getRepresentative(to));
        // collect information for PatternMatcher
        const t = to instanceof IntermediateVar && to.label === "import" ? to.node : to instanceof NodeVar ? to.node : undefined; // special treatment of 'import' expressions
        if (t !== undefined) {
            if (ap2 instanceof ModuleAccessPath)
                mapGetSet(f.moduleAccessPaths, ap2).add(t);
            else if (ap2 instanceof PropertyAccessPath)
                mapGetMap(mapGetMap(asn ? f.propertyWriteAccessPaths : f.propertyReadAccessPaths, subap!), ap2.prop).set(t, {bp: ap2, sub: ap2.base});
            else if (ap2 instanceof CallResultAccessPath)
                mapGetMap(f.callResultAccessPaths, subap!).set(t, {bp: ap2, sub: ap2.caller});
            else if (ap2 instanceof ComponentAccessPath)
                mapGetMap(f.componentAccessPaths, subap!).set(t, {bp: ap2, sub: ap2.component});
            else if (!(ap2 instanceof UnknownAccessPath || ap2 instanceof IgnoredAccessPath))
                assert.fail("Unexpected AccessPath");
        }
    }

    /**
     * Reports diagnostics periodically (only if print progress is enabled, stdout is tty, and log level is "info").
     */
    private printDiagnostics() {
        if (options.printProgress && options.tty && isTTY && logger.level === "info") {
            const d = new Date().getTime();
            if (d > this.diagnostics.lastPrintDiagnosticsTime + 100) { // only report every 100ms
                this.diagnostics.lastPrintDiagnosticsTime = d;
                const a = this.globalState;
                const f = this.fragmentState;
                writeStdOut(`Packages: ${a.packageInfos.size}, modules: ${a.moduleInfos.size}, call edges: ${f.numberOfFunctionToFunctionEdges}, ` +
                    (options.diagnostics ? `vars: ${f.getNumberOfVarsWithTokens()}, tokens: ${f.numberOfTokens}, subsets: ${f.numberOfSubsetEdges}, round: ${this.diagnostics.fixpointRound}, ` : "") +
                    `iterations: ${this.diagnostics.iterations}, worklist: ${this.diagnostics.unprocessedTokensSize}` +
                    (options.diagnostics ? `, listeners: ${f.postponedListenerCalls.length}` : ""));
                f.a.timeoutTimer.checkTimeout();
            }
        }
    }

    /**
     * Adds a subset constraint.
     */
    addSubsetConstraint(from: ConstraintVar | undefined, to: ConstraintVar | undefined) {
        if (from === undefined || to === undefined)
            return;
        if (logger.isDebugEnabled())
            logger.debug(`Adding constraint ${from} \u2286 ${to}`);
        const f = this.fragmentState;
        this.addSubsetEdge(f.getRepresentative(from), f.getRepresentative(to));
    }

    addSubsetEdge(fromRep: RepresentativeVar, toRep: RepresentativeVar, propagate: boolean = true) {
        if (fromRep !== toRep) {
            const f = this.fragmentState;
            const s = mapGetSet(f.subsetEdges, fromRep);
            if (!s.has(toRep)) {
                // add the edge
                s.add(toRep);
                f.numberOfSubsetEdges++;
                mapGetSet(f.reverseSubsetEdges, toRep).add(fromRep);
                if (logger.isVerboseEnabled())
                    assert(!f.redirections.has(fromRep) && !f.redirections.has(toRep));
                f.vars.add(fromRep);
                f.vars.add(toRep);
                if (propagate) {
                    // propagate tokens
                    const [size, ts] = this.fragmentState.getTokensSize(fromRep);
                    if (size > 0) {
                        if (logger.isDebugEnabled())
                            logger.debug(`Worklist size: ${this.diagnostics.unprocessedTokensSize}, propagating ${size} token${size !== 1 ? "s" : ""} from ${fromRep}`);
                        this.addTokens(ts, toRep);
                        this.incrementIterations();
                    }
                    this.nodesWithNewEdges.add(fromRep);
                }
            }
        }
    }

    /**
     * Provides a unique'ish ID for the given node.
     */
    private getNodeHash(n: Node): bigint {
        const nid = (n as any)[JELLY_NODE_ID];
        assert(nid !== undefined);
        let id = (BigInt(nid) << 32n);
        const h = n.loc && (n.loc as Location).module?.hash;
        if (h)
            id += BigInt(h);
        return id;
    }

    /**
     * Provides a unique'ish ID for the given key and node or token.
     */
    private getListenerID(key: TokenListener, n: Node | Token): ListenerID {
        let id = (BigInt(key) << 16n);
        if (n instanceof Token) {
            assert(n.hash !== undefined);
            id += BigInt(n.hash);
        } else
            id += this.getNodeHash(n);
        const x = this.listeners.get(id);
        if (x) {
            const [xk, xn] = x;
            if (xk !== key || xn !== n)
                logger.error("Error: Hash collision in getListenerID"); // TODO: hash collision possible
        } else
            this.listeners.set(id, [key, n]);
        return id;
    }

    /**
     * Provides a unique'ish ID for the given token and node.
     */
    private getAncestorListenerID(t: Token, n: Node): ListenerID {
        assert(t.hash !== undefined);
        return BigInt(t.hash) + this.getNodeHash(n); // TODO: hash collision possible
    }

    /**
     * Adds a universally quantified constraint for a constraint variable.
     * The pair of the key and the node or token must together uniquely determine the function (including its free variables).
     */
    addForAllTokensConstraint(v: ConstraintVar | undefined, key: TokenListener, n: Node | Token, listener: (t: Token) => void) {
        if (v === undefined)
            return;
        const f = this.fragmentState;
        const vRep = f.getRepresentative(v);
        if (logger.isDebugEnabled())
            logger.debug(`Adding universally quantified constraint #${TokenListener[key]} to ${vRep} at ${n instanceof Token ? n : locationToStringWithFileAndEnd(n.loc)}`);
        const m = mapGetMap(f.tokenListeners, vRep);
        const id = this.getListenerID(key, n);
        if (!m.has(id)) {
            // run listener on all existing tokens
            for (const t of f.getTokens(vRep))
                this.callTokenListener(id, listener, t);
            // register listener for future tokens
            m.set(id, listener);
        }
        f.vars.add(vRep);
    }

    /**
     * Adds a universally quantified constraint for a pair of constraint variables.
     * Only allocation site tokens are considered for the first constraint variable, and only function tokens are considered for the second constraint variable.
     * The triple of the key, node and string must uniquely determine the function (including its free variables).
     */
    addForAllTokenPairsConstraint(v1: ConstraintVar | undefined, v2: ConstraintVar | undefined, key: TokenListener, n: Node, extra: string, listener: (t1: AllocationSiteToken, t2: FunctionToken | AccessPathToken) => void) {
        if (v1 === undefined || v2 === undefined)
            return;
        assert(key !== undefined);
        const f = this.fragmentState;
        const v1Rep = f.getRepresentative(v1);
        const v2Rep = f.getRepresentative(v2);
        if (logger.isDebugEnabled())
            logger.debug(`Adding universally quantified pair constraint #${TokenListener[key]}${extra ? ` ${extra}` : ""} to (${v1Rep}, ${v2Rep}) at ${locationToStringWithFileAndEnd(n.loc)}`);
        const m1 = mapGetMap(f.pairListeners1, v1Rep);
        const id = this.getListenerID(key, n) ^ BigInt(strHash(extra));  // TODO: hash collision possible
        if (!m1.has(id)) {
            // run listener on all existing tokens
            const funs: Array<FunctionToken | AccessPathToken> = [];
            for (const t2 of f.getTokens(v2Rep))
                if (t2 instanceof FunctionToken || t2 instanceof AccessPathToken)
                    funs.push(t2);
            for (const t1 of f.getTokens(v1Rep))
                if (t1 instanceof AllocationSiteToken)
                    for (const t2 of funs)
                        this.callTokenPairListener(id, listener, t1, t2);
            // register listener for future tokens
            m1.set(id, [v2Rep, listener]);
            mapGetMap(f.pairListeners2, v2Rep).set(id, [v1Rep, listener]);
        }
        f.vars.add(v1Rep);
        f.vars.add(v2Rep);
    }

    /**
     * Enqueues a call to a token listener if it hasn't been done before.
     */
    private callTokenListener(id: ListenerID, listener: (t: Token) => void, t: Token) {
        const s = mapGetSet(this.fragmentState.listenersProcessed, id);
        if (!s.has(t)) {
            s.add(t);
            this.enqueueListenerCall([listener, t]);
            this.diagnostics.tokenListenerNotifications++;
        }
    }

    /**
     * Enqueues a call to a token pair listener if it hasn't been done before.
     */
    private callTokenPairListener(id: ListenerID, listener: (t1: AllocationSiteToken, t2: FunctionToken | AccessPathToken) => void, t1: AllocationSiteToken, t2: FunctionToken | AccessPathToken) {
        assert(t1.hash !== undefined && t2.hash !== undefined);
        const x = (BigInt(t1.hash) << 32n) + BigInt(t2.hash);
        const s = mapGetSet(this.fragmentState.listenersProcessed, id);
        if (!s.has(x)) {
            s.add(x);
            this.enqueueListenerCall([listener, [t1, t2]]);
            this.diagnostics.pairListenerNotifications++;
        }
    }

    /**
     * Adds a quantified constraint for all neighbors of the given package.
     * The pair of the PackageInfo and the node must uniquely determine the function (including its free variables).
     */
    addForAllPackageNeighborsConstraint(k: PackageInfo, n: Node, listener: (neighbor: PackageInfo) => void) {
        if (logger.isDebugEnabled())
            logger.debug(`Adding package neighbor constraint to ${k}`);
        const m = this.runPackageNeighborsListener(k, n, listener);
        if (m) {
            // register listener for future neighbors
            m.set(n, listener);
        }
    }

    /**
     * Runs package neighbors listener on all existing neighbors if new.
     * Returns listener map if new.
     */
    private runPackageNeighborsListener(k: PackageInfo, n: Node, listener: (neighbor: PackageInfo) => void): Map<Node, (neighbor: PackageInfo) => void> | false {
        const f = this.fragmentState;
        const m = mapGetMap(f.packageNeighborListeners, k);
        if (!m.has(n)) {
            const qs = f.packageNeighbors.get(k);
            if (qs)
                for (const q of qs) {
                    this.enqueueListenerCall([listener, q]);
                    this.diagnostics.packageNeighborListenerNotifications++;
                }
            return m;
        } else
            return false;
    }

    /**
     * Adds a package neighbor relation.
     * By default also notifies listeners.
     */
    addPackageNeighbor(k1: PackageInfo, k2: PackageInfo, propagate: boolean = true) {
        if (options.readNeighbors) {
            this.addPackageNeighborPrivate(k1, k2, propagate);
            this.addPackageNeighborPrivate(k2, k1, propagate);
        }
    }

    private addPackageNeighborPrivate(k: PackageInfo, neighbor: PackageInfo, propagate: boolean = true) {
        const f = this.fragmentState;
        const s = mapGetSet(f.packageNeighbors, k);
        if (!s.has(neighbor)) {
            s.add(neighbor);
            if (propagate) {
                const ts = f.packageNeighborListeners.get(k);
                if (ts)
                    for (const listener of ts.values()) {
                        this.enqueueListenerCall([listener, neighbor]);
                        this.diagnostics.packageNeighborListenerNotifications++;
                    }
            }
        }
    }

    /**
     * Adds a quantified constraint for all ancestors (reflexive and transitive) of the given token.
     * The token and the node must together uniquely determine the function.
     */
    addForAllAncestorsConstraint(t: Token, n: Node, listener: (ancestor: Token) => void) {
        if (logger.isDebugEnabled())
            logger.debug(`Adding ancestors constraint to ${t} at ${nodeToString(n)}`);
        this.addForAllAncestorsConstraintPrivate(t, n, listener);
    }

    private addForAllAncestorsConstraintPrivate(t: Token, n: Node, listener: (ancestor: Token) => void) {
        const f = this.fragmentState;
        const m = mapGetMap(f.ancestorListeners, t);
        if (!m.has(n)) {
            // run listener on all existing ancestors
            const id = this.getAncestorListenerID(t, n);
            for (const a of f.getAncestors(t)) {
                const p = mapGetSet(f.listenersProcessed, id);
                if (!p.has(a)) {
                    p.add(a);
                    this.enqueueListenerCall([listener, a]);
                    this.diagnostics.ancestorListenerNotifications++;
                }
            }
            // register listener for future inheritance relations
            m.set(n, listener);
        }
    }

    /**
     * Adds an inheritance relation.
     * By default also notifies listeners.
     */
    addInherits(child: Token, parent: Token, propagate: boolean = true) {
        if (child === parent)
            return;
        const f = this.fragmentState;
        const st = mapGetSet(f.inherits, child);
        if (!st.has(parent)) {
            if (logger.isDebugEnabled())
                logger.debug(`Adding inheritance relation ${child} -> ${parent}`);
            if (propagate) {
                const ancestors = f.getAncestors(parent);
                const descendants = f.getDescendants(child);

                // flood fill graph from Q and return reachable nodes
                function flood(Q: Token[], edges: Map<Token, Set<Token>>): Set<Token> {
                    const res = new Set(Q);
                    while (Q.length) {
                        const tok = Q.pop()!;
                        for (const j of edges.get(tok) ?? [])
                            if (!res.has(j)) {
                                res.add(j);
                                Q.push(j);
                            }
                    }
                    return res;
                }

                // collect descendants which already inherit from parent
                // we don't need to notify them or any of their descendants
                const optDes = flood([...descendants].filter((des) => f.inherits.get(des)!.has(parent)), f.reverseInherits);

                // similar, but for ancestors
                for (const anc of flood([...ancestors].filter((anc) => st.has(anc)), f.inherits))
                    ancestors.delete(anc);

                for (const des of descendants) if (!optDes.has(des)) {
                    const ts = f.ancestorListeners.get(des);
                    if (ts)
                        for (const anc of ancestors)
                            for (const [n, listener] of ts) {
                                const id = this.getAncestorListenerID(des, n);
                                const p = mapGetSet(f.listenersProcessed, id);
                                if (!p.has(anc)) {
                                    p.add(anc);
                                    this.enqueueListenerCall([listener, anc]);
                                    this.diagnostics.ancestorListenerNotifications++;
                                }
                            }
                }
            }
            st.add(parent);
            mapGetSet(f.reverseInherits, parent).add(child);
        }
    }

    /**
     * Adds a quantified constraint for all explicit numeric properties of the given array.
     * The triple consisting of the token, the key, and the node must together uniquely determine the function (including its free variables).
     */
    addForAllArrayEntriesConstraint(t: ArrayToken, key: TokenListener, n: Node, listener: (prop: string) => void) {
        if (logger.isDebugEnabled())
            logger.debug(`Adding array entries constraint #${TokenListener[key]} to ${t} at ${locationToStringWithFileAndEnd(n.loc)}`);
        const id = this.getListenerID(key, n);
        const m = this.runArrayEntriesListener(t, id, listener);
        if (m) {
            // register listener for future entries
            m.set(id, listener);
        }
    }

    /**
     * Runs array entry listener on all existing entries if the listener is new.
     * Returns listener map (or false if the listener is not new).
     */
    private runArrayEntriesListener(t: ArrayToken, id: ListenerID, listener: (prop: string) => void): Map<ListenerID, (prop: string) => void> | false {
        const f = this.fragmentState;
        const m = mapGetMap(f.arrayEntriesListeners, t);
        if (!m.has(id)) {
            const ps = f.arrayEntries.get(t);
            if (ps)
                for (const p of ps) {
                    this.enqueueListenerCall([listener, p]);
                    this.diagnostics.arrayEntriesListenerNotifications++;
                }
            return m;
        } else
            return false;
    }

    /**
     * Adds an array numeric property.
     * Non-numeric properties are ignored.
     * By default also notifies listeners.
     */
    addArrayEntry(a: ArrayToken, prop: string, propagate: boolean = true) {
        if (!isArrayIndex(prop)) // TODO: treat large indices as "unknown"?
            return;
        const f = this.fragmentState;
        const ps = mapGetSet(f.arrayEntries, a);
        if (!ps.has(prop)) {
            if (logger.isDebugEnabled())
                logger.debug(`Adding array entry ${a}[${prop}]`);
            ps.add(prop);
            if (propagate) {
                const ts = f.arrayEntriesListeners.get(a);
                if (ts)
                    for (const listener of ts.values()) {
                        this.enqueueListenerCall([listener, prop]);
                        this.diagnostics.arrayEntriesListenerNotifications++;
                    }
            }
            // add flow to summary var
            this.addSubsetEdge(
                f.getRepresentative(f.varProducer.objPropVar(a, prop)),
                f.getRepresentative(f.varProducer.arrayAllVar(a)),
                propagate,
            );
        }
    }

    /**
     * Adds a quantified constraint for all properties of the given object.
     * The triple consisting of the token, the key, and the node must together uniquely determine the function (including its free variables).
     * The listener function must allow for the token to be widened.
     */
    addForAllObjectPropertiesConstraint(t: ObjectPropertyVarObj, key: TokenListener, n: Node, listener: (prop: string) => void) {
        if (logger.isDebugEnabled())
            logger.debug(`Adding object properties constraint #${TokenListener[key]} to ${t} at ${locationToStringWithFileAndEnd(n.loc)}`);
        const id = this.getListenerID(key, n);
        const m = this.runObjectPropertiesListener(t, id, listener);
        if (m) {
            // register listener for future properties
            m.set(id, listener);
        }
    }

    /**
     * Runs object property listener on all existing properties if the listener is new.
     * Returns listener map (or false if the listener is not new).
     */
    private runObjectPropertiesListener(t: ObjectPropertyVarObj, id: ListenerID, listener: (prop: string) => void): Map<ListenerID, (prop: string) => void> | false {
        const f = this.fragmentState;
        const m = mapGetMap(f.objectPropertiesListeners, t);
        if (!m.has(id)) {
            const ps = f.objectProperties.get(t);
            if (ps)
                for (const p of ps) {
                    this.enqueueListenerCall([listener, p]);
                    this.diagnostics.objectPropertiesListenerNotifications++;
                }
            return m;
        } else
            return false;
    }

    /**
     * Adds an object property.
     * By default also notifies listeners.
     */
    addObjectProperty(a: ObjectPropertyVarObj, prop: string, propagate: boolean = true) {
        const f = this.fragmentState;
        const ps = mapGetSet(f.objectProperties, a);
        if (!ps.has(prop)) {
            if (logger.isDebugEnabled())
                logger.debug(`Adding object property ${a}.${prop}`);
            ps.add(prop);
            if (propagate) {
                const ts = f.objectPropertiesListeners.get(a);
                if (ts)
                    for (const listener of ts.values()) {
                        this.enqueueListenerCall([listener, prop]);
                        this.diagnostics.objectPropertiesListenerNotifications++;
                    }
            }
            if (a instanceof ArrayToken && prop === ARRAY_UNKNOWN)
                // add flow to summary var
                this.addSubsetEdge(
                    f.getRepresentative(f.varProducer.arrayUnknownVar(a)),
                    f.getRepresentative(f.varProducer.arrayAllVar(a)),
                    propagate,
                );
        }
    }

    /**
     * Collects property read operations.
     * @param result the constraint variable for the result of the property read operation
     * @param base the constraint variable for the base expression
     * @param pck the current package object token
     * @param prop the property name
     */
    collectPropertyRead(result: ConstraintVar | undefined, base: ConstraintVar | undefined, pck: PackageObjectToken, prop: string | undefined) { // TODO: rename to registerPropertyRead, move to FragmentState
        if (result && base)
            this.fragmentState.maybeEmptyPropertyReads.push({result, base, pck, prop});
    }

    /**
     * Collects dynamic property write operations.
     * @param base the constraint variable for the base expression
     */
    collectDynamicPropertyWrite(base: ConstraintVar | undefined) { // TODO: rename to registerDynamicPropertyWrite, move to FragmentState
        if (base)
            this.fragmentState.dynamicPropertyWrites.add(base);
    }

    /**
     * Redirects constraint variable.
     * Updates the subset edges and listeners, and propagates worklist tokens along redirected edges.
     * Assumes that there is a subset path from v to rep.
     *
     * The caller should carefully observe that once the function returns, v is likely not a representative
     * any more, but v's type will not reflect this fact.
     * Do not use v as a representative after calling redirect!
     *
     * @param v constraint variable to redirect
     * @param rep new representative
     */
    redirect(v: RepresentativeVar, rep: RepresentativeVar) {
        const f = this.fragmentState;
        assert(f.vars.has(v) && f.vars.has(rep));

        if (v === rep)
            return;

        // TODO: remove these - they are guaranteed by the RepresentativeVar invariant
        assert(f.isRepresentative(v) && f.isRepresentative(rep));
        assert(f.getRepresentative(v) === v && f.getRepresentative(rep) === rep);
        if (logger.isDebugEnabled())
            logger.debug(`Redirecting ${v} to ${rep}`);

        /*
        To preserve the invariants of the RepresentativeVar type, the data structures
        in FragmentState that only contain representative variables must be carefully
        updated to preserve that property. I.e., all references to v MUST be replaced!
        */

        // set rep as new representative for v
        f.redirections.set(v, rep);
        // ignore v's new outgoing subset edges
        this.nodesWithNewEdges.delete(v);
        // propagate v's worklist tokens (assuming there is a subset path from v to rep)
        this.processTokens(v);
        const [size, has] = this.fragmentState.getSizeAndHas(v);
        this.fragmentState.deleteVar(v);
        f.numberOfTokens -= size;
        // find tokens in rep that are not in v
        const rts: Set<Token> = new Set;
        for (const t of f.getTokens(rep))
            if (!has(t))
                rts.add(t);
        // redirect subset edges
        const repOut = mapGetSet(f.subsetEdges, rep);
        const repIn = mapGetSet(f.reverseSubsetEdges, rep);
        const vOut = f.subsetEdges.get(v);
        if (vOut) {
            for (const w of vOut) {
                if (w !== rep) {
                    const qs = f.reverseSubsetEdges.get(w);
                    assert(qs, "Subset edges empty");
                    qs.delete(v);
                    if (!repOut.has(w)) {
                        repOut.add(w);
                        qs.add(rep);
                        f.numberOfSubsetEdges++;
                    }
                    this.addTokens(rts, w);
                }
            }
            f.numberOfSubsetEdges -= vOut.size;
            f.subsetEdges.delete(v);
        }
        const vIn = f.reverseSubsetEdges.get(v);
        if (vIn) {
            for (const w of vIn)
                if (w !== rep) {
                    const qs = f.subsetEdges.get(w);
                    assert(qs, "Subset edges empty");
                    qs.delete(v);
                    if (!repIn.has(w)) {
                        repIn.add(w);
                        qs.add(rep);
                        f.numberOfSubsetEdges++;
                    }
                }
            f.numberOfSubsetEdges -= vIn.size;
            f.reverseSubsetEdges.delete(v);
        }
        repOut.delete(v);
        repIn.delete(v);
        if (repOut.size === 0)
            f.subsetEdges.delete(rep);
        if (repIn.size === 0)
            f.reverseSubsetEdges.delete(rep);
        // redirect listeners, invoke on tokens in rep that are not in v
        const tr = f.tokenListeners.get(v);
        if (tr) {
            const qr = mapGetMap(f.tokenListeners, rep);
            for (const [k, listener] of tr)
                if (!qr.has(k)) {
                    qr.set(k, listener);
                    for (const t of rts)
                        this.callTokenListener(k, listener, t);
                }
            f.tokenListeners.delete(v);
        }
        const tr1 = f.pairListeners1.get(v);
        if (tr1) {
            const bases: Array<AllocationSiteToken> = [];
            for (const t of rts)
                if (t instanceof AllocationSiteToken)
                    bases.push(t);
            const qr1 = mapGetMap(f.pairListeners1, rep);
            for (const [k, v2l] of tr1)
                if (!qr1.has(k)) {
                    qr1.set(k, v2l);
                    const [v2, listener] = v2l;
                    for (const t2 of f.getTokens(f.getRepresentative(v2)))
                        if (t2 instanceof FunctionToken || t2 instanceof AccessPathToken)
                            for (const t of bases)
                                this.callTokenPairListener(k, listener, t, t2);
                }
            f.pairListeners1.delete(v);
        }
        const tr2 = f.pairListeners2.get(v);
        if (tr2) {
            const funs: Array<FunctionToken | AccessPathToken> = [];
            for (const t of rts)
                if (t instanceof FunctionToken || t instanceof AccessPathToken)
                    funs.push(t);
            const qr2 = mapGetMap(f.pairListeners2, rep);
            for (const [k, v1l] of tr2)
                if (!qr2.has(k)) {
                    qr2.set(k, v1l);
                    const [v1, listener] = v1l;
                    for (const t1 of f.getTokens(f.getRepresentative(v1)))
                        if (t1 instanceof AllocationSiteToken)
                            for (const t of funs)
                                this.callTokenPairListener(k, listener, t1, t);
                }
            f.pairListeners2.delete(v);
        }
        assert(!this.unprocessedTokens.has(v));
        f.vars.delete(v);
    }

    /**
     * Processes the items in the token worklist for the given constraint variable.
     */
    processTokens(v: RepresentativeVar) {
        const ts = this.unprocessedTokens.get(v);
        if (ts) {
            if (logger.isDebugEnabled())
                logger.debug(`Worklist size: ${this.diagnostics.unprocessedTokensSize}, propagating ${ts.length} token${ts.length !== 1 ? "s" : ""} from ${v}`);
            this.unprocessedTokens.delete(v);
            this.diagnostics.unprocessedTokensSize -= ts.length;
            // propagate new tokens to successors
            const f = this.fragmentState;
            assert(f.vars.has(v));
            let s = f.subsetEdges.get(v);
            if (s) {
                for (const to of s)
                    this.addTokens(ts, to);
                this.incrementIterations();
            }
            // notify listeners
            const tr = f.tokenListeners.get(v);
            if (tr)
                for (const t of ts)
                    for (const [id, listener] of tr)
                        this.callTokenListener(id, listener, t);
            const tr1 = f.pairListeners1.get(v);
            if (tr1)
                for (const t of ts)
                    if (t instanceof AllocationSiteToken)
                        for (const [id, [v2, listener]] of tr1)
                            for (const t2 of f.getTokens(f.getRepresentative(v2)))
                                if (t2 instanceof FunctionToken || t2 instanceof AccessPathToken)
                                    this.callTokenPairListener(id, listener, t, t2);
            let tr2 = f.pairListeners2.get(v);
            if (tr2)
                for (const t of ts)
                    if ((t instanceof FunctionToken || t instanceof AccessPathToken))
                        for (const [id, [v1, listener]] of tr2)
                            for (const t1 of f.getTokens(f.getRepresentative(v1)))
                                if (t1 instanceof AllocationSiteToken)
                                    this.callTokenPairListener(id, listener, t1, t);
        }
    }

    incrementIterations() {
        this.diagnostics.iterations++;
        if (this.diagnostics.iterations % 100 === 0) {
            this.globalState.timeoutTimer.checkTimeout();
            this.printDiagnostics();
        }
    }

    /**
     * Processes all items in the worklist until a fixpoint is reached.
     * This notifies listeners and propagates tokens along subset edges.
     */
    async propagate() {
        if (logger.isDebugEnabled())
            logger.debug("Processing constraints until fixpoint...");
        const f = this.fragmentState;
        f.a.timeoutTimer.checkTimeout();
        await this.checkAbort();
        if (logger.isVerboseEnabled())
            logger.verbose(`Propagating (${this.unprocessedTokens.size}, ${this.nodesWithNewEdges.size}, ${this.restored.size}, ${f.postponedListenerCalls.length})`);
        let round = 0;
        while (this.unprocessedTokens.size > 0 || this.nodesWithNewEdges.size > 0 || this.restored.size > 0 || f.postponedListenerCalls.length > 0) {
            round++;
            this.diagnostics.fixpointRound = round;
            if (logger.isVerboseEnabled())
                logger.verbose(`Fixpoint round: ${round} (call edges: ${f.numberOfFunctionToFunctionEdges}, vars: ${f.getNumberOfVarsWithTokens()}, tokens: ${f.numberOfTokens}, subsets: ${f.numberOfSubsetEdges})`);
            if (options.maxRounds !== undefined && round > options.maxRounds) {
                f.warn(`Fixpoint round limit reached, aborting propagation`);
                this.diagnostics.roundLimitReached++;
                this.diagnostics.unprocessedTokensSize = 0;
                this.unprocessedTokens.clear();
                this.nodesWithNewEdges.clear();
                this.restored.clear();
                f.postponedListenerCalls.length = 0;
                break;
            }
            if (this.unprocessedTokens.size > 0 || this.nodesWithNewEdges.size > 0 || this.restored.size > 0) {
                if (options.cycleElimination) {
                    // find vars that are end points of new or restored subset edges
                    const nodes = new Set<RepresentativeVar>();
                    for (const v of [...this.nodesWithNewEdges, ...this.restored])
                        nodes.add(f.getRepresentative(v));
                    if (nodes.size > 0) {
                        // find strongly connected components
                        const timer1 = new Timer();
                        const [reps, repmap] = nuutila(nodes, (v: RepresentativeVar) => f.subsetEdges.get(v)); // TODO: only consider new edges for entry nodes?
                        if (logger.isVerboseEnabled())
                            logger.verbose(`Cycle detection nodes: ${f.vars.size}, roots: ${nodes.size}, components: ${reps.length}`);
                        // cycle elimination
                        for (const [v, rep] of repmap)
                            this.redirect(v, rep); // TODO: this includes processing pending edges and tokens for v, which may be unnecessary?
                        this.diagnostics.totalCycleEliminationTime += timer1.elapsedCPU();
                        this.diagnostics.totalCycleEliminationRuns++;
                        const timer2 = new Timer();
                        // process new tokens for the component representatives in topological order
                        if (logger.isVerboseEnabled())
                            logger.verbose(`Processing ${this.diagnostics.unprocessedTokensSize} new token${this.diagnostics.unprocessedTokensSize !== 1 ? "s" : ""}`);
                        for (let i = reps.length - 1; i >= 0; i--) {
                            const v = reps[i];
                            this.processTokens(v);
                            await this.checkAbort(true);
                        }
                        this.diagnostics.totalPropagationTime += timer2.elapsedCPU();
                        this.nodesWithNewEdges.clear();
                        this.restored.clear();
                    }
                    // process remaining tokens outside the sub-graph reachable via the new edges
                    const timer3 = new Timer();
                    for (const v of this.unprocessedTokens.keys())
                        this.processTokens(v);
                    this.diagnostics.totalPropagationTime += timer3.elapsedCPU();
                } else {
                    // process all tokens in worklist until empty
                    if (logger.isVerboseEnabled())
                        logger.verbose(`Processing ${this.diagnostics.unprocessedTokensSize} new token${this.diagnostics.unprocessedTokensSize !== 1 ? "s" : ""}`);
                    const timer = new Timer();
                    this.nodesWithNewEdges.clear();
                    this.restored.clear();
                    for (const v of this.unprocessedTokens.keys()) {
                        this.processTokens(v);
                        await this.checkAbort(true);
                    }
                    this.diagnostics.totalPropagationTime += timer.elapsedCPU();
                }
            }
            if (this.unprocessedTokens.size !== 0 || this.diagnostics.unprocessedTokensSize !== 0 || this.nodesWithNewEdges.size !== 0 || this.restored.size !== 0)
                assert.fail(`worklist non-empty: unprocessedTokens.size: ${this.unprocessedTokens.size}, unprocessedTokensSize: ${this.diagnostics.unprocessedTokensSize}, nodesWithNewEdges.size: ${this.nodesWithNewEdges.size}, restored.size: ${this.restored.size}`);
            // process all enqueued listener calls (excluding those created during the processing)
            if (logger.isVerboseEnabled())
                logger.verbose(`Processing listener calls: ${f.postponedListenerCalls.length}`);
            if (f.postponedListenerCalls.length > 0) {
                const timer = new Timer();
                this.diagnostics.listenerNotificationRounds++;
                const calls = Array.from(f.postponedListenerCalls);
                f.postponedListenerCalls.length = 0;
                let count = 0;
                for (const [fun, args] of calls) {
                    (fun as Function).apply(undefined, Array.isArray(args) ? args : [args]);
                    if (++count % 100 === 0) {
                        f.a.timeoutTimer.checkTimeout();
                        this.printDiagnostics();
                    }
                }
                this.diagnostics.totalListenerCallTime += timer.elapsedCPU();
            }
        }
        if (this.diagnostics.unprocessedTokensSize !== 0)
            assert.fail(`unprocessedTokensSize non-zero after propagate: ${this.diagnostics.unprocessedTokensSize}`);
    }

    async checkAbort(throttle: boolean = false) {
        if (this.abort) {
            if (throttle) {
                if (this.diagnostics.iterations < this.fixpointIterationsThrottled + 1000)
                    return;
                this.fixpointIterationsThrottled = this.diagnostics.iterations;
            }
            await setImmediate(); // gives the server a chance to process abort requests
            if (this.abort()) {
                logger.verbose("Abort signal received");
                throw new AbortedException();
            }
        }
    }

    /**
     * Initializes a new fragment state.
     */
    prepare() {
        this.fragmentState = new FragmentState(this);
    }

    /**
     * Merges the given fragment state into the current fragment state.
     */
    merge(_s: FragmentState, propagate: boolean) { // TODO: reconsider use of 'propagate' flag
        // use a different type for s' representative variables to prevent accidental mixups
        const s = _s as unknown as FragmentState<MergeRepresentativeVar>;
        const f = this.fragmentState;
        // add processed listeners
        mapSetAddAll(s.listenersProcessed, f.listenersProcessed);
        // merge redirections
        for (const [v, rep] of s.redirections) {
            const fRep = f.getRepresentative(v);
            const repRep = f.getRepresentative(rep);
            this.addSubsetEdge(fRep, repRep);
            this.redirect(fRep, repRep);
        }
        // run new array entry listeners on existing entries
        for (const [t, m] of s.arrayEntriesListeners)
            for (const [id, listener] of m)
                this.runArrayEntriesListener(t, id, listener);
        // run new object property listeners on existing properties
        for (const [t, m] of s.objectPropertiesListeners)
            for (const [id, listener] of m)
                this.runObjectPropertiesListener(t, id, listener);
        // run new package neighbor listeners on existing neighbors
        for (const [k, m] of s.packageNeighborListeners)
            for (const [n, listener] of m)
                this.runPackageNeighborsListener(k, n, listener);
        // add new constraint variables, tokens, token listeners, and subset edges
        for (const v of s.vars) {
            const vRep = f.getRepresentative(v);
            f.vars.add(vRep);
            const ntr = s.tokenListeners.get(v);
            const ntr1 = s.pairListeners1.get(v);
            const ntr2 = s.pairListeners2.get(v);
            const svs = s.subsetEdges.get(v);
            if (propagate) {
                // run new token listeners on existing tokens
                for (const t of f.getTokens(vRep)) {
                    if (ntr)
                        for (const [id, listener] of ntr)
                            this.callTokenListener(id, listener, t);
                    if (t instanceof AllocationSiteToken && ntr1)
                        for (const [id, [v2, listener]] of ntr1)
                            for (const t2 of [...f.getTokens(f.getRepresentative(v2)), ...s.getTokens(s.getRepresentative(v2))])
                                if (t2 instanceof FunctionToken || t2 instanceof AccessPathToken)
                                    this.callTokenPairListener(id, listener, t, t2);
                    if ((t instanceof FunctionToken || t instanceof AccessPathToken) && ntr2)
                        for (const [id, [v1, listener]] of ntr2)
                            for (const t1 of [...f.getTokens(f.getRepresentative(v1)), ...s.getTokens(s.getRepresentative(v1))])
                                if (t1 instanceof AllocationSiteToken)
                                    this.callTokenPairListener(id, listener, t1, t);
                }
                // propagate existing tokens along new subset edges
                if (svs)
                    for (const v2 of svs)
                        this.addTokens(f.getTokens(vRep), f.getRepresentative(v2));
            }
            // add new tokens (if propagate set, also trigger existing listeners and propagate along existing subset edges)
            this.addTokens(s.getTokens(v), vRep, propagate);
            // add new listeners
            if (ntr)
                for (const [id, listener] of ntr)
                    mapGetMap(f.tokenListeners, vRep).set(id, listener);
            if (ntr1) {
                const q = mapGetMap(f.pairListeners1, vRep);
                for (const [id, [v2, listener]] of ntr1) {
                    const v2Rep = f.getRepresentative(v2);
                    q.set(id, [v2Rep, listener]);
                    mapGetMap(f.pairListeners2, v2Rep).set(id, [vRep, listener]);
                }
            }
            // add new subset edges
            if (svs) {
                const fvs = mapGetSet(f.subsetEdges, vRep);
                for (const v2 of svs) {
                    const v2Rep = f.getRepresentative(v2);
                    if (!fvs.has(v2Rep) && vRep !== v2Rep) {
                        fvs.add(v2Rep);
                        f.numberOfSubsetEdges++;
                        mapGetSet(f.reverseSubsetEdges, v2Rep).add(vRep);
                        this.restored.add(v2Rep); // triggers cycle elimination
                    }
                }
            }
        }
        // add new object properties and array entries
        for (const [t, props] of s.objectProperties)
            for (const prop of props)
                this.addObjectProperty(t, prop, propagate);
        for (const [t, entries] of s.arrayEntries)
            for (const entry of entries)
                this.addArrayEntry(t, entry, propagate);
        // add new array entry listeners and object property listeners
        mapMapSetAll(s.arrayEntriesListeners, f.arrayEntriesListeners);
        mapMapSetAll(s.objectPropertiesListeners, f.objectPropertiesListeners);
        // add new package neighbors and listeners
        for (const [k, ns] of s.packageNeighbors)
            for (const n of ns)
                this.addPackageNeighbor(k, n, propagate);
        mapMapSetAll(s.packageNeighborListeners, f.packageNeighborListeners);
        // add new ancestor listeners and inheritance relations
        for (const [t, m] of s.ancestorListeners)
            for (const [n, listener] of m)
                this.addForAllAncestorsConstraintPrivate(t, n, listener);
        for (const [c, ps] of s.inherits)
            for (const p of ps)
                this.addInherits(c, p, propagate);
        // add remaining fragment state
        mapSetAddAll(s.requireGraph, f.requireGraph);
        mapSetAddAll(s.functionToFunction, f.functionToFunction);
        mapSetAddAll(s.callToFunction, f.callToFunction);
        mapSetAddAll(s.callToFunctionOrModule, f.callToFunctionOrModule);
        setAll(s.callToContainingFunction, f.callToContainingFunction);
        mapSetAddAll(s.callToModule, f.callToModule);
        f.numberOfFunctionToFunctionEdges += s.numberOfFunctionToFunctionEdges;
        f.numberOfCallToFunctionEdges += s.numberOfCallToFunctionEdges;
        addAll(s.functionsWithArguments, f.functionsWithArguments);
        addAll(s.functionsWithThis, f.functionsWithThis);
        f.artificialFunctions.push(...s.artificialFunctions);
        addAll(s.callLocations, f.callLocations);
        setAll(s.maybeEmptyMethodCalls, f.maybeEmptyMethodCalls);
        addAll(s.nativeCallLocations, f.nativeCallLocations);
        addAll(s.externalCallLocations, f.externalCallLocations);
        addAll(s.callsWithUnusedResult, f.callsWithUnusedResult);
        addAll(s.callsWithResultMaybeUsedAsPromise, f.callsWithResultMaybeUsedAsPromise);
        mapSetAddAll(s.functionParameters, f.functionParameters);
        addAll(s.invokedExpressions, f.invokedExpressions);
        addAll(s.maybeEscapingFromModule, f.maybeEscapingFromModule);
        addAll(s.widened, f.widened);
        mapSetAddAll(s.maybeEscapingToExternal, f.maybeEscapingToExternal);
        setAll(s.unhandledDynamicPropertyWrites, f.unhandledDynamicPropertyWrites);
        addAll(s.unhandledDynamicPropertyReads, f.unhandledDynamicPropertyReads);
        addAllMapHybridSet(s.errors, f.errors);
        addAllMapHybridSet(s.warnings, f.warnings);
        addAllMapHybridSet(s.warningsUnsupported, f.warningsUnsupported);
        mapSetAddAll(s.moduleAccessPaths, f.moduleAccessPaths);
        mapMapMapSetAll(s.propertyReadAccessPaths, f.propertyReadAccessPaths);
        mapMapMapSetAll(s.propertyWriteAccessPaths, f.propertyWriteAccessPaths);
        mapMapSetAll(s.callResultAccessPaths, f.callResultAccessPaths);
        mapMapSetAll(s.componentAccessPaths, f.componentAccessPaths);
        mapArrayPushAll(s.importDeclRefs, f.importDeclRefs);
        f.maybeEmptyPropertyReads.push(...s.maybeEmptyPropertyReads);
        addAll(s.dynamicPropertyWrites, f.dynamicPropertyWrites);
        this.printDiagnostics();
    }
}
