import assert from "assert";
import {diffLinesUnified2} from "jest-diff";
import {format as prettyFormat, Printer, Config, Refs} from "pretty-format";
import type {MatcherFunction, Tester} from "expect";
import {iterableEquality} from "@jest/expect-utils";
import {Location, getOrSet, locationToStringWithFileAndEnd} from "../misc/util";
import {ModuleInfo} from "../analysis/infos";
import Solver from "../analysis/solver";
import {GlobalState} from "../analysis/globalstate";
import {FragmentState, RepresentativeVar} from "../analysis/fragmentstate";
import {Operations} from "../analysis/operations";
import {AnalysisStateReporter} from "../output/analysisstatereporter";
import {Node, isNode} from "@babel/types";
import {ConstraintVar} from "../analysis/constraintvars";
import {nuutila} from "../misc/scc";

declare module "expect" {
    interface Matchers<R> {
        toMatchAnalysisResults(solver: Solver): R;
    }
}

// pretty-format plugins for printing entries of maps and sets in sorted order (instead of insertion order)
const setPlugin = {
    test(x: unknown): boolean { return x instanceof Set; },
    serialize(set: Set<object>, config: Config, indentation: string, depth: number, refs: any, printer: Printer): string {
        return `Set (size ${set.size}) ${printer([...set].sort(), config, indentation, depth, refs)}`;
    },
};

const mapPlugin = {
    test(x: unknown): boolean { return x instanceof Map; },
    serialize(map: Map<object, object>, config: Config, indentation: string, depth: number, refs: any, printer: Printer): string {
        return `Map (size ${map.size}) ${printer([...map.entries()].sort(), config, indentation, depth, refs)}`;
    },
};

// plugin factory that creates a pretty-format and jest expect equality plugin
// the returned plugin strips fields matched by the exclude plugin both for serialization and equality testing
function filterFields<T extends object>(test: (x: unknown) => x is T, exclude: (field: string) => boolean): {
    test(x: unknown): x is T;
    serialize(val: any, config: Config, indentation: string, depth: number, refs: Refs, printer: Printer): string;
    equal: Tester;
} {
    const narrow = (o: T) => Object.assign(
        Object.create(Object.getPrototypeOf(o)),
        Object.fromEntries(Object.entries(o).filter(([key]) => !exclude(key))),
    ) as T;

    return {
        // test function that only triggers if the object has an excluded field
        // (avoids infinite recursion)
        test: (x: unknown): x is T => test(x) && Object.keys(x).some(exclude),
        serialize(x: T, config: Config, indentation: string, depth: number, refs: any, printer: Printer): string {
            return printer(narrow(x), config, indentation, depth, refs);
        },
        equal(a: unknown, b: unknown, customTesters: Array<Tester>) {
            const aOK = test(a), bOK = test(b);
            if (aOK && bOK) {
                const an = narrow(a), bn = narrow(b);
                return Object.keys(an).length == Object.keys(bn).length &&
                    Object.entries(an).every(([key, value]) => key in bn && (this.equals(value, (bn as any)[key], customTesters, true)));
            } else if (aOK === bOK)
                return undefined;
            else
                return false;
        },
    };
}

const excludeFields = (fields: string[]) => (field: string) => fields.includes(field);

const isSL = (x: unknown): x is object => Boolean(x && typeof x === "object" && "line" in x && "column" in x);

function isLocation(x: unknown): x is Location {
    return Boolean(x && typeof x === "object" && "start" in x && "end" in x && isSL(x.start) && isSL(x.end));
}

const locationPlugin = filterFields(isLocation, excludeFields(["filename", "identifierName"]));
const positionPlugin = filterFields(isSL, excludeFields(["index"]));
const nodePlugin = {
    test: isNode,
    serialize(x: Node): string {
        return locationToStringWithFileAndEnd(x.loc, true);
    },
    equal(a: unknown, b: unknown): boolean | undefined {
        const aOK = isNode(a), bOK = isNode(b);
        if (aOK && bOK)
            return this.serialize(a) === this.serialize(b);
        else if (aOK === bOK)
            return undefined;
        return false;
    },
};
// const astNodePlugin = filterFields((x: unknown): x is AstNode => x instanceof AstNode, excludeFields(["real"]));

