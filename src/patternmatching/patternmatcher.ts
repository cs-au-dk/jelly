import {DummyModuleInfo, FunctionInfo, ModuleInfo} from "../analysis/infos";
import {
    AccessPathPattern,
    CallDetectionPattern,
    CallResultAccessPathPattern,
    ComponentAccessPathPattern,
    ComponentDetectionPattern,
    DetectionPattern,
    DisjunctionAccessPathPattern,
    ExclusionAccessPathPattern,
    Filter,
    Glob,
    ImportAccessPathPattern,
    ImportDetectionPattern,
    NumArgsCallFilter,
    PotentiallyUnknownAccessPathPattern,
    PropertyAccessPathPattern,
    ReadDetectionPattern,
    Type,
    TypeFilter,
    WildcardAccessPathPattern,
    WriteDetectionPattern
} from "./patterns";
import assert from "assert";
import {
    addAll,
    deleteMapSetPairAll,
    FilePath,
    LocationJSON,
    nodeToString,
    SourceLocationsToJSON,
    locationToStringWithFileAndEnd,
    Ternary,
    mapGetSetPair,
    mapGetMap
} from "../misc/util";
import {
    isAssignmentExpression,
    isCallExpression,
    isExpression,
    isIdentifier,
    isMemberExpression,
    isNewExpression,
    isObjectProperty,
    isOptionalCallExpression,
    isOptionalMemberExpression,
    Node
} from "@babel/types";
import micromatch from "micromatch";
import {AccessPathToken, Token} from "../analysis/tokens";
import logger from "../misc/logger";
import {ConstraintVar, NodeVar} from "../analysis/constraintvars";
import {
    AccessPath,
    CallResultAccessPath,
    ComponentAccessPath,
    ModuleAccessPath,
    PropertyAccessPath,
    UnknownAccessPath
} from "../analysis/accesspaths";
import {isDefaultImport} from "./astpatterns";
import {FragmentState} from "../analysis/fragmentstate";
import {expressionMatchesType} from "./typematcher";
import {TypeScriptTypeInferrer} from "../typescript/typeinferrer";
import {options} from "../options";
import Timer from "../misc/timer";
import AnalysisDiagnostics from "../analysis/diagnostics";

/**
 * Different kinds of match uncertainty for detection pattern matching.
 */
export type Uncertainty =
    "accessPath" | // triggers manually written question
    {type: "type", exp: Node | undefined, kind: "base" | number | "value", propNames?: Array<string>, typesToMatch: Array<Type>} | // uncertainty about a type match
    {type: "numArg", exp: Node, numMinArgs: number | undefined, numMaxArgs: number | undefined} | // uncertainty about number of call arguments
    "maybePromiseMatch"; // uncertainty about whether a call result is used as a promise
// FIXME: propNames currently unused

export type UncertaintyJSON =
    "accessPath" |
    {type: "type", loc?: LocationJSON, kind: "base" | number | "value", propNames?: Array<string>, typesToMatch: Array<Type>} | // TODO: loc may be undefined for base filters only, see getPropertyReadObject
    {type: "numArg", loc?: LocationJSON, numMinArgs: number | undefined, numMaxArgs: number | undefined} |
    "maybePromiseMatch";

/**
 * Match for a DetectionPattern.
 */
export type DetectionPatternMatch = {
    exp: Node,
    encl: FunctionInfo | ModuleInfo,
    uncertainties?: Array<Uncertainty>;
}

/**
 * Matching confidence levels for access path pattern matching.
 */
export const confidenceLevels = ["high", "low"] as const;

export type ConfidenceLevel = typeof confidenceLevels[number];

export type Encl = FunctionInfo | ModuleInfo | undefined;

/**
 * Matches for an AccessPathPattern.
 * Provides a set of access paths and enclosing function for each matched node.
 */
export type AccessPathPatternMatches = Record<ConfidenceLevel, Map<Node, [Set<AccessPath>, Encl]>>;

export type PatternMatchesJSON = {
    files: Array<FilePath>,
    patterns: Array<{
        pattern: string,
        matches: Array<PatternMatchJSON>
    }>;
};

export type PatternMatchJSON = {
    loc: LocationJSON,
    uncertainties?: Array<{
        text: string,
        uncertainty: UncertaintyJSON
    }>
};

