import {ConstraintVar, IntermediateVar, NodeVar, ObjectPropertyVarObj, isObjectPropertyVarObj} from "./constraintvars";
import logger, {isTTY, writeStdOut} from "../misc/logger";
import {AccessPathToken, ArrayToken, ObjectToken, PackageObjectToken, Token} from "./tokens";
import {GlobalState} from "./globalstate";
import {FunctionInfo, ModuleInfo, PackageInfo} from "./infos";
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
    strHash,
} from "../misc/util";
import assert from "assert";
import {AccessPath, CallResultAccessPath, ComponentAccessPath, IgnoredAccessPath, ModuleAccessPath, PropertyAccessPath, UnknownAccessPath} from "./accesspaths";
import {isAssignmentExpression, isNode, Node} from "@babel/types";
import {FragmentState, ListenerID, MergeRepresentativeVar, RepresentativeVar} from "./fragmentstate";
import {TokenListener} from "./listeners";
import {nuutila} from "../misc/scc";
import {options, patternProperties} from "../options";
import Timer from "../misc/timer";
import {setImmediate} from "timers/promises";
import {getMemoryUsage} from "../misc/memory";
import {JELLY_NODE_ID} from "../parsing/extras";
import AnalysisDiagnostics from "./diagnostics";
import {ARRAY_UNKNOWN, INTERNAL_PROTOTYPE, isInternalProperty} from "../natives/ecmascript";
import {ConstraintVarProducer} from "./constraintvarproducer";

export class AbortedException extends Error {}

export type ListenerKey = {l: TokenListener, n?: Node, t?: Token, s?: string};

export default class Solver {

    readonly globalState: GlobalState = new GlobalState;

    fragmentState: FragmentState = new FragmentState(this);

    get varProducer(): ConstraintVarProducer {
        return this.fragmentState.varProducer;
    }

    unprocessedTokens: Map<RepresentativeVar, Array<Token>> = new Map;

    nodesWithNewEdges: Set<ConstraintVar> = new Set;

    restored: Set<ConstraintVar> = new Set;

