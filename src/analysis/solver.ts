import {ConstraintVar, IntermediateVar, NodeVar, ObjectPropertyVar, ObjectPropertyVarObj} from "./constraintvars";
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
    mapSetAddAll,
    nodeToString,
    setAll
} from "../misc/util";
import assert from "assert";
import {AccessPath, CallResultAccessPath, ComponentAccessPath, IgnoredAccessPath, ModuleAccessPath, PropertyAccessPath, UnknownAccessPath} from "./accesspaths";
import {isAssignmentExpression, Node} from "@babel/types";
import {FragmentState, ListenerID} from "./fragmentstate";
import {TokenListener} from "./listeners";
import {nuutila} from "../misc/scc";
import {options, patternProperties} from "../options";
import Timer from "../misc/timer";
import {setImmediate} from "timers/promises";
import {AnalysisDiagnostics} from "../typings/diagnostics";
import {getMemoryUsage} from "../misc/memory";
import {JELLY_NODE_ID} from "../parsing/extras";

export class AbortedException extends Error {}

export default class Solver {

    readonly globalState: GlobalState = new GlobalState;

    fragmentState: FragmentState = new FragmentState(this.globalState);

    get varProducer() {
        return this.fragmentState.varProducer;
    }

    unprocessedTokens: Map<ConstraintVar, Array<Token>> = new Map;

    nodesWithNewEdges: Set<ConstraintVar> = new Set;

    restored: Set<ConstraintVar> = new Set;

    // TODO: move some of this into AnalysisDiagnostics?
    // for diagnostics only
    unprocessedTokensSize: number = 0;
    fixpointRound: number = 0;
    listenerNotificationRounds: number = 0;
    largestTokenSetSize: number = 0;
    largestSubsetEdgeOutDegree: number = 0;
    lastPrintDiagnosticsTime: number = 0;
    tokenListenerNotifications: number = 0;
    pairListenerNotifications: number = 0;
    packageNeighborListenerNotifications: number = 0;
    ancestorListenerNotifications: number = 0;
    arrayEntriesListenerNotifications: number = 0;
    objectPropertiesListenerNotifications: number = 0;
    roundLimitReached: number = 0;
    totalCycleEliminationTime: number = 0;
    totalCycleEliminationRuns: number = 0;
    totalPropagationTime: number = 0;
    totalListenerCallTime: number = 0;
    totalWideningTime: number = 0;

    diagnostics: AnalysisDiagnostics = {
        packages: 0,
        modules: 0,
        functions: 0,
        functionToFunctionEdges: 0,
        iterations: 0,
        uniqueTokens: 0,
        aborted: false,
        timeout: false,
        time: 0,
        cpuTime: 0,
        codeSize: 0,
        maxMemoryUsage: 0,
        errors: 0,
        warnings: 0,
        totalCallSites: 0,
        callsWithUniqueCallee: 0,
        callsWithNoCallee: 0,
        nativeOnlyCalls: 0,
        externalOnlyCalls: 0,
        nativeOrExternalCalls: 0,
        functionsWithZeroCallers: 0
    };

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
        d.functionToFunctionEdges = f.numberOfFunctionToFunctionEdges;
        d.uniqueTokens = f.a.canonicalTokens.size;
        const usage = getMemoryUsage();
        if (logger.isVerboseEnabled())
            logger.verbose(`Memory usage: ${usage}MB`);
        d.maxMemoryUsage = Math.max(d.maxMemoryUsage, usage);
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
    addToken(t: Token, toRep: ConstraintVar): boolean {
        const f = this.fragmentState;
        if (f.addToken(t, toRep)) {
            if (logger.isVerboseEnabled())
                assert(!f.redirections.has(toRep));
            f.vars.add(toRep);
            this.tokenAdded(toRep, t);
            // collect statistics
            this.updateTokenStats(toRep);
            // add object property and array entry if applicable
            if (toRep instanceof ObjectPropertyVar) {
                this.addObjectProperty(toRep.obj, toRep.prop);
                if (toRep.obj instanceof ArrayToken)
                    this.addArrayEntry(toRep.obj, toRep.prop);
            }
            return true;
        }
        return false;
    }