export type ModuleFilter = (module: ModuleInfo | DummyModuleInfo) => boolean;

export class PatternMatcher {

    private readonly fragmentState: FragmentState;

    private readonly typer: TypeScriptTypeInferrer | undefined;

    /**
     * Cache for glob matching.
     */
    private readonly moduleCache: Map<string, Array<[ModuleAccessPath, Map<Node, FunctionInfo | ModuleInfo>]>> = new Map;

    /**
     * Cache for AccessPathPatterns (except those used in WritePropertyDetectionPatterns).
     */
    private readonly expressionCache: Map<AccessPathPattern, AccessPathPatternMatches> = new Map;

    /**
     * Cache for AccessPathPatterns used in WritePropertyDetectionPatterns.
     */
    private readonly writeExpressionCache: Map<AccessPathPattern, AccessPathPatternMatches> = new Map;

    /**
     * Cache for findUnknowns.
     */
    private unknownsCache: Array<Node> | undefined;

    /**
     * Access paths that escape to external code, with the AST nodes and their enclosing functions where they escape.
     */
    private readonly escapingToExternal = new Map<AccessPath, Map<Node, FunctionInfo | ModuleInfo>>();

    constructor(fragmentState: FragmentState, typer?: TypeScriptTypeInferrer) {
        this.fragmentState = fragmentState;
        this.typer = typer;
    }

    /**
     * Finds the (non-analyzed) modules that match the given glob.
     * Emits error if an analyzed module matches.
     */
    private findGlobMatches(glob: Glob): Array<[ModuleAccessPath, Map<Node, FunctionInfo | ModuleInfo>]> {
        let res = this.moduleCache.get(glob);
        if (!res) {
            res = [];
            this.moduleCache.set(glob, res);
            const isMatch = micromatch.matcher(glob);
            for (const [ap, ns] of this.fragmentState.moduleAccessPaths) {
                const m = ap.moduleInfo;
                if (isMatch(m.getOfficialName()) || (ap.requireName && isMatch(ap.requireName)))
                    if (options.patterns && m instanceof ModuleInfo && m.isIncluded)
                        logger.error(`Error: Pattern contains analyzed module ${m.getOfficialName()} (see --ignore-dependencies)`);
                    else
                        res.push([ap, ns]);
            }
        }
        return res;
    }

