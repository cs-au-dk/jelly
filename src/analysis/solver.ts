import {
    ConstraintVar,
    IntermediateVar,
    isObjectPropertyVarObj,
    NodeVar,
    ObjectPropertyVar,
    ObjectPropertyVarObj
} from "./constraintvars";
import logger, {GREY, isTTY, RESET, writeStdOut} from "../misc/logger";
import {
    AccessPathToken,
    AllocationSiteToken,
    ArrayToken,
    FunctionToken,
    NativeObjectToken,
    ObjectToken,
    PrototypeToken,
    Token
} from "./tokens";
import {GlobalState} from "./globalstate";
import {
    getNodeHash,
    isArrayIndex,
    locationToStringWithFileAndEnd,
    mapGetMap,
    mapGetSet,
    nodeToString,
    pushArraySingle,
    strHash,
} from "../misc/util";
import assert from "assert";
import {
    AccessPath,
    CallResultAccessPath,
    ComponentAccessPath,
    IgnoredAccessPath,
    ModuleAccessPath,
    PropertyAccessPath,
    UnknownAccessPath
} from "./accesspaths";
import {isAssignmentExpression, isNode, Node} from "@babel/types";
import {FragmentState, ListenerID, PostponedListenerCall, RepresentativeVar} from "./fragmentstate";
import {TokenListener} from "./listeners";
import {nuutila} from "../misc/scc";
import {options, patternProperties} from "../options";
import Timer, {nanoToMs} from "../misc/timer";
import {setImmediate} from "timers/promises";
import {getMemoryUsage} from "../misc/memory";
import AnalysisDiagnostics from "./diagnostics";
import {
    ARRAY_PROTOTYPE,
    ARRAY_UNKNOWN,
    DATE_PROTOTYPE,
    ERROR_PROTOTYPE,
    FUNCTION_PROTOTYPE,
    INTERNAL_PROTOTYPE,
    isInternalProperty,
    MAP_PROTOTYPE,
    OBJECT_PROTOTYPE,
    PROMISE_PROTOTYPE,
    REGEXP_PROTOTYPE,
    SET_PROTOTYPE,
    WEAKMAP_PROTOTYPE,
    WEAKREF_PROTOTYPE,
    WEAKSET_PROTOTYPE
} from "../natives/ecmascript";
import {ConstraintVarProducer} from "./constraintvarproducer";
import {FunctionInfo, ModuleInfo} from "./infos";

/**
 * Only perform cycle elimination if at least this number of subset edges.
 */
const CYCLE_ELIMINATION_MINIMUM = 100;

/**
 * Only perform cycle elimination if at least this increase in number of subset edges since last run.
 */
const CYCLE_ELIMINATION_FACTOR = 1.2;

export class AbortedException extends Error {}

export type ListenerKey = {l: TokenListener, n?: Node, t?: Token, s?: string};

export type Phase = "Initializing" | "Analyzing" | "Escape patching" | "Approximate patching" | "Extra patching" | "Testing";

export default class Solver {

    readonly globalState: GlobalState = new GlobalState;

    readonly fragmentState: FragmentState = new FragmentState(this);

    get varProducer(): ConstraintVarProducer {
        return this.fragmentState.varProducer;
    }

    readonly unprocessedTokens: Map<RepresentativeVar, Array<Token> | Token> = new Map;

    readonly listeners: Map<ListenerID, ListenerKey> = new Map; // XXX: move to property of the listener function? (would enable GC'ing)

    readonly diagnostics = new AnalysisDiagnostics;

    readonly abort?: () => boolean;

    propagationsThrottled: number = 0;

    postponedListenersProcessed: number = 0;

    phase: Phase | undefined;

    readonly timer = new Timer();

    constructor(abort?: () => boolean) {
        this.abort = abort;
    }

