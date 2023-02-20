import {ConstraintVar, ObjectPropertyVarObj} from "./constraintvars";
import {AllocationSiteToken, ArrayToken, FunctionToken, Token} from "./tokens";
import {PackageInfo} from "./infos";
import {Node} from "@babel/types";
import assert from "assert";

export type ListenerID = number;

/**
 * Analysis state for a fragment (a module or a package with dependencies, depending on the analysis phase).
 */
export class FragmentState {

    /**
     * The current analysis solution.
     * Singleton sets are represented as plain references, larger sets are represented as ES2015 sets.
     */
    private readonly tokens: Map<ConstraintVar, Token | Set<Token>> = new Map;

    /**
     * The set of constraint variables (including those with no tokens or no subset edges, but excluding those that are redirected).
     */
    readonly vars: Set<ConstraintVar> = new Set;

    /**
     * Indirection introduced by cycle elimination.
     */
    readonly redirections: Map<ConstraintVar, ConstraintVar> = new Map;

    /**
     * Number of tokens for the currently analyzed fragment. (For statistics only.)
     */
    numberOfTokens: number = 0;

    numberOfSubsetEdges: number = 0;

    readonly subsetEdges: Map<ConstraintVar, Set<ConstraintVar>> = new Map;

    readonly reverseSubsetEdges: Map<ConstraintVar, Set<ConstraintVar>> = new Map; // (used by solver.redirect)

    /**
     * Inheritance relation. For each token, the map provides the tokens it may inherit from directly.
     */
    inherits: Map<Token, Set<Token>> = new Map;

    reverseInherits: Map<Token, Set<Token>> = new Map;

    readonly arrayEntries: Map<ArrayToken, Set<string>> = new Map;

    objectProperties: Map<ObjectPropertyVarObj, Set<string>> = new Map;

    readonly tokenListeners: Map<ConstraintVar, Map<ListenerID, (t: Token) => void>> = new Map;

    readonly pairListeners1: Map<ConstraintVar, Map<ListenerID, [ConstraintVar, (t1: AllocationSiteToken, t2: FunctionToken) => void]>> = new Map;

    readonly pairListeners2: Map<ConstraintVar, Map<ListenerID, [ConstraintVar, (t1: AllocationSiteToken, t2: FunctionToken) => void]>> = new Map;

    readonly pairListenersProcessed: Map<ListenerID, Map<AllocationSiteToken, Set<FunctionToken>>> = new Map;

    readonly packageNeighborListeners: Map<PackageInfo, Map<Node, (neighbor: PackageInfo) => void>> = new Map;

    ancestorListeners: Map<Token, Map<Node, (descendant: Token) => void>> = new Map;

    readonly ancestorListenersProcessed: Map<Node, Set<Token>> = new Map; // TODO: make similar map/set for other kinds of listeners to avoid redundant listener calls?

    readonly arrayEntriesListeners: Map<ArrayToken, Map<ListenerID, (prop: string) => void>> = new Map;

    objectPropertiesListeners: Map<ObjectPropertyVarObj, Map<ListenerID, (prop: string) => void>> = new Map;

    readonly packageNeighbors: Map<PackageInfo, Set<PackageInfo>> = new Map;

    readonly postponedListenerCalls: Array<[(t: Token) => void, Token] | [(t1: AllocationSiteToken, t2: FunctionToken) => void, [AllocationSiteToken, FunctionToken]] | [(neighbor: PackageInfo) => void, PackageInfo] | [(prop: string) => void, string]> = [];

    /**
     * Returns the representative of the given constraint variable.
     * Also shortcuts redirections that involve multiple steps.
     */
    getRepresentative(v: ConstraintVar): ConstraintVar {
        let w = v;
        const ws = [];
        while (true) {
            const w2 = this.redirections.get(w);
            if (!w2)
                break;
            assert(ws.length < 100);
            ws.push(w);
            w = w2;
        }
        for (let i = 0; i + 1 < ws.length; i++) {
            assert(ws[i] !== w);
            this.redirections.set(ws[i], w);
        }
        return w;
    }

    /**
     * Returns the tokens in the solution for the given constraint variable
     * (or empty if v is undefined).
     */
    getTokens(v: ConstraintVar | undefined): Iterable<Token> {
        if (v) {
            const ts = this.tokens.get(v);
            if (ts) {
                if (ts instanceof Token)
                    return [ts];
                return ts;
            }
        }
        return [];
    }