    /**
     * Finds the AST nodes that match the given access path pattern, together with the associated access paths.
     */
    private findAccessPathPatternMatches(p: AccessPathPattern, moduleFilter?: ModuleFilter, write?: boolean): AccessPathPatternMatches {
        const cache = write ? this.writeExpressionCache : this.expressionCache;
        let res = cache.get(p);
        if (!res) {
            const high: Map<Node, [Set<AccessPath>, Encl]> = new Map;
            const low: Map<Node, [Set<AccessPath>, Encl]> = new Map;
            res = {high, low};
            cache.set(p, res);
            const f = this.fragmentState;

            /**
             * Adds matches (without considering demotion).
             * @param level current confidence level
             * @param ap current access path
             * @param q property access or call expressions where PropertyAccessPaths/CallResultAccessPaths are created with the current access path as base/caller
             * @param tmp matches are added to this map (before considering demotion)
             * @param subvs constraint variables for sub-expressions of matches are added to this map
             * @param exclude if present, skip these matches (for matches that have already been added to result)
             */
            function addMatches(level: ConfidenceLevel,
                                ap: AccessPath,
                                q: Map<Node, {bp: PropertyAccessPath | CallResultAccessPath | ComponentAccessPath, sub: ConstraintVar, encl: Encl}> | undefined,
                                tmp: Map<Node, [Set<PropertyAccessPath | CallResultAccessPath | ComponentAccessPath>, Encl]>,
                                subvs: Map<Node, ConstraintVar>,
                                exclude?: Map<Node, [Set<AccessPath>, Encl]>) {
                if (q)
                    for (const [r, {bp, sub, encl}] of q) // r is a property read (or call) expression where the base (or caller) matches the sub-pattern, bp is the access path created at that expression, sub is the constraint variable for the sub-expression
                        if (!exclude || !exclude.has(r) || !exclude.get(r)![0].has(bp)) {
                            if (logger.isDebugEnabled())
                                logger.debug(`Match ${bp} (sub: ${ap}) at ${nodeToString(r)} (confidence: ${level})`);
                            mapGetSetPair(tmp, r, encl).add(bp);
                            subvs.set(r, sub);
                        }
            }

            /**
             * Finds the constraint variables that represent the sub-expression (base expression at property read / function expression at call)
             * where all tokens have been matched by the sub-pattern with high confidence.
             * Then transfers the matches found to the result, demoting high to low confidence for sub-expressions that are not fully matched.
             * @param level current confidence level
             * @param sub matches for sub-pattern
             * @param tmp matches found (before considering demotion)
             * @param subvs constraint variables for sub-expressions of matches
             * @param nextsub matches are added here (if argument present)
             */
            function transfer(level: ConfidenceLevel,
                              sub: AccessPathPatternMatches,
                              tmp: Map<Node, [Set<PropertyAccessPath | CallResultAccessPath | ComponentAccessPath>, FunctionInfo | ModuleInfo]>,
                              subvs: Map<Node, ConstraintVar>,
                              nextsub?: AccessPathPatternMatches) {
                // find sub-expressions that are fully matched
                let covered: Set<ConstraintVar> | undefined;
                if (level === "high") {
                    covered = new Set;
                    for (const subv of subvs.values()) {
                        let isCovered = true; // true if all access paths at the sub-expression have been matched by the sub-pattern with high confidence
                        for (const t of f.getTokens(f.getRepresentative(subv)))
                            if (t instanceof AccessPathToken) {
                                let isMatched = false;
                                for (const [aps] of sub.high.values())
                                    if (aps.has(t.ap)) {
                                        isMatched = true;
                                        break;
                                    }
                                if (!isMatched) {
                                    isCovered = false;
                                    break;
                                }
                            } else {
                                isCovered = false;
                                break;
                            }
                        if (logger.isDebugEnabled())
                            logger.debug(`Covered ${subv}: ${isCovered}`);
                        if (isCovered)
                            covered.add(subv);
                    }
                }
                // transfer from tmp to result, demote if not fully matched
                for (const [n, [bps, encl]] of tmp)
                    for (const bp of bps) {
                        let newlevel = level;
                        if (level === "high" && !covered!.has(subvs.get(n)!)) {
                            if (logger.isDebugEnabled())
                                logger.debug(`Demoting match ${nodeToString(n)} with ${p} to low confidence`);
                            newlevel = "low";
                        }
                        const s = mapGetSetPair(res![newlevel], n, encl);
                        if (!s.has(bp)) {
                            s.add(bp);
                            if (nextsub)
                                mapGetSetPair(nextsub![newlevel], n, encl).add(bp);
                        }
                    }
            }

            /**
             * If the given access path escapes to external code, add it together with
             * the corresponding AST nodes as low-confidence matches.
             */
            const addEscapingToExternal = (ap: AccessPath, write?: boolean) => {
                const esc = this.escapingToExternal.get(ap);
                if (esc)
                    for (const [n, encl] of esc)
                        if (!write || (isAssignmentExpression(n) && (isMemberExpression(n.left) || isOptionalMemberExpression(n.left))))
                            mapGetSetPair(res!.low, n, encl).add(ap);
            };

            if (p instanceof ImportAccessPathPattern) {
                let globMatches = this.findGlobMatches(p.glob);
                if (moduleFilter)
                    globMatches = globMatches.filter(([ap, _ns]) => moduleFilter(ap.moduleInfo));
                for (const [ap, m] of globMatches)
                    for (const [n, encl] of m)
                        mapGetSetPair(high, n, encl).add(ap);
                // workaround to support TAPIR's treatment of default imports
                for (const [aps] of high.values())
                    for (const ap of aps) {
                        const ps = f.propertyReadAccessPaths.get(ap);
                        if (ps) {
                            const q = ps.get("default");
                            if (q)
                                for (const [p, {bp, encl}] of q)
                                    mapGetSetPair(high, p, encl).add(bp);
                        }
                    }
            } else if (p instanceof PropertyAccessPathPattern) {
                const sub = this.findAccessPathPatternMatches(p.base, moduleFilter);
                for (const level of confidenceLevels) {
                    const tmp = new Map<Node, [Set<PropertyAccessPath>, FunctionInfo | ModuleInfo]>(); // temporary result (before deciding demotions)
                    const subvs = new Map<Node, ConstraintVar>();
                    for (const [aps] of sub[level].values())
                        for (const ap of aps) { // ap is an access path that matches the sub-pattern
                            const ps = (write ? f.propertyWriteAccessPaths : f.propertyReadAccessPaths).get(ap);
                            if (ps)
                                for (const prop of p.props)
                                    addMatches(level, ap, ps.get(prop), tmp, subvs);
                            addEscapingToExternal(ap);
                        }
                    transfer(level, sub, tmp, subvs);
                }
            } else if (p instanceof CallResultAccessPathPattern) {
                const sub = this.findAccessPathPatternMatches(p.fun, moduleFilter);
                for (const level of confidenceLevels) {
                    const tmp = new Map<Node, [Set<CallResultAccessPath>, FunctionInfo | ModuleInfo]>();
                    const subvs = new Map<Node, ConstraintVar>();
                    for (const [aps] of sub[level].values())
                        for (const ap of aps) {
                            addMatches(level, ap, f.callResultAccessPaths.get(ap), tmp, subvs);
                            addEscapingToExternal(ap);
                        }
                    transfer(level, sub, tmp, subvs);
                }
            } else if (p instanceof ComponentAccessPathPattern) {
                const sub = this.findAccessPathPatternMatches(p.component, moduleFilter);
                for (const level of confidenceLevels) {
                    const tmp = new Map<Node, [Set<ComponentAccessPath>, FunctionInfo | ModuleInfo]>();
                    const subvs = new Map<Node, ConstraintVar>();
                    for (const [aps] of sub[level].values())
                        for (const ap of aps) {
                            addMatches(level, ap, f.componentAccessPaths.get(ap), tmp, subvs);
                            addEscapingToExternal(ap);
                        }
                    transfer(level, sub, tmp, subvs);
                }
            } else if (p instanceof DisjunctionAccessPathPattern) {
                const subs = [];
                for (const ap of p.aps)
                    subs.push(this.findAccessPathPatternMatches(ap, moduleFilter));
                for (const sub of subs)
                    for (const level of confidenceLevels)
                        for (const [n, [aps, encl]] of sub[level])
                            addAll(aps, mapGetSetPair(res[level], n, encl));
                for (const sub of subs)
                    for (const [n, [aps]] of sub.low)
                          deleteMapSetPairAll(high, n, aps);
            } else if (p instanceof ExclusionAccessPathPattern) {
                const included = this.findAccessPathPatternMatches(p.include, moduleFilter);
                const excluded = this.findAccessPathPatternMatches(p.exclude, moduleFilter);
                // start with all the included matches
                for (const level of confidenceLevels)
                    for (const [n, [aps, encl]] of included[level])
                        addAll(aps, mapGetSetPair(res[level], n, encl));
                // remove the excluded high-confidence matches from the result
                for (const [n, [aps]] of excluded.high) {
                    deleteMapSetPairAll(high, n, aps);
                    deleteMapSetPairAll(low, n, aps);
                }
                // demote the excluded low-confidence matches from the result
                for (const [n, [aps, encl]] of excluded.low)
                    for (const ap of aps)
                        if (high.get(n)?.[0].delete(ap))
                            mapGetSetPair(low, n, encl).add(ap);
            } else if (p instanceof PotentiallyUnknownAccessPathPattern) {
                const sub = this.findAccessPathPatternMatches(p.ap, moduleFilter);
                for (const level of confidenceLevels)
                    for (const [n, [aps, encl]] of sub[level])
                        addAll(aps, mapGetSetPair(res[level], n, encl));
                for (const n of this.findUnknowns())
                    mapGetSetPair(low, n, undefined).add(UnknownAccessPath.instance); // <-- the only source of undefined enclosing function
            } else if (p instanceof WildcardAccessPathPattern) {
                // add all expressions that can be reached from matches to p.ap in zero or more calls or property accesses
                let sub = this.findAccessPathPatternMatches(p.ap, moduleFilter);
                // copy results from sub to res
                for (const level of confidenceLevels)
                    for (const [n, [bps, encl]] of sub[level])
                        addAll(bps, mapGetSetPair(res![level], n, encl));
                // transitively find matching property accesses and calls
                const visited = {high: new Set, low: new Set};
                while (sub.high.size !== 0 || sub.low.size !== 0) {
                    const nextsub = {high: new Map, low: new Map};
                    for (const level of confidenceLevels) {
                        const tmp = new Map<Node, [Set<PropertyAccessPath | CallResultAccessPath>, FunctionInfo | ModuleInfo]>();
                        const subvs = new Map<Node, ConstraintVar>();
                        for (const [aps] of sub[level].values())
                            for (const ap of aps)
                                if (!visited[level].has(ap)) {
                                    visited[level].add(ap);
                                    // look for PropertyAccessPath matches
                                    const ps = (write ? f.propertyWriteAccessPaths : f.propertyReadAccessPaths).get(ap);
                                    if (ps)
                                        for (const q of ps.values())
                                            addMatches(level, ap, q, tmp, subvs, res[level]);
                                    // look for CallResultAccessPath matches
                                    addMatches(level, ap, f.callResultAccessPaths.get(ap), tmp, subvs, res[level]);
                                }
                        transfer(level, sub, tmp, subvs, nextsub);
                    }
                    sub = nextsub;
                }
            } else
                assert.fail("Unexpected AccessPathPattern");
        }
        if (logger.isDebugEnabled())
            for (const level of confidenceLevels)
                for (const [e, aps] of res[level])
                    for (const ap of aps)
                        logger.debug(`Pattern ${p} matched access path ${ap} at ${locationToStringWithFileAndEnd(e.loc)} (confidence: ${level})`);
        return res;
    }