    readonly listeners: Map<ListenerID, ListenerKey> = new Map;

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
            f.tokenListeners, f.packageNeighborListeners,
            f.arrayEntriesListeners, f.objectPropertiesListeners,
        ].reduce((acc, l: Map<unknown, Map<unknown, unknown>>) => acc + mapMapSize(l), 0);
        d.tokens = f.numberOfTokens;
        d.subsetEdges = f.numberOfSubsetEdges;
        d.functionToFunctionEdges = f.numberOfFunctionToFunctionEdges;
        d.callToFunctionEdges = f.numberOfCallToFunctionEdges;
        d.uniqueTokens = a.canonicalTokens.size;
        d.maxMemoryUsage = Math.max(d.maxMemoryUsage, getMemoryUsage());
        d.unhandledDynamicPropertyWrites = f.unhandledDynamicPropertyWrites.size;
        d.unhandledDynamicPropertyReads = f.unhandledDynamicPropertyReads.size;
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
        if (options.printProgress && options.tty && isTTY && !options.logfile && logger.level === "info") {
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

    private checkListenerIDCollision(id: ListenerID, key: ListenerKey) {
        const x = this.listeners.get(id);
        if (x) {
            if (x.l !== key.l || x.n !== key.n || x.t !== key.t || x.s !== key.s) {
                const format = (x: ListenerKey) =>
                    `${TokenListener[x.l]} ${x.t ?? ""} ${x.s || ""} ${x.n ? `at ${locationToStringWithFileAndEnd(x.n.loc)}` : ""}`;
                logger.error(`Error: Hash collision in getListenerID: ${format(x)} != ${format(key)}`); // TODO: hash collision possible
            }
        } else
            this.listeners.set(id, key);
    }

    /**
     * Provides a unique'ish ID for the given ListenerKey.
     */
    private getListenerID(key: ListenerKey): ListenerID {
        let id = 0n;
        if (key.t) {
            assert(key.t.hash !== undefined);
            id += BigInt(key.t.hash);
        }
        if (key.n)
            id += this.getNodeHash(key.n);
        if (key.s)
            id ^= BigInt(strHash(key.s));
        // place listener type in the lower 16 bits
        id = (id << 16n) | BigInt(key.l);
        this.checkListenerIDCollision(id, key);
        return id;
    }

    /**
     * Adds a universally quantified constraint for a constraint variable.
     * The listener key must uniquely determine the function (including its free variables).
     */
    addForAllTokensConstraint(v: ConstraintVar | undefined, key: TokenListener,
                              opts: Node | Omit<ListenerKey, "l">, listener: (t: Token) => void) {
        if (v === undefined)
            return;
        const f = this.fragmentState;
        const vRep = f.getRepresentative(v);
        const lkey = {l: key, ...(isNode(opts) ? {n: opts} : opts)};
        if (logger.isDebugEnabled())
            logger.debug(`Adding universally quantified constraint #${TokenListener[key]} to ${vRep} at ${lkey.n ? locationToStringWithFileAndEnd(lkey.n.loc) : lkey.t}`);
        this.addForAllTokensConstraintPrivate(vRep, this.getListenerID(lkey), listener);
    }

    private addForAllTokensConstraintPrivate(vRep: RepresentativeVar, id: ListenerID, listener: (t: Token) => void) {
        const f = this.fragmentState;
        const m = mapGetMap(f.tokenListeners, vRep);
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
     * Adds a quantified constraint for all neighbors of the given package.
     * The pair of the PackageInfo, the node and the string must uniquely determine the function (including its free variables).
     */
    addForAllPackageNeighborsConstraint(k: PackageInfo, opts: Omit<ListenerKey, "l">, listener: (neighbor: PackageInfo) => void) {
        if (logger.isDebugEnabled())
            logger.debug(`Adding package neighbor constraint to ${k}`);
        const id = this.getListenerID({l: TokenListener.PACKAGE_NEIGHBORS, ...opts});
        const m = this.runPackageNeighborsListener(k, id, listener);
        if (m) {
            // register listener for future neighbors
            m.set(id, listener);
        }
    }

    /**
     * Runs package neighbors listener on all existing neighbors if new.
     * Returns listener map if new.
     */
    private runPackageNeighborsListener(k: PackageInfo, id: ListenerID, listener: (neighbor: PackageInfo) => void): Map<ListenerID, (neighbor: PackageInfo) => void> | false {
        const f = this.fragmentState;
        const m = mapGetMap(f.packageNeighborListeners, k);
        if (!m.has(id)) {
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
     * The key, the token, the node and the string must together uniquely determine the function.
     */
    addForAllAncestorsConstraint(t: ObjectPropertyVarObj,
                                 key: TokenListener.READ_ANCESTORS | TokenListener.ASSIGN_ANCESTORS | TokenListener.CALL_FUNCTION_ANCESTORS,
                                 opts: Omit<ListenerKey, "l" | "t">, listener: (ancestor: Token) => void) {
        if (logger.isDebugEnabled())
            logger.debug(`Adding ancestors constraint to ${t} ${opts.n ? `at ${nodeToString(opts.n)}` : `${TokenListener[key]} ${opts.s}`}`);
        const id = this.getListenerID({...opts, l: key, t});
        this.callTokenListener(id, listener, t); // ancestry is reflexive
        this.addForAllTokensConstraintPrivate(
            this.fragmentState.getRepresentative(this.varProducer.ancestorsVar(t)),
            id, listener,
        );
    }

    /*
     * Adds an inheritance relation and notifies listeners.
     */
    addInherits(child: ObjectPropertyVarObj, parent: Token | ConstraintVar) {
        if (child === parent)
            return;
        const f = this.fragmentState;
        if (logger.isDebugEnabled())
            logger.debug(`Adding inheritance relation ${child} -> ${parent}`);
        const dst = f.getRepresentative(f.varProducer.objPropVar(child, INTERNAL_PROTOTYPE()));
        if (parent instanceof Token)
            this.addToken(parent, dst);
        else
            this.addSubsetEdge(f.getRepresentative(parent), dst);
    }

    /**
     * Adds a quantified constraint for all explicit numeric properties of the given array.
     * The triple consisting of the token, the key, and the node must together uniquely determine the function (including its free variables).
     */
    addForAllArrayEntriesConstraint(t: ArrayToken, key: TokenListener, n: Node, listener: (prop: string) => void) {
        if (logger.isDebugEnabled())
            logger.debug(`Adding array entries constraint #${TokenListener[key]} to ${t} at ${locationToStringWithFileAndEnd(n.loc)}`);
        const id = this.getListenerID({l: key, n});
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
        // TODO: it would be beneficial (for precision and performance) if we could track _own_ properties of objects
        // (because that's actually what we want to range over with these constraints).
        // currently we treat all properties that are read as own properties, even if the read happens on a descendant object
        if (logger.isDebugEnabled())
            logger.debug(`Adding object properties constraint #${TokenListener[key]} to ${t} at ${locationToStringWithFileAndEnd(n.loc)}`);
        const id = this.getListenerID({l: key, n});
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
                for (const p of ps)
                    if (!isInternalProperty(p)) {
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
            if (propagate && !isInternalProperty(prop)) {
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
            if (prop === INTERNAL_PROTOTYPE()) {
                // constraint: ∀ b ∈ ⟦a.__proto__⟧: {b} ∪ Ancestors(b) ⊆ Ancestors(a)
                this.addForAllTokensConstraint(f.varProducer.objPropVar(a, prop), TokenListener.ANCESTORS, {t: a}, (b: Token) => {
                    if (isObjectPropertyVarObj(b)) { // TODO: ignoring inheritance from access path tokens
                        const aVar = this.varProducer.ancestorsVar(a);
                        this.addTokenConstraint(b, aVar);
                        this.addSubsetConstraint(this.varProducer.ancestorsVar(b), aVar);
                    }
                });
            }
        }
    }

    /**
     * Collects property read operations.
     * @param typ the type of the property read operation
     * @param result the constraint variable for the result of the property read operation
     * @param base the constraint variable for the base expression
     * @param pck the current package object token
     * @param prop the property name
     * @param node the AST node for the property read operation
     * @param enclosing enclosing function or module
     */
    collectPropertyRead(
        typ: "read" | "call", result: ConstraintVar | undefined, base: ConstraintVar | undefined,
        pck: PackageObjectToken, prop: string | undefined, node: Node, enclosing: FunctionInfo | ModuleInfo,
    ) { // TODO: rename to registerPropertyRead, move to FragmentState
        if (typ === "read" && result && base)
            this.fragmentState.maybeEmptyPropertyReads.push({typ, result, base, pck, prop});
        else if (typ === "call" && base && prop)
            // call with @Unknown already happens when prop is undefined, so we only need to register
            // the property read for patching if the property is known
            this.fragmentState.maybeEmptyPropertyReads.push({typ, base, prop});
        if (base && prop && prop !== "prototype")
            this.fragmentState.propertyReads.add({base, prop, node, enclosing});
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
            const s = f.subsetEdges.get(v);
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
                f.warn("Fixpoint round limit reached, aborting propagation");
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
                for (const [fun, arg] of calls) {
                    fun(arg as any);
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
            const svs = s.subsetEdges.get(v);
            if (propagate) {
                // run new token listeners on existing tokens
                if (ntr)
                    for (const t of f.getTokens(vRep))
                        for (const [id, listener] of ntr)
                            this.callTokenListener(id, listener, t);
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
        addAll(s.propertyReads, f.propertyReads);
        f.maybeEmptyPropertyReads.push(...s.maybeEmptyPropertyReads);
        addAll(s.dynamicPropertyWrites, f.dynamicPropertyWrites);
        this.printDiagnostics();
    }
}