// pretty-format and jest expect equality plugin that modified how certain
// application-specific types are compared and serialized
const singletonsPlugin = {
    // values with these types are compared through types and potentially with
    // their toString() method if it is overridden
    singletons: [
        GlobalState.prototype, FragmentState.prototype, Solver.prototype,
        ModuleInfo.prototype, Operations.prototype,
    ] as const,
    sindex(x: unknown): number {
        return x && typeof x === "object" ? this.singletons.indexOf(Object.getPrototypeOf(x)) : -1;
    },
    test(x: unknown): x is object {
        return this.sindex(x) !== -1;
    },
    serialize(x: object): string {
        const proto = Object.getPrototypeOf(x);
        if (Object.hasOwn(proto, "toString"))
            return x.toString();

        return x.constructor.name;
    },
    equal(a: unknown, b: unknown): boolean | undefined {
        const ai = this.sindex(a), bi = this.sindex(b);
        if (ai !== -1 && ai === bi) {
            if (Object.hasOwn(this.singletons[ai], "toString")) {
                const toString = this.singletons[ai].toString;
                return toString.call(a) === toString.call(b);
            }

            return true;
        }
        else if (ai === -1 && bi === -1)
            return undefined;
        else
            return false;
    },
};

// const constraintsPlugin = {
//     test(x: unknown): x is Array<Constraint | undefined> {
//         return Array.isArray(x) && x.some(c => c instanceof Constraint) && x.every(c => c instanceof Constraint || c === undefined);
//     },
//     serialize(x: Array<Constraint | undefined>, config: Config, indentation: string, depth: number, refs: any, printer: Printer): string {
//         const xf = x.filter(c => c !== undefined);
//         if (xf.length === 1)
//             return printer(xf[0], config, indentation, depth, refs);
//
//         return printer((["marker"] as any).concat(xf.sort()), config, indentation, depth, refs);
//     },
//     equal(this: TesterContext, a: unknown, b: unknown, customTesters: Array<Tester>): boolean | undefined {
//         const aOK = constraintsPlugin.test(a), bOK = constraintsPlugin.test(b);
//         if (aOK && bOK && (a.includes(undefined) || b.includes(undefined)))
//             return this.equals(a.filter(x => x), b.filter(x => x), customTesters, true);
//
//         return undefined;
//     },
// };
//
// const constraintsEqual: Tester = function(a: unknown, b: unknown, customTesters: Array<Tester>) {
//     const aC = a instanceof Constraint, bC = b instanceof Constraint;
//     if (aC && !bC)
//         return this.equals([a], b, customTesters, true);
//     else if (!aC && bC)
//         return this.equals(a, [b], customTesters, true);
//     return undefined;
// };

const equalPlugins = [
    locationPlugin.equal, nodePlugin.equal.bind(nodePlugin), positionPlugin.equal,
    singletonsPlugin.equal.bind(singletonsPlugin),
    iterableEquality, /* constraintsEqual, constraintsPlugin.equal, astNodePlugin.equal, */
];

/*
 * trydiff serializes the two provided values to strings and returns a
 * line-by-line unified diff.
 * The values are expected to serialize to different strings.
 * If this is not the case, undefined is returned.
 */
function trydiff(expected: unknown, actual: unknown, {expand}: {expand?: boolean}): string | undefined {
    const plugins = [
        singletonsPlugin,
        locationPlugin, positionPlugin,
        nodePlugin,
        // astNodePlugin,
        setPlugin, mapPlugin,
        // constraintsPlugin,
    ];
    const a = prettyFormat(expected, {plugins, indent: 0});
    const b = prettyFormat(actual, {plugins, indent: 0});
    return a === b ? undefined
        : diffLinesUnified2(
            prettyFormat(expected, {plugins}).split("\n"),
            prettyFormat(actual, {plugins}).split("\n"),
            a.split("\n"), b.split("\n"),
            {expand});
}

/*
 * Compares some key analysis results between two solver or fragment state instances.
 * It is relatively fast because data structures (maps & sets) are transformed into structures
 * that can be compared (by jest's expect deep equality checker) in O(N) time instead of O(N^2) time.
 *
 * TODO: It is a bit inefficient to serialize all data structures to structures containing strings, but it's simple.
 * It should be possible to avoid this by implementing more clever equality checker plugins.
 */