    /**
     * Finds the AST nodes that have UnknownAccessPath.
     */
    private findUnknowns(): Array<Node> {
        if (!this.unknownsCache) {
            this.unknownsCache = [];
            const check = (v: NodeVar, ts: Iterable<Token>) => {
                for (const t of ts)
                    if (t instanceof AccessPathToken && t.ap instanceof UnknownAccessPath) {
                        if (logger.isDebugEnabled())
                            logger.debug(`Unknown: ${v} (${t})`);
                        this.unknownsCache!.push(v.node);
                        break;
                    }
            };
            for (const [v, ts] of this.fragmentState.getAllVarsAndTokens()) // only includes representatives, but always followed by property read
                if (v instanceof NodeVar)
                    check(v, ts);
            for (const v of this.fragmentState.redirections.keys())
                if (v instanceof NodeVar)
                    check(v, this.fragmentState.getTokens(this.fragmentState.getRepresentative(v)));
        }
        return this.unknownsCache;
    }

    /**
     * Checks whether the given AST node matches the given filter.
     * Also returns the relevant (sub-)expression (or the expression itself if a spread expression appears).
     */
    private filterMatches(n: Node, filter: Filter): [Ternary, Node] {
        if (!(isCallExpression(n) || isOptionalCallExpression(n) || isNewExpression(n)))
            return [Ternary.Maybe, n]; // relevant due to addEscapingToExternal
        if (filter instanceof NumArgsCallFilter) {
            let simple = true, exps = 0;
            for (const arg of n.arguments)
                if (isExpression(arg))
                    exps++;
                else
                    simple = false;
            let res;
            if (simple)
                res = (filter.minArgs === undefined || filter.minArgs <= n.arguments.length) &&
                (filter.maxArgs === undefined || n.arguments.length <= filter.maxArgs) ? Ternary.True : Ternary.False;
            else if (filter.maxArgs === undefined && filter.minArgs !== undefined && filter.minArgs <= exps)
                res = Ternary.True;
            else
                res = Ternary.Maybe;
            return [res, n];
        }
        if (!(filter instanceof TypeFilter))
            assert.fail("Unexpected Filter");
        for (const arg of n.arguments)
            if (!isExpression(arg))
                return [Ternary.Maybe, n];
        let arg;
        if (filter.selector.head === "base") {
            arg = n.callee;
            if ((isMemberExpression(n.callee) || isOptionalMemberExpression(n.callee)) && isExpression(n.callee.object))
                arg = n.callee.object;
            else
                return [Ternary.Maybe, n];
        } else if (filter.selector.head < 0) {
            if (n.arguments.length + filter.selector.head >= 0)
                arg = n.arguments[n.arguments.length + filter.selector.head];
            else
                return [Ternary.False, n];
        } else {
            if (filter.selector.head < n.arguments.length)
                arg = n.arguments[filter.selector.head];
            else
                return [Ternary.False, n];
        }
        return [expressionMatchesType(arg, filter.selector.props, filter.types, this.typer), arg];
    }