    /**
     * Returns the number of tokens in the solution for the given constraint variable, and the tokens.
     */
    getTokensSize(v: ConstraintVar | undefined): [number, Iterable<Token>] {
        if (v) {
            const ts = this.tokens.get(v);
            if (ts) {
                if (ts instanceof Token)
                    return [1, [ts]];
                return [ts.size, ts];
            }
        }
        return [0, []];
    }

    /**
     * Returns all constraint variables with their tokens and number of tokens.
     */
    *getAllVarsAndTokens(): Iterable<[ConstraintVar, Iterable<Token>, number]> {
        for (const [v, ts] of this.tokens)
            if (ts instanceof Token)
                yield [v, [ts], 1];
            else
                yield [v, ts, ts.size];
    }

    /**
     * Returns the number of tokens and a 'has' function for the given constraint variable.
     */
    getSizeAndHas(v: ConstraintVar | undefined): [number, (t: Token) => boolean] {
        if (v) {
            const ts = this.tokens.get(v);
            if (ts) {
                if (ts instanceof Token)
                    return [1, (t: Token) => ts === t];
                return [ts.size, (t: Token) => ts.has(t)];
            }
        }
        return [0, (_t: Token) => false];
    }

    /**
     * Returns the number of constraint variables with tokens.
     */
    getNumberOfVarsWithTokens() {
        return this.tokens.size;
    }

    /**
     * Checks whether the given variable has tokens.
     */
    hasVar(v: ConstraintVar) {
        return this.tokens.has(v);
    }

    /**
     * Removes all tokens from the given variable.
     */
    deleteVar(v: ConstraintVar) {
        this.tokens.delete(v);
    }

    /**
     * Replaces all tokens according to the given function.
     */
    replaceTokens(f: (ts: Iterable<Token>) => Set<Token>) {
        for (const [v, ts] of this.tokens) {
            const r = f(ts instanceof Token ? [ts] : ts);
            this.tokens.set(v, r.size === 1 ? r.values().next().value : r);
            this.numberOfTokens += r.size - (ts instanceof Token ? 1 : ts.size);
        }
    }

    /**
     * Adds the given token to the solution for the given constraint variable.
     * @return true if not already there, false if already there
     */
    addToken(t: Token, v: ConstraintVar): boolean {
        const ts = this.tokens.get(v);
        if (!ts)
            this.tokens.set(v, t);
        else if (ts instanceof Token) {
            if (ts === t)
                return false;
            this.tokens.set(v, new Set([ts, t]));
        } else {
            if (ts.has(t))
                return false;
            ts.add(t);
        }
        this.numberOfTokens++;
        return true;
    }

    /**
     * Adds the given tokens to the solution for the given constraint variable.
     * It is assumed that the given set does not contain any duplicates.
     * @return the tokens that have been added, excluding those already there
     */
    addTokens(ts: Iterable<Token>, v: ConstraintVar): Array<Token> {
        const added: Array<Token> = [];
        let vs = this.tokens.get(v);
        for (const t of ts) {
            let add = false;
            if (!vs) {
                vs = t;
                this.tokens.set(v, vs);
                add = true;
            } else if (vs instanceof Token) {
                if (vs !== t) {
                    vs = new Set([vs, t]);
                    this.tokens.set(v, vs);
                    add = true;
                }
            } else if (!vs.has(t)) {
                vs.add(t);
                add = true;
            }
            if (add)
                added.push(t);
        }
        this.numberOfTokens += added.length;
        return added;
    }

    /**
     * Returns the tokens the given token inherits from (reflexively and transitively).
     */
    getAncestors(t: Token): Set<Token> {
        const res = new Set<Token>();
        res.add(t);
        const w = [t];
        while (w.length !== 0) {
            const s = this.inherits.get(w.shift()!);
            if (s)
                for (const p of s)
                    if (!res.has(p)) {
                        res.add(p);
                        w.push(p);
                    }
        }
        return res;
    }

    /**
     * Returns the tokens that inherit from the given token (reflexively and transitively).
     */
    getDescendants(t: Token): Set<Token> {
        const res = new Set<Token>();
        res.add(t);
        const w = [t];
        while (w.length !== 0) {
            const s = this.reverseInherits.get(w.shift()!);
            if (s)
                for (const p of s)
                    if (!res.has(p)) {
                        res.add(p);
                        w.push(p);
                    }
        }
        return res;
    }
}