    updateDiagnostics() {
        const a = this.globalState;
        const f = this.fragmentState;
        const d = this.diagnostics;
        d.functions = a.functionInfos.size;
        d.vars = f.getNumberOfVarsWithTokens();
        d.listeners = f.tokenListeners.totalSize() + f.tokenListeners2.totalSize() +
            f.arrayEntriesListeners.totalSize() + f.objectPropertiesListeners.totalSize();
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
     * Enqueues a (non-bounded) listener call consisting of a listener and its argument(s).
     */
    private enqueueListenerCall(la: PostponedListenerCall) {
        this.fragmentState.postponedListenerCalls.push(la);
    }

    /**
     * Enqueues a (bounded) listener call consisting of a listener and its argument(s).
     */
    private enqueueListenerCall2(la: PostponedListenerCall) {
        this.fragmentState.postponedListenerCalls2.push(la);
    }

    /**
     * Adds a single token if not already present.
     * Also enqueues notification of listeners and registers object properties and array entries from the constraint variable.
     */
    addToken(t: Token, toRep: RepresentativeVar): boolean {
        const f = this.fragmentState;
        if (f.addToken(t, toRep)) {
            f.vars.add(toRep);
            this.tokenAdded(toRep, t);
            return true;
        }
        return false;
    }

    /**
     * Adds a set of tokens if not already present.
     * Also adds to worklist and notifies listeners.
     */
    private addTokens(ts: Iterable<Token> | Token, toRep: RepresentativeVar) {
        const f = this.fragmentState;
        f.vars.add(toRep);
        if (ts instanceof Token) {
            if (f.addToken(ts, toRep))
                this.tokenAdded(toRep, ts);
        } else {
            let ws: Array<Token> | Token | undefined = undefined;
            for (const t of f.addTokens(ts, toRep))
                ws = this.tokenAdded(toRep, t, ws);
        }
    }

    private tokenAdded(
        toRep: RepresentativeVar,
        t: Token,
        ws?: Array<Token> | Token
    ): Array<Token> | Token | undefined {
        if (logger.isDebugEnabled())
            logger.debug(`Added token ${t} to ${toRep}`);
        if (logger.isVerboseEnabled()) {
            assert(!this.fragmentState.redirections.has(toRep));
            assert(!this.isIgnoredVar(toRep));
        }
        if (!ws)
            ws = this.unprocessedTokens.get(toRep);
        // add to worklist
        ws = pushArraySingle(this.unprocessedTokens, toRep, t, ws);
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
     * @param node  AST node (for pattern matcher)
     * @param encl  enclosing function (for pattern matcher)
     * @param subap access path of the sub-expression (for call or property access expressions)
     */
    addAccessPath(ap: AccessPath, to: ConstraintVar | undefined, node?: Node, encl?: FunctionInfo | ModuleInfo, subap?: AccessPath) { // TODO: store access paths separately from other tokens?
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
        if (!(ap2 instanceof UnknownAccessPath || ap2 instanceof IgnoredAccessPath) &&
            (to instanceof NodeVar || (to instanceof IntermediateVar && to.label === "import"))) {
            assert(node !== undefined && encl !== undefined);
            if (ap2 instanceof ModuleAccessPath)
                mapGetMap(f.moduleAccessPaths, ap2).set(node, encl);
            else if (ap2 instanceof PropertyAccessPath)
                mapGetMap(mapGetMap(asn ? f.propertyWriteAccessPaths : f.propertyReadAccessPaths, subap!), ap2.prop).set(node, {bp: ap2, sub: ap2.base, encl});
            else if (ap2 instanceof CallResultAccessPath)
                mapGetMap(f.callResultAccessPaths, subap!).set(node, {bp: ap2, sub: ap2.caller, encl});
            else if (ap2 instanceof ComponentAccessPath)
                mapGetMap(f.componentAccessPaths, subap!).set(node, {bp: ap2, sub: ap2.component, encl});
            else
                assert.fail("Unexpected AccessPath");
        }
    }

    /**
     * Reports diagnostics periodically (only if print progress is enabled, stdout is tty, and log level is "info").
     */
    private printDiagnostics() {
        if (options.printProgress && options.tty && isTTY && !options.logfile && logger.level === "info") {
            const d = Number(this.timer.elapsed() / 1000000n);
            if (d > this.diagnostics.lastPrintDiagnosticsTime + 100) { // only report every 100ms
                this.diagnostics.lastPrintDiagnosticsTime = d;
                // const a = this.globalState;
                const f = this.fragmentState;
                writeStdOut(`${this.phase}... ` +
                    // `packages: ${a.packageInfos.size}, modules: ${a.moduleInfos.size}, ` +
                    `(total time: ${d}ms, call edges: ${f.numberOfCallToFunctionEdges}` +
                    (options.diagnostics ? `, vars: ${f.getNumberOfVarsWithTokens()}, tokens: ${f.numberOfTokens}, subsets: ${f.numberOfSubsetEdges}, ` +
                        (options.maxIndirections !== undefined ? `round: ${this.diagnostics.round}, ` : "") +
                        `wave: ${this.diagnostics.wave}, ` +
                    `propagations: ${this.diagnostics.propagations}, worklist: ${this.diagnostics.unprocessedTokensSize+f.postponedListenerCalls.length+f.postponedListenerCalls2.length-this.postponedListenersProcessed}` : "") +
                    ")");
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
        if (this.isIgnoredVar(from) || this.isIgnoredVar(to))
            return;
        if (logger.isDebugEnabled())
            logger.debug(`Adding constraint ${from} \u2286 ${to}`);
        const f = this.fragmentState;
        this.addSubsetEdge(f.getRepresentative(from), f.getRepresentative(to));
    }

    addSubsetEdge(fromRep: RepresentativeVar, toRep: RepresentativeVar) {
        if (fromRep !== toRep) {
            const f = this.fragmentState;
            const s = f.subsetEdges.getSet(fromRep);
            if (!s.has(toRep)) {
                // add the edge
                s.add(toRep);
                f.numberOfSubsetEdges++;
                f.reverseSubsetEdges.getSet(toRep).add(fromRep);
                if (logger.isVerboseEnabled())
                    assert(!f.redirections.has(fromRep) && !f.redirections.has(toRep));
                f.vars.add(fromRep);
                f.vars.add(toRep);
                // propagate tokens
                const [size, ts] = this.fragmentState.getTokensSize(fromRep);
                if (size > 0) {
                    if (logger.isDebugEnabled())
                        logger.debug(`Worklist size: ${this.diagnostics.unprocessedTokensSize}, propagating ${size} token${size !== 1 ? "s" : ""} from ${fromRep}`);
                    this.addTokens(ts, toRep);
                    this.incrementPropagations();
                }
                if (options.cycleElimination)
                    f.nodesWithNewEdges.add(fromRep);
            }
        }
    }

    private checkListenerIDCollision(id: ListenerID, key: ListenerKey) {
        const x = this.listeners.get(id);
        if (x) {
            if (x.l !== key.l || x.n !== key.n || x.t !== key.t || x.s !== key.s) {
                const format = (x: ListenerKey) =>
                    `(${TokenListener[x.l] ?? ""}${x.t ?? ""},${x.s ?? ""},${x.n ? nodeToString(x.n) : ""},${x.n ? ` at ${locationToStringWithFileAndEnd(x.n.loc)}` : ""}`;
                logger.error(`Error: Hash collision in getListenerID ${id}: ${format(x)} != ${format(key)}`); // TODO: hash collision possible
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
            id += getNodeHash(key.n);
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
        this.addForAllTokensConstraintPrivate(vRep, this.getListenerID(lkey), key, listener);
    }

    private addForAllTokensConstraintPrivate(vRep: RepresentativeVar, id: ListenerID, key: TokenListener, listener: (t: Token) => void): boolean {
        if (this.isIgnoredVar(vRep))
            return false;
        const f = this.fragmentState;
        let bound = false;
        if (options.maxIndirections !== undefined)
            switch (key) {
                case TokenListener.CALL_FUNCTION:
                case TokenListener.WRITE_BASE:
                case TokenListener.WRITE_BASE_DYNAMIC:
                    bound = true;
                    break;
                default:
                    if (options.fullIndirectionBounding)
                        switch (key) {
                            case TokenListener.CALL_METHOD:
                            case TokenListener.READ_BASE:
                            case TokenListener.READ_BASE_DYNAMIC:
                                bound = true;
                                break;
                        }
                    break;
            }
        const m = (bound ? f.tokenListeners2 : f.tokenListeners).getMap(vRep);
        if (!m.has(id)) {
            // run listener on all existing tokens
            if (bound)
                for (const t of f.getTokens(vRep))
                    this.callTokenListener2(id, listener, t);
            else
                for (const t of f.getTokens(vRep))
                    this.callTokenListener(id, listener, t);
            // register listener for future tokens
            m.set(id, listener);
            f.vars.add(vRep);
            return true;
        }
        return false;
    }

    /**
     * Enqueues a call to a (non-bounded) token listener if it hasn't been done before.
     */
    private callTokenListener(id: ListenerID, listener: (t: Token) => void, t: Token, now?: boolean) {
        const s = mapGetSet(this.fragmentState.listenersProcessed, id);
        if (!s.has(t)) {
            s.add(t);
            if (now)
                listener(t);
            else {
                this.enqueueListenerCall([listener, t]);
                this.diagnostics.tokenListenerNotifications++;
            }
        }
    }

    /**
     * Enqueues a call to a (bounded) token listener if it hasn't been done before.
     */
    private callTokenListener2(id: ListenerID, listener: (t: Token) => void, t: Token) { // FIXME: no longer ignoring bounded listeners in module phase!!
        const s = mapGetSet(this.fragmentState.listenersProcessed, id);
        if (!s.has(t)) {
            s.add(t);
            this.enqueueListenerCall2([listener, t]);
            this.diagnostics.tokenListener2Notifications++;
        }
    }

    /**
     * Adds a quantified constraint for all ancestors (reflexive and transitive) of the given token.
     * The key, the token, the node and the string must together uniquely determine the function.
     */
    addForAllAncestorsConstraint(t: ObjectPropertyVarObj,
                                 key: TokenListener.READ_ANCESTORS | TokenListener.WRITE_ANCESTORS,
                                 opts: Omit<ListenerKey, "l" | "t">, listener: (ancestor: Token) => void) {
        if (logger.isDebugEnabled())
            logger.debug(`Adding ancestors constraint to ${t} ${opts.n ? `at ${nodeToString(opts.n)}` : `${TokenListener[key]} ${opts.s}`}`);
        const id = this.getListenerID({...opts, l: key, t});
        const anc = this.fragmentState.getRepresentative(this.varProducer.ancestorsVar(t));
        if (this.addForAllTokensConstraintPrivate(anc, id, key, listener)) {
            this.callTokenListener(id, listener, t, true); // ancestry is reflexive
            const g = this.globalState.globalSpecialNatives;
            if (g) { // (not set when called from unit tests)
                if (t instanceof ObjectToken || t instanceof PrototypeToken)
                    this.callTokenListener(id, listener, g[OBJECT_PROTOTYPE]);
                else if (t instanceof ArrayToken) {
                    this.callTokenListener(id, listener, g[ARRAY_PROTOTYPE]);
                    this.callTokenListener(id, listener, g[OBJECT_PROTOTYPE]);
                } else if (t instanceof FunctionToken) {
                    this.callTokenListener(id, listener, g[FUNCTION_PROTOTYPE]);
                    this.callTokenListener(id, listener, g[OBJECT_PROTOTYPE]);
                } else if (t instanceof AllocationSiteToken) {
                    if (t.kind === "Promise")
                        this.callTokenListener(id, listener, g[PROMISE_PROTOTYPE]);
                    else if (t.kind === "Date")
                        this.callTokenListener(id, listener, g[DATE_PROTOTYPE]);
                    else if (t.kind === "RegExp")
                        this.callTokenListener(id, listener, g[REGEXP_PROTOTYPE]);
                    else if (t.kind === "Error")
                        this.callTokenListener(id, listener, g[ERROR_PROTOTYPE]);
                    else if (t.kind === "Map")
                        this.callTokenListener(id, listener, g[MAP_PROTOTYPE]);
                    else if (t.kind === "Set")
                        this.callTokenListener(id, listener, g[SET_PROTOTYPE]);
                    else if (t.kind === "WeakMap")
                        this.callTokenListener(id, listener, g[WEAKMAP_PROTOTYPE]);
                    else if (t.kind === "WeakSet")
                        this.callTokenListener(id, listener, g[WEAKSET_PROTOTYPE]);
                    else if (t.kind === "WeakRef")
                        this.callTokenListener(id, listener, g[WEAKREF_PROTOTYPE]);
                    else if (t.kind === "PromiseResolve" || t.kind === "PromiseReject")
                        this.callTokenListener(id, listener, g[FUNCTION_PROTOTYPE]);
                    this.callTokenListener(id, listener, g[OBJECT_PROTOTYPE]);
                }
            }
        }
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
            logger.debug(`Adding array entries constraint #${TokenListener[key]} to ${t}`);
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
        const m = f.arrayEntriesListeners.getMap(t);
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
     * Adds an array numeric property and notifies listeners.
     * Non-numeric properties are ignored.
     */
    addArrayEntry(a: ArrayToken, prop: string) {
        if (!isArrayIndex(prop))
            return;
        const f = this.fragmentState;
        const ps = f.arrayEntries.getSet(a);
        if (!ps.has(prop)) {
            if (logger.isDebugEnabled())
                logger.debug(`Adding array entry ${a}[${prop}]`);
            ps.add(prop);
            const ts = f.arrayEntriesListeners.get(a);
            if (ts)
                for (const listener of ts.values()) {
                    this.enqueueListenerCall([listener, prop]);
                    this.diagnostics.arrayEntriesListenerNotifications++;
                }
            // add flow to summary var
            this.addSubsetEdge(
                f.getRepresentative(f.varProducer.objPropVar(a, prop)),
                f.getRepresentative(f.varProducer.arrayAllVar(a))
            );
        }
    }

    /**
     * Adds a quantified constraint for all properties of the given object.
     * The triple consisting of the token, the key, and the node must together uniquely determine the function (including its free variables).
     */
    addForAllObjectPropertiesConstraint(t: ObjectPropertyVarObj, key: TokenListener, n: Node, listener: (prop: string) => void) {
        // TODO: it would be beneficial (for precision and performance) if we could track _own_ properties of objects
        // (because that's actually what we want to range over with these constraints).
        // currently we treat all properties that are read as own properties, even if the read happens on a descendant object
        if (logger.isDebugEnabled())
            logger.debug(`Adding object properties constraint #${TokenListener[key]} to ${t}`);
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
        const m = f.objectPropertiesListeners.getMap(t);
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
     * Adds an object property and notifies listeners.
     */
    addObjectProperty(a: ObjectPropertyVarObj, prop: string) {
        const f = this.fragmentState;
        const ps = f.objectProperties.getSet(a);
        if (!ps.has(prop)) {
            if (logger.isDebugEnabled())
                logger.debug(`Adding object property ${a}.${prop}`);
            ps.add(prop);
            if (!isInternalProperty(prop)) {
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
                    f.getRepresentative(f.varProducer.arrayAllVar(a))
                );
            if (prop === INTERNAL_PROTOTYPE()) {
                // constraint: ∀ b ∈ ⟦a.__proto__⟧: {b} ∪ Ancestors(b) ⊆ Ancestors(a)
                this.addForAllTokensConstraint(f.varProducer.objPropVar(a, prop), TokenListener.ANCESTORS, {t: a}, (b: Token) => {
                    const aVar = this.varProducer.ancestorsVar(a);
                    this.addTokenConstraint(b, aVar);
                    if (isObjectPropertyVarObj(b))
                        this.addSubsetConstraint(this.varProducer.ancestorsVar(b), aVar);
                });
            }
        }
    }

    /**
     * Redirects constraint variable.
     * Updates the subset edges and listeners, and propagates worklist tokens along redirected edges.
     * Assumes that there is a subset path from v to rep.
     *
     * The caller should carefully observe that once the function returns, v is likely not a representative
     * anymore, but v's type will not reflect this fact.
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
        f.nodesWithNewEdges.delete(v);
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
        const repOut = f.subsetEdges.getSet(rep);
        const repIn = f.reverseSubsetEdges.getSet(rep);
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
            const qr = f.tokenListeners.getMap(rep);
            for (const [k, listener] of tr)
                if (!qr.has(k)) {
                    qr.set(k, listener);
                    for (const t of rts)
                        this.callTokenListener(k, listener, t);
                }
            f.tokenListeners.delete(v);
        }
        const tr2 = f.tokenListeners2.get(v);
        if (tr2) {
            const qr = f.tokenListeners2.getMap(rep);
            for (const [k, listener] of tr2)
                if (!qr.has(k)) {
                    qr.set(k, listener);
                    for (const t of rts)
                        this.callTokenListener2(k, listener, t);
                }
            f.tokenListeners2.delete(v);
        }
        assert(!this.unprocessedTokens.has(v));
        f.vars.delete(v);
    }

    /**
     * Processes the items in the token worklist for the given constraint variable.
     */
    processTokens(v: RepresentativeVar) {
        const ts = this.unprocessedTokens.get(v);
        if (ts !== undefined) {
            const size = Array.isArray(ts) ? ts.length : 1;
            if (logger.isDebugEnabled())
                logger.debug(`Worklist size: ${this.diagnostics.unprocessedTokensSize}, propagating ${size} token${size !== 1 ? "s" : ""} from ${v}`);
            this.unprocessedTokens.delete(v);
            this.diagnostics.unprocessedTokensSize -= size;
            // propagate new tokens to successors
            const f = this.fragmentState;
            assert(f.vars.has(v));
            const s = f.subsetEdges.get(v);
            if (s) {
                for (const to of s)
                    this.addTokens(ts, to);
                this.incrementPropagations();
            }
            // notify listeners
            const tr = f.tokenListeners.get(v);
            if (tr)
                if (Array.isArray(ts))
                    for (const t of ts)
                        for (const [id, listener] of tr)
                            this.callTokenListener(id, listener, t);
                else
                    for (const [id, listener] of tr)
                        this.callTokenListener(id, listener, ts);
            const trc = f.tokenListeners2.get(v);
            if (trc)
                if (Array.isArray(ts))
                    for (const t of ts)
                        for (const [id, listener] of trc)
                            this.callTokenListener2(id, listener, t);
                else
                    for (const [id, listener] of trc)
                        this.callTokenListener2(id, listener, ts);
        }
    }

    incrementPropagations() {
        this.diagnostics.propagations++;
        if (this.diagnostics.propagations % 100 === 0) {
            this.globalState.timeoutTimer.checkTimeout();
            this.printDiagnostics();
        }
    }

    /**
     * Checks whether the given constraint variable represents
     * a getter/setter for a global native object.
     */
    isIgnoredVar(v: ConstraintVar): boolean {
        return v instanceof ObjectPropertyVar && v.obj instanceof NativeObjectToken && !v.obj.moduleInfo && (v.accessor === "get" || v.accessor === "set");
    }

    /**
     * Processes all items in the worklist until a fixpoint is reached.
     * This notifies listeners and propagates tokens along subset edges.
     */
    async propagate(phase: Phase) {
        this.phase = phase;
        if (logger.isDebugEnabled())
            logger.debug("Processing constraints until fixpoint...");
        const f = this.fragmentState;
        f.a.timeoutTimer.checkTimeout();
        await this.checkAbort();
        if (logger.isVerboseEnabled())
            logger.verbose(`Propagating (tokens: ${this.unprocessedTokens.size}, non-bounded: ${f.postponedListenerCalls.length}, bounded: ${f.postponedListenerCalls2.length})`);
        let wave = 1, round = 1;
        while (this.unprocessedTokens.size > 0 || f.postponedListenerCalls.length > 0 || f.postponedListenerCalls2.length > 0) {
            this.diagnostics.wave = wave;
            this.diagnostics.round = round;
            if (logger.isVerboseEnabled())
                logger.verbose(`Fixpoint wave: ${wave} (call edges: ${f.numberOfCallToFunctionEdges}, vars: ${f.getNumberOfVarsWithTokens()}, tokens: ${f.numberOfTokens}, subsets: ${f.numberOfSubsetEdges})`);
            if (options.maxWaves !== undefined && wave > options.maxWaves) {
                f.warn("Fixpoint wave limit reached, aborting propagation");
                this.diagnostics.waveLimitReached++;
                this.diagnostics.unprocessedTokensSize = 0;
                this.unprocessedTokens.clear();
                f.nodesWithNewEdges.clear();
                f.postponedListenerCalls.length = 0;
                break;
            }
            if (this.unprocessedTokens.size > 0) {
                if (options.cycleElimination && f.numberOfSubsetEdges >= CYCLE_ELIMINATION_MINIMUM && f.numberOfSubsetEdges >= f.prevNumEdges * CYCLE_ELIMINATION_FACTOR) {
                    // find vars that are end points of new subset edges
                    const nodes = new Set<RepresentativeVar>();
                    for (const v of f.nodesWithNewEdges)
                        nodes.add(f.getRepresentative(v));
                    if (nodes.size > 0) {
                        // find strongly connected components
                        const edgesBefore = f.numberOfSubsetEdges;
                        const timer1 = new Timer();
                        const [reps, repmap] = nuutila(nodes, (v: RepresentativeVar) => f.subsetEdges.get(v)); // TODO: only consider new edges for entry nodes?
                        if (logger.isVerboseEnabled())
                            logger.verbose(`Cycle detection roots: ${nodes.size}, components: ${reps.length}`);
                        // cycle elimination
                        for (const [v, rep] of repmap)
                            this.redirect(v, rep); // TODO: this includes processing pending edges and tokens for v, which may be unnecessary?
                        f.prevNumEdges = f.numberOfSubsetEdges;
                        this.diagnostics.totalCycleEliminationTime += timer1.elapsed();
                        this.diagnostics.totalCycleEliminationRuns++;
                        if (logger.isVerboseEnabled())
                            logger.verbose(`Cycle detection roots: ${nodes.size} roots, edges: ${edgesBefore} -> ${f.numberOfSubsetEdges} (${nanoToMs(timer1.elapsed())})`);
                        const timer2 = new Timer();
                        // process new tokens for the component representatives in topological order
                        if (logger.isVerboseEnabled())
                            logger.verbose(`Processing ${this.diagnostics.unprocessedTokensSize} new token${this.diagnostics.unprocessedTokensSize !== 1 ? "s" : ""}`);
                        try {
                            for (let i = reps.length - 1; i >= 0; i--) {
                                const v = reps[i];
                                this.processTokens(v);
                                await this.checkAbort(true);
                            }
                        } finally {
                            this.diagnostics.totalPropagationTime += timer2.elapsed();
                        }
                        f.nodesWithNewEdges.clear();
                    }
                    // process remaining tokens outside the sub-graph reachable via the new edges
                    const timer3 = new Timer();
                    for (const v of this.unprocessedTokens.keys())
                        this.processTokens(v);
                    this.diagnostics.totalPropagationTime += timer3.elapsed();
                } else {
                    // process all tokens in worklist until empty
                    if (logger.isVerboseEnabled())
                        logger.verbose(`Processing ${this.diagnostics.unprocessedTokensSize} new token${this.diagnostics.unprocessedTokensSize !== 1 ? "s" : ""}`);
                    const timer = new Timer();
                    try {
                        for (const v of this.unprocessedTokens.keys()) {
                            this.processTokens(v);
                            await this.checkAbort(true);
                        }
                    } finally {
                        this.diagnostics.totalPropagationTime += timer.elapsed();
                    }
                }
            }
            if (this.unprocessedTokens.size !== 0 || this.diagnostics.unprocessedTokensSize !== this.unprocessedTokens.size)
                assert.fail(`worklist non-empty: unprocessedTokens.size: ${this.unprocessedTokens.size}, unprocessedTokensSize: ${this.diagnostics.unprocessedTokensSize}`);
            if (f.postponedListenerCalls.length > 0) {
                // process all enqueued non-bounded listener calls (including those created during the processing)
                if (logger.isVerboseEnabled())
                    logger.verbose(`Processing non-bounded listener calls: ${f.postponedListenerCalls.length}`);
                const timer = new Timer();
                this.diagnostics.listenerNotificationRounds++;
                try {
                    for (const [fun, arg] of f.postponedListenerCalls) {
                        fun(arg as any);
                        if (++this.postponedListenersProcessed % 100 === 0) {
                            f.a.timeoutTimer.checkTimeout();
                            this.printDiagnostics();
                        }
                    }
                } finally {
                    this.diagnostics.totalListenerCallTime += timer.elapsed();
                }
                f.postponedListenerCalls.length = this.postponedListenersProcessed = 0;
            } else if (f.postponedListenerCalls2.length > 0) {
                if (options.maxIndirections !== undefined && round > options.maxIndirections) {
                    this.diagnostics.indirectionsLimitReached++;
                    this.diagnostics.unprocessedTokensSize = 0;
                    this.unprocessedTokens.clear();
                    f.nodesWithNewEdges.clear();
                    f.postponedListenerCalls.length = 0;
                    f.postponedListenerCalls2.length = 0;
                } else {
                    // process all enqueued bounded listener calls (excluding those created during the processing)
                    if (logger.isVerboseEnabled())
                        logger.verbose(`Processing bounded listener calls: ${f.postponedListenerCalls2.length}`);
                    const timer = new Timer();
                    this.diagnostics.listenerNotificationRounds++;
                    const calls = Array.from(f.postponedListenerCalls2);
                    f.postponedListenerCalls2.length = this.postponedListenersProcessed = 0;
                    try {
                        for (const [fun, args] of calls) {
                            (fun as Function).apply(undefined, Array.isArray(args) ? args : [args]);
                            if (++this.postponedListenersProcessed % 100 === 0) {
                                f.a.timeoutTimer.checkTimeout();
                                this.printDiagnostics();
                            }
                        }
                    } finally {
                        this.diagnostics.totalListenerCallTime += timer.elapsed();
                    }
                    if (logger.isVerboseEnabled() || (options.diagnostics && options.printProgress))
                        logger.info(`${isTTY ? GREY : ""}Round ${round} completed after ${nanoToMs(this.timer.elapsed())} (call edges: ${f.numberOfCallToFunctionEdges}, vars: ${f.getNumberOfVarsWithTokens()}, tokens: ${f.numberOfTokens}, subsets: ${f.numberOfSubsetEdges})${isTTY ? RESET : ""}`);
                    round++;
                }
            }
            if (logger.isVerboseEnabled())
                logger.verbose(`Wave ${wave} completed after ${nanoToMs(this.timer.elapsed())}`);
            wave++;
        }
        if (logger.isVerboseEnabled() || (options.diagnostics && options.printProgress))
            logger.info(`${isTTY ? GREY : ""}${phase} completed after ${nanoToMs(this.timer.elapsed())} (call edges: ${f.numberOfCallToFunctionEdges}, vars: ${f.getNumberOfVarsWithTokens()}, tokens: ${f.numberOfTokens}, subsets: ${f.numberOfSubsetEdges})${isTTY ? RESET : ""}`);
        if (this.diagnostics.unprocessedTokensSize !== 0)
            assert.fail(`unprocessedTokensSize non-zero after propagate: ${this.diagnostics.unprocessedTokensSize}`);
    }

    async checkAbort(throttle: boolean = false) {
        if (this.abort) {
            if (throttle) {
                if (this.diagnostics.propagations < this.propagationsThrottled + 10000)
                    return;
                this.propagationsThrottled = this.diagnostics.propagations;
            }
            await setImmediate(); // gives the server a chance to process abort requests
            if (this.abort()) {
                logger.verbose("Abort signal received");
                throw new AbortedException();
            }
        }
    }
}