    /**
     * Find the access paths that escape to external code.
     */
    findEscapingAccessPathsToExternal() {
        const f = this.fragmentState;
        for (const [v, m] of f.maybeEscapingToExternal)
            for (const t of f.getTokens(f.getRepresentative(v)))
                if (t instanceof AccessPathToken)
                    for (const [n, encl] of m)
                        mapGetMap(this.escapingToExternal, t.ap).set(n, encl);
    }

    /**
     * Finds the AST nodes that match the given detection pattern,
     * with descriptions of the causes of uncertainty for low-confidence matches.
     */
    findDetectionPatternMatches(d: DetectionPattern, diagnostics?: AnalysisDiagnostics, moduleFilter?: ModuleFilter): Array<DetectionPatternMatch> {
        const timer = new Timer();
        this.findEscapingAccessPathsToExternal();
        const res: Array<DetectionPatternMatch> = [];
        if (d instanceof ImportDetectionPattern) {
            const sub = this.findAccessPathPatternMatches(d.ap, moduleFilter);
            for (const level of confidenceLevels)
                for (const [exp, [, encl]] of sub[level]) {
                    assert(encl); // only undefined at PotentiallyUnknownAccessPathPattern matches
                    if (!(isMemberExpression(exp) || isOptionalMemberExpression(exp)) && !isIdentifier(exp)) // excluding E.default expressions and identifiers
                        if (!d.onlyDefault || isDefaultImport(exp))
                            res.push({exp, encl, uncertainties: level === "low" ? ["accessPath" as const] : undefined});
                }
        } else if (d instanceof ReadDetectionPattern) {
            const sub = this.findAccessPathPatternMatches(d.ap, moduleFilter);
            for (const level of confidenceLevels) {
                for (const [exp, [, encl]] of sub[level]) {
                    assert(encl); // only undefined at PotentiallyUnknownAccessPathPattern matches
                    if (!d.notInvoked || !this.fragmentState.invokedExpressions.has(exp)) {
                        const uncertainties: Array<Uncertainty> = [];
                        if (level === "low" && !d.baseFilter) // uncertainty is added through the base filter in this case
                            uncertainties.push("accessPath");
                        if (d.baseFilter && level === "low") { // if certain on access path, do not check base filter
                            const expObject = getPropertyReadObject(exp);
                            if (expObject)
                                switch (expressionMatchesType(expObject, undefined, d.baseFilter, this.typer)) {
                                    case Ternary.False:
                                        continue;
                                    case Ternary.Maybe:
                                        uncertainties.push({type: "type", exp: expObject, kind: "base", typesToMatch: d.baseFilter});
                                        break;
                                }
                            else // TODO: unsure where the base expression is, just using 'undefined' (could be improved if findAccessPathPatternMatches also returned the associated expressions for the sub-matches)
                                uncertainties.push({type: "type", exp: undefined, kind: "base", typesToMatch: d.baseFilter});
                        }
                        res.push({exp, encl, uncertainties});
                    }
                    // for identifier matches in imports, also include uses of the identifier
                    if (isIdentifier(exp)) {
                        const refs = this.fragmentState.importDeclRefs.get(exp);
                        if (refs)
                            for (const n of refs) {
                                const uncertainties: Array<Uncertainty> = [];
                                if (level === "low")
                                    uncertainties.push("accessPath");
                                res.push({exp: n, encl, uncertainties});
                            }
                    }
                }
            }
        } else if (d instanceof WriteDetectionPattern) {
            const sub = this.findAccessPathPatternMatches(d.ap, moduleFilter, true);
            for (const level of confidenceLevels)
                for (const [exp, [, encl]] of sub[level]) {
                    assert(encl); // only undefined at PotentiallyUnknownAccessPathPattern matches
                    const uncertainties: Array<Uncertainty> = [];
                    if (level === "low")
                        uncertainties.push("accessPath");
                    if (isAssignmentExpression(exp) && (isMemberExpression(exp.left) || isOptionalMemberExpression(exp.left))) {
                        if (d.valueFilter)
                            switch (expressionMatchesType(exp.right, undefined, d.valueFilter, this.typer)) {
                                case Ternary.False:
                                    continue;
                                case Ternary.Maybe:
                                    uncertainties.push({type: "type", exp: exp.right, kind: "value", typesToMatch: d.valueFilter});
                                    break;
                            }
                        if (d.baseFilter)
                            switch (expressionMatchesType(exp.left.object, undefined, d.baseFilter, this.typer)) {
                                case Ternary.False:
                                    continue;
                                case Ternary.Maybe:
                                    uncertainties.push({type: "type", exp: exp.left.object, kind: "base", typesToMatch: d.baseFilter});
                                    break;
                            }
                    }
                    res.push({exp, encl, uncertainties});
                }
        } else if (d instanceof CallDetectionPattern) {
            // 'call' patterns match entire call expressions but refer only to the functions being called,
            // so we wrap the access path pattern in a CallResultAccessPathPattern
            const sub = this.findAccessPathPatternMatches(new CallResultAccessPathPattern(d.ap), moduleFilter);
            const f = this.fragmentState;
            for (const level of confidenceLevels)
                matches: for (const [exp, [, encl]] of sub[level]) {
                    assert(encl); // only undefined at PotentiallyUnknownAccessPathPattern matches
                    if ((!d.onlyReturnChanged || !f.callsWithUnusedResult.has(exp)) &&
                        (!d.onlyNonNewCalls || !isNewExpression(exp)) &&
                        (!d.onlyWhenUsedAsPromise || f.callsWithResultMaybeUsedAsPromise.has(exp))) {
                        const uncertainties: Array<Uncertainty> = [];
                        if (d.onlyWhenUsedAsPromise && f.callsWithResultMaybeUsedAsPromise.has(exp))
                            uncertainties.push("maybePromiseMatch");
                        if (level === "low" && !d.filters?.some(f => f instanceof TypeFilter && f.selector.head === "base")) // if uncertain and there is a base filter, an Uncertainty will be added below so skip here
                            uncertainties.push("accessPath");
                        if (d.filters)
                            for (const f of d.filters)
                                if (!(level === "high" && f instanceof TypeFilter && f.selector.head === "base")) { // skip base type filters if the access path match is certain
                                    const [t, arg] = this.filterMatches(exp, f);
                                    switch (t) {
                                        case Ternary.False:
                                            continue matches;
                                        case Ternary.Maybe:
                                            if (f instanceof NumArgsCallFilter)
                                                uncertainties.push({
                                                    type: "numArg",
                                                    exp,
                                                    numMinArgs: f.minArgs,
                                                    numMaxArgs: f.maxArgs
                                                });
                                            else if (f instanceof TypeFilter)
                                                uncertainties.push({
                                                    type: "type",
                                                    exp: arg,
                                                    kind: f.selector.head,
                                                    typesToMatch: f.types
                                                }); // FIXME: f.arg.props not used?
                                            else
                                                throw new Error("Unexpected Filter");
                                            break;
                                    }
                                }
                        res.push({exp, encl, uncertainties});
                    }
                }
        } else if (d instanceof ComponentDetectionPattern) {
            // 'component' patterns match entire call expressions but refer only to the functions being called,
            // so we wrap the access path pattern in a ComponentAccessPathPattern
            const sub = this.findAccessPathPatternMatches(new ComponentAccessPathPattern(d.ap), moduleFilter);
            for (const level of confidenceLevels)
                matches: for (const [exp, [, encl]] of sub[level]) {
                    assert(encl); // only undefined at PotentiallyUnknownAccessPathPattern matches
                    const uncertainties: Array<Uncertainty> = [];
                    if (level === "low" && !d.filters?.some(f => f instanceof TypeFilter && f.selector.head === "base")) // if uncertain and there is a base filter, an Uncertainty will be added below so skip here
                        uncertainties.push("accessPath");
                    if (d.filters)
                        for (const f of d.filters)
                            if (!(level === "high" && f instanceof TypeFilter && f.selector.head === "base")) { // skip base type filters if the access path match is certain
                                const [t, arg] = this.filterMatches(exp, f);
                                switch (t) {
                                    case Ternary.False:
                                        continue matches;
                                    case Ternary.Maybe:
                                        if (f instanceof NumArgsCallFilter)
                                            uncertainties.push({
                                                type: "numArg",
                                                exp,
                                                numMinArgs: f.minArgs,
                                                numMaxArgs: f.maxArgs
                                            });
                                        else if (f instanceof TypeFilter)
                                            uncertainties.push({
                                                type: "type",
                                                exp: arg,
                                                kind: f.selector.head,
                                                typesToMatch: f.types
                                            }); // FIXME: f.arg.props not used?
                                        else
                                            throw new Error("Unexpected Filter");
                                        break;
                                }
                            }
                    res.push({exp, encl, uncertainties});
                }
        } else
            assert.fail("Unexpected DetectionPattern");
        if (diagnostics)
            diagnostics.patternMatchingTime += timer.elapsed();
        return res;
    }
}