export const toMatchAnalysisResults: MatcherFunction<[Solver | FragmentState]> = function (_actual: unknown, expected: Solver | FragmentState) {
    let actual: FragmentState;
    if (_actual instanceof Solver)
        actual = _actual.fragmentState;
    else if (_actual instanceof FragmentState)
        actual = _actual;
    else
        throw new Error("Actual value must be a solver or fragment state instance!");

    if (expected instanceof Solver)
        expected = expected.fragmentState;

    // returns a map with an entry for each SCC in the subset graph. Each value
    // contains the variables in the SCC (comp) and a serialized shared token set (tokens)
    const getComps = (f: FragmentState) => {
        // additional compress to make results comparable
        const [_, repmap] = nuutila(f.vars.keys(), (v: RepresentativeVar) => f.subsetEdges.get(v));
        const grep = (v: ConstraintVar) => {
            const rep = repmap.get(f.getRepresentative(v));
            assert(rep);
            return rep;
        };

        const comps = new Map<ConstraintVar, {comp: Array<ConstraintVar>, tokens: string[]}>();
        for (const v of f.vars) {
            const rep = grep(v);
            const c = getOrSet(comps, rep, () => ({comp: [], tokens: [...f.getTokens(v)].map(t => t.toString()).sort()}));
            c.comp.push(v);
            if (v !== rep) {
                // sanity check (vars in cycle should have the same tokens)
                const aTokens = new Set(f.getTokens(v)), bTokens = new Set(f.getTokens(rep));
                assert.equal(aTokens.size, bTokens.size);
                for (const t of aTokens) assert(bTokens.has(t));
            }
        }

        // add already redirected variables to component
        for (const v of f.redirections.keys())
            comps.get(grep(v))!.comp.push(v);

        for (const c of comps.values())
            c.comp.sort();

        return {comps, grep};
    };

    const aComps = getComps(actual), eComps = getComps(expected);

    for (const [header, get] of <Array<[string, (f: FragmentState) => object]>>[
        // (very shallow modules check due to singletonsPlugin)
        ["Modules", f => f.a.moduleInfos],
        ["Packages", f => f.a.packageInfos],
        ["Functions", f => {
            const m = new Map([...f.a.functionInfos]
                .map(([f, info]) => [locationToStringWithFileAndEnd(f.loc, true), info.toString()]));
            assert.equal(m.size, f.a.functionInfos.size);
            return m;
        }],
        ["Function edges", f => {
            const m = new Map([...f.functionToFunction]
                .map(([src, targets]) => [src.toString(), [...targets].map(t => t.toString()).sort()]));
            assert.equal(m.size, f.functionToFunction.size);
            return m;
        }],
        ["Require edges", f => f.requireGraph],
        ["Call locations", f => [...f.callLocations].map(node => locationToStringWithFileAndEnd(node.loc, true)).sort()],
        ["Call edges", f => {
            const m = new Map([...f.callToFunctionOrModule]
                .map(([node, es]) => [locationToStringWithFileAndEnd(node.loc, true), [...es].map(t => t.toString()).sort()]));
            assert.equal(m.size, f.callToFunctionOrModule.size);
            return m;
        }],
        ["Zero caller functions", f => [...new AnalysisStateReporter(f).getZeroCallerFunctions()].map(f => f.toString()).sort()],
        ["Object properties", f => {
            const m = new Map([...f.objectProperties].map(([t, props]) => [t.toString(), [...props].sort()]));
            assert.equal(m.size, f.objectProperties.size);
            return m;
        }],
        ["Widened objects", f => [...f.widened].map(t => t.toString()).sort()],
        // ["Constraint variables", f => {
        //     const {comps} = f === actual ? aComps : eComps;
        //     return [...comps.values()].flatMap(({comp}) => comp.map(v => v.toString())).sort();
        // }],
        ["ConstraintVar components", f => {
            const {comps} = f === actual ? aComps : eComps;
            const m = new Map([...comps.values()].map(({comp}) => [comp[0].toString(), comp.map(v => v.toString())]));
            assert.equal(m.size, comps.size);
            return m;
        }],
        ["Subset edges", f => {
            const {comps, grep} = f === actual ? aComps : eComps;
            const edges = new Set();
            for (const [src, targets] of f.subsetEdges) {
                const sRep = grep(src);
                for (const target of targets) {
                    const tRep = grep(target);
                    if (sRep !== tRep) {
                        const c1 = comps.get(sRep)!.comp, c2 = comps.get(tRep)!.comp;
                        // edges.add(`${prettyFormat(c1.map(v => v.toString()))}\n  ->\n${prettyFormat(c2.map(v => v.toString()))}`);
                        // edges.add(`${c1}\n  ->\n${c2}\n`);
                        edges.add(`${c1[0]} (${c1.length}) -> ${c2[0]} (${c2.length})`);
                    }
                }
            }

            return [...edges].sort();
        }],
        ["Tokens", f => {
            const {comps} = f === actual ? aComps : eComps;
            return new Map([...comps.values()].map(({comp, tokens}) => [comp[0].toString(), tokens]));
        }],
        // TODO: more checks?
    ]) {
        const act = get(actual), exp = get(expected);
        if (!this.equals(act, exp, equalPlugins, true))
            return {
                pass: false,
                message: () =>
                    this.utils.matcherHint("toMatchAnalysisResults", undefined, undefined, {comment: "Analysis results equality"}) +
                    `\n\nDifference for ${header}:\n\n${trydiff(exp, act, this)}`,
            };

    }

    return {
        pass: true,
        message: () =>
            this.utils.matcherHint("toMatchAnalysisResults", undefined, undefined, {comment: "Analysis results equality"}) +
            "Should not be equal!",
    };
};

expect.extend({toMatchAnalysisResults});