    /**
     * Adds a set of tokens if not already present.
     * By default also adds to worklist and notifies listeners.
     */
    private addTokens(ts: Iterable<Token>, toRep: ConstraintVar, propagate: boolean = true) {
        const f = this.fragmentState;
        f.vars.add(toRep);
        let any = false;
        let ws: Array<Token> | undefined = undefined;
        for (const t of f.addTokens(ts, toRep)) {
            any = true;
            if (propagate)
                ws = this.tokenAdded(toRep, t, ws);
        }
        // add object property and array entry if applicable
        if (any && toRep instanceof ObjectPropertyVar) {
            this.addObjectProperty(toRep.obj, toRep.prop, propagate);
            if (toRep.obj instanceof ArrayToken)
                this.addArrayEntry(toRep.obj, toRep.prop, propagate);
        }
        // collect statistics
        this.updateTokenStats(toRep);
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
            if (any) {
                f.replaceTokens(v, r, size);
                this.updateTokenStats(v);
            }
        }
    }

    private tokenAdded(toRep: ConstraintVar, t: Token, ws?: Array<Token>): Array<Token> | undefined {
        if (logger.isDebugEnabled())
            logger.debug(`Added token ${t} to ${toRep}`);
        // add to worklist
        (ws ??= mapGetArray(this.unprocessedTokens, toRep)).push(t);
        this.unprocessedTokensSize++;
        if (this.unprocessedTokensSize % 100 === 0)
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
        const abstractProp = ap instanceof PropertyAccessPath && ap.prop !== "default" && patternProperties && !patternProperties.has(ap.prop);
        const ap2 = subap instanceof IgnoredAccessPath || (subap instanceof UnknownAccessPath && abstractProp) ? subap :
            abstractProp ? this.globalState.canonicalizeAccessPath(new PropertyAccessPath((ap as PropertyAccessPath).base, "?")) : ap; // abstracting irrelevant access paths
        if (logger.isDebugEnabled())
            logger.debug(`Adding access path ${ap2}${ap2 !== ap ? ` (${ap})` : ""} at ${to}${subap ? ` (sub-expression access path: ${subap})` : ""}`);
        const f = this.fragmentState;
        const asn = to instanceof NodeVar && isAssignmentExpression(to.node);
        if (!asn)
            this.addToken(f.a.canonicalizeToken(new AccessPathToken(ap2)), f.getRepresentative(to));
        // collect information for PatternMatcher
        const t = to instanceof IntermediateVar && to.label === "import" ? to.node : to instanceof NodeVar? to.node : undefined; // special treatment of 'import' expressions
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
     * Collects statistics after tokens have been added.
     */
    private updateTokenStats(toRep: ConstraintVar) {
        const [size] = this.fragmentState.getTokensSize(toRep);
        if (size > this.largestTokenSetSize)
            this.largestTokenSetSize = size;
    }

    /**
     * Reports diagnostics periodically (only if print progress is enabled, stdout is tty, and log level is "info").
     */
    private printDiagnostics() {
        if (options.printProgress && options.tty && isTTY && logger.level === "info") {
            const d = new Date().getTime();
            if (d > this.lastPrintDiagnosticsTime + 100) { // only report every 100ms
                this.lastPrintDiagnosticsTime = d;
                const a = this.globalState;
                const f = this.fragmentState;
                writeStdOut(`Packages: ${a.packageInfos.size}, modules: ${a.moduleInfos.size}, call edges: ${f.numberOfFunctionToFunctionEdges}, ` +
                    (options.diagnostics ? `vars: ${f.getNumberOfVarsWithTokens()}, tokens: ${f.numberOfTokens}, subsets: ${f.numberOfSubsetEdges}, round: ${this.fixpointRound}, ` : "") +
                    `iterations: ${this.diagnostics.iterations}, worklist: ${this.unprocessedTokensSize}` +
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

    addSubsetEdge(fromRep: ConstraintVar, toRep: ConstraintVar, propagate: boolean = true) {
        if (fromRep !== toRep) {
            const f = this.fragmentState;
            const s = mapGetSet(f.subsetEdges, fromRep);
            if (!s.has(toRep)) {
                // add the edge
                s.add(toRep);
                f.numberOfSubsetEdges++;
                if (s.size > this.largestSubsetEdgeOutDegree)
                    this.largestSubsetEdgeOutDegree = s.size;
                mapGetSet(f.reverseSubsetEdges, toRep).add(fromRep);
                if (logger.isVerboseEnabled())
                    assert(!f.redirections.has(fromRep) && !f.redirections.has(toRep))
                f.vars.add(fromRep);
                f.vars.add(toRep);
                if (propagate) {
                    // propagate tokens
                    const [size, ts] = this.fragmentState.getTokensSize(fromRep);
                    if (size > 0) {
                        if (logger.isDebugEnabled())
                            logger.debug(`Worklist size: ${this.unprocessedTokensSize}, propagating ${size} token${size !== 1 ? "s" : ""} from ${fromRep}`);
                        this.addTokens(ts, toRep);
                        this.incrementFixpointIterations();
                    }
                    this.nodesWithNewEdges.add(fromRep);
                }
            }
        }
    }

    /**
     * Provides a unique ID for the given key and node.
     */
    private getListenerID(key: TokenListener, n: Node): ListenerID {
        let id = (n as any)[JELLY_NODE_ID];
        assert(id !== undefined);
        return ((id << 10) + key) ^ ((n.loc && (n.loc as Location).module?.hash) ?? 0); // TODO: hash collision possible
    }

    /**
     * Adds a universally quantified constraint.
     * The constraint variable, the key, and the node must together uniquely determine the function.
     */
    addForAllConstraint(v: ConstraintVar | undefined, key: TokenListener, n: Node, listener: (t: Token) => void) {
        if (v === undefined)
            return;
        const f = this.fragmentState;
        const vRep = f.getRepresentative(v);
        if (logger.isDebugEnabled())
            logger.debug(`Adding universally quantified constraint #${TokenListener[key]} to ${vRep} at ${locationToStringWithFileAndEnd(n.loc)}`);
        const m = mapGetMap(f.tokenListeners, vRep);
        const id = this.getListenerID(key, n);
        if (!m.has(id)) {
            // run listener on all existing tokens
            for (const t of f.getTokens(vRep))
                this.callListener(id, listener, t);
            // register listener for future tokens
            m.set(id, listener);
        }
        f.vars.add(vRep);
    }

    /**
     * Adds a universally quantified constraint for a pair of constraint variables.
     * Only allocation site tokens are considered for the first constraint variable, and only function tokens are considered for the second constraint variable.
     * Each constraint variable together with the key and the node must uniquely determine the function and the other constraint variable.
     */
    addForAllPairsConstraint(v1: ConstraintVar | undefined, v2: ConstraintVar | undefined, key: TokenListener, n: Node, listener: (t1: AllocationSiteToken, t2: FunctionToken | AccessPathToken) => void) {
        if (v1 === undefined || v2 === undefined)
            return;
        assert(key !== undefined);
        const f = this.fragmentState;
        const v1Rep = f.getRepresentative(v1);
        const v2Rep = f.getRepresentative(v2);
        if (logger.isDebugEnabled())
            logger.debug(`Adding universally quantified pair constraint #${TokenListener[key]} to (${v1Rep}, ${v2Rep}) at ${locationToStringWithFileAndEnd(n.loc)}`);
        const m1 = mapGetMap(f.pairListeners1, v1Rep);
        const id = this.getListenerID(key, n);
        if (!m1.has(id)) {
            // run listener on all existing tokens
            const funs: Array<FunctionToken | AccessPathToken> = [];
            for (const t2 of f.getTokens(v2Rep))
                if (t2 instanceof FunctionToken || t2 instanceof AccessPathToken)
                    funs.push(t2);
            for (const t1 of f.getTokens(v1Rep))
                if (t1 instanceof AllocationSiteToken)
                    for (const t2 of funs)
                        this.callPairListener(id, listener, t1, t2);
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
    private callListener(id: ListenerID, listener: (t: Token) => void, t: Token) {
        const s = mapGetSet(this.fragmentState.listenersProcessed, id);
        if (!s.has(t)) {
            s.add(t);
            this.enqueueListenerCall([listener, t]);
            this.tokenListenerNotifications++;
        }
    }

    /**
     * Enqueues a call to a token pair listener if it hasn't been done before.
     */
    private callPairListener(id: ListenerID, listener: (t1: AllocationSiteToken, t2: FunctionToken | AccessPathToken) => void, t1: AllocationSiteToken, t2: FunctionToken | AccessPathToken) {
        const s = mapGetSet(mapGetMap(this.fragmentState.pairListenersProcessed, id), t1);
        if (!s.has(t2)) {
            s.add(t2);
            this.enqueueListenerCall([listener, [t1, t2]]);
            this.pairListenerNotifications++;
        }
    }

    /**
     * Adds a quantified constraint for all neighbors of the given package.
     * The PackageInfo and the node must together uniquely determine the function.
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
                    this.packageNeighborListenerNotifications++;
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
        this.addPackageNeighborPrivate(k1, k2, propagate);
        this.addPackageNeighborPrivate(k2, k1, propagate);
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
                        this.packageNeighborListenerNotifications++;
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
            for (const a of f.getAncestors(t)) {
                const p = mapGetSet(f.ancestorListenersProcessed, n);
                if (!p.has(a)) {
                    this.enqueueListenerCall([listener, a]);
                    this.ancestorListenerNotifications++;
                    mapGetSet(f.ancestorListenersProcessed, n).add(a);
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
            st.add(parent);
            mapGetSet(f.reverseInherits, parent).add(child);
            if (propagate) {
                for (const des of f.getDescendants(child)) {
                    const ts = f.ancestorListeners.get(des);
                    if (ts)
                        for (const anc of f.getAncestors(parent))
                            for (const [n, listener] of ts) {
                                const p = mapGetSet(f.ancestorListenersProcessed, n);
                                if (!p.has(anc)) {
                                    this.enqueueListenerCall([listener, anc]);
                                    this.ancestorListenerNotifications++;
                                    p.add(anc);
                                }
                            }
                }
            }
        }
    }

    /**
     * Adds a quantified constraint for all explicit numeric properties of the given array.
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
     * Runs array entry listener on all existing entries if new.
     * Returns listener map if new.
     */
    private runArrayEntriesListener(t: ArrayToken, id: number, listener: (prop: string) => void): Map<ListenerID, (prop: string) => void> | false {
        const f = this.fragmentState;
        const m = mapGetMap(f.arrayEntriesListeners, t);
        if (!m.has(id)) {
            const ps = f.arrayEntries.get(t);
            if (ps)
                for (const p of ps) {
                    this.enqueueListenerCall([listener, p]);
                    this.arrayEntriesListenerNotifications++;
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
                        this.arrayEntriesListenerNotifications++;
                    }
            }
        }
    }

    /**
     * Adds a quantified constraint for all properties of the given object.
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
     * Runs object property listener on all existing properties if new.
     * Returns listener map if new.
     */
    private runObjectPropertiesListener(t: ObjectPropertyVarObj, id: number, listener: (prop: string) => void): Map<ListenerID, (prop: string) => void> | false {
        const f = this.fragmentState;
        const m = mapGetMap(f.objectPropertiesListeners, t);
        if (!m.has(id)) {
            const ps = f.objectProperties.get(t);
            if (ps)
                for (const p of ps) {
                    this.enqueueListenerCall([listener, p]);
                    this.objectPropertiesListenerNotifications++;
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
                        this.objectPropertiesListenerNotifications++;
                    }
            }
        }
    }

    /**
     * Collects property read operations.
     * @param result the constraint variable for the result of the property read operation
     * @param base the constraint variable for the base expression
     * @param pck the current package object token
     */
    collectPropertyRead(result: ConstraintVar | undefined, base: ConstraintVar | undefined, pck: PackageObjectToken) {
        if (result && base)
            this.fragmentState.maybeEmptyPropertyReads.push({result, base, pck});
    }

    /**
     * Collects dynamic property write operations.
     * @param base the constraint variable for the base expression
     */
    collectDynamicPropertyWrite(base: ConstraintVar | undefined) {
        if (base)
            this.fragmentState.dynamicPropertyWrites.add(base);
    }

    /**
     * Redirects constraint variable.
     * Updates the subset edges and listeners, and propagates worklist tokens along redirected edges.
     * Assumes that there is a subset path from v to rep.
     * @param v constraint variable to redirect
     * @param rep new representative (possibly v itself if v previously had another representative)
     */
    redirect(v: ConstraintVar, rep: ConstraintVar) {
        const f = this.fragmentState;
        assert(f.vars.has(v));
        const oldRep = f.getRepresentative(v);
        if (oldRep === rep) {
            // v is already represented by rep
            return;
        }
        if (logger.isDebugEnabled())
            logger.debug(`Redirecting ${v} to ${rep}`);
        if (oldRep !== v) {
            // v is already redirected, so it shouldn't have any subset edges, listeners or tokens
            assert(!f.subsetEdges.has(v));
            assert(!f.reverseSubsetEdges.has(v));
            assert(!f.tokenListeners.has(v));
            assert(!f.pairListeners1.has(v));
            assert(!f.pairListeners2.has(v));
            assert(!f.hasVar(v));
            assert(!this.unprocessedTokens.has(v));
            assert(!this.nodesWithNewEdges.has(v));
        }
        if (v === rep) {
            // v now becomes its own representative, and oldRep !== rep === v so the assertions above apply
            f.redirections.delete(v);
            f.vars.add(v);
        } else {
            // set rep as new representative for v
            f.redirections.set(v, rep);
            if (oldRep === v) { // if v was already redirected, then the assertions above apply
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
                    for (const [k, listener] of tr) {
                        qr.set(k, listener);
                        for (const t of rts)
                            this.callListener(k, listener, t);
                    }
                    f.tokenListeners.delete(v);
                }
                const tr1 = f.pairListeners1.get(v);
                if (tr1) {
                    const bases: Array<AllocationSiteToken> = [];
                    for (const t of rts)
                        if (t instanceof AllocationSiteToken)
                            bases.push(t);
                    const qr1 = mapGetMap(f.pairListeners1, rep)
                    for (const [k, v2l] of tr1) {
                        qr1.set(k, v2l);
                        const [v2, listener] = v2l;
                        for (const t2 of f.getTokens(v2))
                            if (t2 instanceof FunctionToken || t2 instanceof AccessPathToken)
                                for (const t of bases)
                                    this.callPairListener(k, listener, t, t2);
                    }
                    f.pairListeners1.delete(v);
                }
                const tr2 = f.pairListeners2.get(v);
                if (tr2) {
                    const funs: Array<FunctionToken | AccessPathToken> = [];
                    for (const t of rts)
                        if (t instanceof FunctionToken || t instanceof AccessPathToken)
                            funs.push(t);
                    const qr2 = mapGetMap(f.pairListeners2, rep)
                    for (const [k, v1l] of tr2) {
                        qr2.set(k, v1l);
                        const [v1, listener] = v1l;
                        for (const t1 of f.getTokens(v1))
                            if (t1 instanceof AllocationSiteToken)
                                for (const t of funs)
                                    this.callPairListener(k, listener, t1, t);
                    }
                    f.pairListeners2.delete(v);
                }
                f.vars.delete(v);
                f.vars.add(rep);
            }
        }
    }

    /**
     * Processes the items in the token worklist for the given constraint variable.
     */
    processTokens(v: ConstraintVar) {
        const ts = this.unprocessedTokens.get(v);
        if (ts) {
            if (logger.isDebugEnabled())
                logger.debug(`Worklist size: ${this.unprocessedTokensSize}, propagating ${ts.length} token${ts.length !== 1 ? "s" : ""} from ${v}`);
            this.unprocessedTokens.delete(v);
            this.unprocessedTokensSize -= ts.length;
            // propagate new tokens to successors
            const f = this.fragmentState;
            assert(f.vars.has(v));
            let s = f.subsetEdges.get(v);
            if (s) {
                for (const to of s)
                    this.addTokens(ts, to);
                this.incrementFixpointIterations();
            }
            // notify listeners
            const tr = f.tokenListeners.get(v);
            if (tr)
                for (const t of ts)
                    for (const [id, listener] of tr)
                        this.callListener(id, listener, t);
            const tr1 = f.pairListeners1.get(v);
            if (tr1)
                for (const t of ts)
                    if (t instanceof AllocationSiteToken)
                        for (const [id, [v2, listener]] of tr1)
                            for (const t2 of f.getTokens(f.getRepresentative(v2)))
                                if (t2 instanceof FunctionToken || t2 instanceof AccessPathToken)
                                    this.callPairListener(id, listener, t, t2);
            let tr2 = f.pairListeners2.get(v);
            if (tr2)
                for (const t of ts)
                    if ((t instanceof FunctionToken || t instanceof AccessPathToken))
                        for (const [id, [v1, listener]] of tr2)
                            for (const t1 of f.getTokens(f.getRepresentative(v1)))
                                if (t1 instanceof AllocationSiteToken)
                                    this.callPairListener(id, listener, t1, t);
        }
    }

    incrementFixpointIterations() {
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
        let round = 0;
        while (this.unprocessedTokens.size > 0 || this.nodesWithNewEdges.size > 0 || this.restored.size > 0 || f.postponedListenerCalls.length > 0) {
            round++;
            this.fixpointRound = round;
            if (logger.isVerboseEnabled())
                logger.verbose(`Fixpoint round: ${round} (call edges: ${f.numberOfFunctionToFunctionEdges}, vars: ${f.getNumberOfVarsWithTokens()}, tokens: ${f.numberOfTokens}, subsets: ${f.numberOfSubsetEdges})`);
            if (options.maxRounds !== undefined && round > options.maxRounds) {
                f.warn(`Fixpoint round limit reached, aborting propagation`);
                this.roundLimitReached++;
                this.unprocessedTokensSize = 0;
                this.unprocessedTokens.clear();
                this.nodesWithNewEdges.clear();
                this.restored.clear();
                f.postponedListenerCalls.length = 0;
                break;
            }
            if (this.unprocessedTokens.size > 0 || this.nodesWithNewEdges.size > 0 || this.restored.size > 0) {
                if (options.cycleElimination) {
                    // find vars that are end points of new or restored subset edges
                    const nodes = new Set<ConstraintVar>();
                    for (const v of [...this.nodesWithNewEdges, ...this.restored])
                        nodes.add(f.getRepresentative(v));
                    if (nodes.size > 0) {
                        // find strongly connected components
                        const timer1 = new Timer();
                        const [reps, repmap] = nuutila(nodes, (v: ConstraintVar) => f.subsetEdges.get(v)); // TODO: only consider new edges for entry nodes?
                        if (logger.isVerboseEnabled())
                            logger.verbose(`Cycle detection nodes: ${f.vars.size}, roots: ${nodes.size}, components: ${reps.length}`);
                        // cycle elimination
                        for (const [v, rep] of repmap)
                            this.redirect(v, rep); // TODO: this includes processing pending edges and tokens for v, which may be unnecessary?
                        this.totalCycleEliminationTime += timer1.elapsedCPU();
                        this.totalCycleEliminationRuns++;
                        const timer2 = new Timer();
                        // process new tokens for the component representatives in topological order
                        for (let i = reps.length - 1; i >= 0; i--) {
                            const v = reps[i];
                            this.processTokens(v);
                            await this.checkAbort(true);
                        }
                        this.totalPropagationTime += timer2.elapsedCPU();
                        this.nodesWithNewEdges.clear();
                        this.restored.clear();
                    }
                    // process remaining tokens outside the sub-graph reachable via the new edges
                    const timer3 = new Timer();
                    for (const v of this.unprocessedTokens.keys())
                        this.processTokens(v);
                    this.totalPropagationTime += timer3.elapsedCPU();
                } else {
                    // process all tokens in worklist until empty
                    const timer = new Timer();
                    this.nodesWithNewEdges.clear();
                    this.restored.clear();
                    for (const v of this.unprocessedTokens.keys()) {
                        this.processTokens(v);
                        await this.checkAbort(true);
                    }
                    this.totalPropagationTime += timer.elapsedCPU();
                }
            }
            if (this.unprocessedTokens.size !== 0 || this.unprocessedTokensSize !== 0 || this.nodesWithNewEdges.size !== 0 || this.restored.size !== 0)
                assert.fail(`worklist non-empty: unprocessedTokens.size: ${this.unprocessedTokens.size}, unprocessedTokensSize: ${this.unprocessedTokensSize}, nodesWithNewSubsetEdges.size: ${this.nodesWithNewEdges.size}, restoredSubsetEdges.size: ${this.restored.size}`);
            // process all enqueued listener calls (excluding those created during the processing)
            if (logger.isVerboseEnabled())
                logger.verbose(`Processing listener calls: ${f.postponedListenerCalls.length}`);
            if (f.postponedListenerCalls.length > 0) {
                const timer = new Timer();
                this.listenerNotificationRounds++;
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
                this.totalListenerCallTime += timer.elapsedCPU();
            }
        }
        if (this.unprocessedTokensSize !== 0)
            assert.fail(`unprocessedTokensSize non-zero after propagate: ${this.unprocessedTokensSize}`);
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
        this.fragmentState = new FragmentState(this.globalState);
    }

    /**
     * Merges the given fragment state into the current fragment state.
     */
    merge(s: FragmentState, propagate: boolean = true) { // TODO: reconsider use of 'propagate' flag
        const f = this.fragmentState;
        // merge redirections
        if (options.cycleElimination)
            for (const [v, rep] of s.redirections) {
                const fRep = f.getRepresentative(v);
                const repRep = f.getRepresentative(rep);
                this.addSubsetEdge(fRep, repRep);
                this.redirect(fRep, repRep);
            }
        // add processed listeners
        mapSetAddAll(s.ancestorListenersProcessed, f.ancestorListenersProcessed);
        mapSetAddAll(s.listenersProcessed, f.listenersProcessed);
        for (const [id, m] of s.pairListenersProcessed)
            mapSetAddAll(m, mapGetMap(f.pairListenersProcessed, id));
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
                            this.callListener(id, listener, t);
                    if (t instanceof AllocationSiteToken && ntr1)
                        for (const [id, [v2, listener]] of ntr1)
                            for (const t2 of [...f.getTokens(f.getRepresentative(v2)), ...s.getTokens(s.getRepresentative(v2))])
                                if (t2 instanceof FunctionToken || t2 instanceof AccessPathToken)
                                    this.callPairListener(id, listener, t, t2);
                    if ((t instanceof FunctionToken || t instanceof AccessPathToken) && ntr2)
                        for (const [id, [v1, listener]] of ntr2)
                            for (const t1 of [...f.getTokens(f.getRepresentative(v1)), ...s.getTokens(s.getRepresentative(v1))])
                                if (t1 instanceof AllocationSiteToken)
                                    this.callPairListener(id, listener, t1, t);
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
                    if (!fvs.has(v2Rep)) {
                        fvs.add(v2Rep);
                        f.numberOfSubsetEdges++;
                        if (fvs.size > this.largestSubsetEdgeOutDegree)
                            this.largestSubsetEdgeOutDegree = fvs.size;
                        mapGetSet(f.reverseSubsetEdges, v2Rep).add(vRep);
                        this.restored.add(v2Rep); // triggers cycle elimination
                    }
                }
            }
        }
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
        mapSetAddAll(s.calls, f.calls);
        addAll(s.callLocations, f.callLocations);
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