/**
 * Finds the base object expression of a property read,
 * returns undefined for property reads at imports and destructuring assignments.
 */
function getPropertyReadObject(exp: Node): Node | undefined {
    if (isMemberExpression(exp) || isOptionalMemberExpression(exp))
        return exp.object;
    if (isIdentifier(exp)) // example: import { foo } from "bar"
        return undefined;
    if (isObjectProperty(exp)) // example: const { foo } = require("bar")
        return undefined;
    assert.fail(`Unexpected node type ${exp.type} at ${locationToStringWithFileAndEnd(exp.loc)}`);
}

export function convertPatternMatchesToJSON(patterns: Array<DetectionPattern | undefined>, matcher: PatternMatcher, diagnostics: AnalysisDiagnostics): PatternMatchesJSON {
    const res: PatternMatchesJSON = {files: [], patterns: []};
    const locs = new SourceLocationsToJSON(res.files);
    function convertUncertaintyToJSON(u: Uncertainty): UncertaintyJSON {
        if (typeof u === "object" && "exp" in u) {
            const r: UncertaintyJSON & {exp?: Node} = {...u, loc: u.exp && locs.makeLocString(u.exp.loc)};
            delete r.exp;
            return r;
        } else
            return u;
    }
    for (const p of patterns)
        if (p) {
            const ms = matcher.findDetectionPatternMatches(p, diagnostics);
            if (ms.length > 0) {
                const matches: Array<PatternMatchJSON> = [];
                res.patterns.push({pattern: p.toString(), matches});
                for (const m of ms) {
                    const match: PatternMatchJSON = {
                        loc: locs.makeLocString(m.exp.loc),
                        uncertainties: []
                    };
                    matches.push(match);
                    if (m.uncertainties && m.uncertainties.length > 0) {
                        for (const u of m.uncertainties)
                            match.uncertainties!.push({
                                uncertainty: convertUncertaintyToJSON(u),
                                text: generateQuestion(u) ?? "Access path match uncertain"
                            });
                    }
                }
            }
        }
    return res;
}

/**
 * Generates a human-readable question from the given uncertainty description,
 * or returns undefined if uncertain access path match.
 */
export function generateQuestion(u: Uncertainty): string | undefined {
    if (u === "accessPath")
        return undefined;
    else if (u === "maybePromiseMatch")
        return "Is the result used as a promise?";
    else if (u.type === "type") {
        // TODO: compute string as done in JSFIXMain#getTextFromMatchResult case for MaybeTypeMatch
        const prefix = u.kind === "base" ? "the base expression" : u.kind === "value" ? "the expression" : `argument ${u.kind + 1}`;
        assert(u.typesToMatch.length > 0, "typesToMatch empty");
        const suffix = u.typesToMatch.length > 1 ?
            `one of the types ${u.typesToMatch.slice(0, -1).join(", ")}, or ${u.typesToMatch[u.typesToMatch.length - 1]}` :
            `type ${u.typesToMatch[0]}`;
        return `Is ${prefix} of ${suffix}?`;
    } else if (u.type === "numArg") {
        const prefix = "Is the call supplied with ";
        if (u.numMinArgs === undefined)
            return `${prefix}at most ${u.numMaxArgs} argument${u.numMaxArgs === 1 ? "" : "s"}?`;
        else if (u.numMaxArgs === undefined)
            return `${prefix}at least ${u.numMinArgs} argument${u.numMinArgs === 1 ? "" : "s"}?`;
        else if (u.numMinArgs === u.numMaxArgs)
            return `${prefix}exactly ${u.numMinArgs} argument${u.numMinArgs === 1 ? "" : "s"}?`;
        else
            return `Is the call supplied with at least ${u.numMinArgs} and at most ${u.numMaxArgs} arguments?`;
    } else
        throw new Error("Unexpected Uncertainty type");
}
