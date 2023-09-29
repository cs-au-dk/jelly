import assert from "assert";
import {Node, blockStatement, functionExpression, identifier, traverse} from "@babel/types";
import {UnknownAccessPath} from "../../src/analysis/accesspaths";
import {ConstraintVar, IntermediateVar, ObjectPropertyVar} from "../../src/analysis/constraintvars";
import {findEscapingObjects} from "../../src/analysis/escaping";
import {ModuleInfo, PackageInfo} from "../../src/analysis/infos";
import Solver from "../../src/analysis/solver";
import {AccessPathToken, FunctionToken, NativeObjectToken, ObjectToken} from "../../src/analysis/tokens";
import {options, resetOptions} from "../../src/options";
import {JELLY_NODE_ID} from "../../src/parsing/extras";
import {Location} from "../../src/misc/util";
import {TokenListener} from "../../src/analysis/listeners";

describe("tests/unit/analysis", () => {
    beforeAll(() => {
        resetOptions();
        options.cycleElimination = true;
    });

    const p = new PackageInfo("fake", undefined, undefined, "fake", true);
    const packagekey = "fake@?";
    const m = new ModuleInfo("fake.js", p, true, true);

    let nextNodeID = 0;
    const fixNode = <T extends Node>(n: T): T => {
        traverse(n, {
            enter(node: Node) {
                (node as any)[JELLY_NODE_ID] ??= ++nextNodeID;
                node.loc ??= <Location>{
                    start: {line: 0, column: ++nextNodeID},
                    end: {line: 0, column: ++nextNodeID},
                    module: m,
                };
            },
        });
        return n;
    };

    const fun0 = fixNode(functionExpression(undefined, [], blockStatement([])));
    const param = fixNode(identifier("param"));
    const fun1 = fixNode(functionExpression(undefined, [param], blockStatement([])));

    const getSolver = () => {
        const solver = new Solver();
        const a = solver.globalState, f = solver.fragmentState;
        a.packageInfos.set(packagekey, p);
        a.moduleInfos.set(m.toString(), m);
        a.moduleInfosByPath.set(m.getPath(), m);

        return {
            solver, a, f,
            redirect: (a: ConstraintVar, b: ConstraintVar) => {
                assert(f.isRepresentative(a) && f.isRepresentative(b));
                solver.addSubsetEdge(a, b);
                solver.addSubsetEdge(b, a);
                solver.redirect(a, b);
            },
            getTokens: (v: ConstraintVar) => {
                assert(f.isRepresentative(v));
                return [...f.getTokens(v)];
            },
        };
    };

    describe("redirect", () => {
        let setup: ReturnType<typeof getSolver>;
        let [vA, vB, vRep, vRep1, vRep2]: Array<ConstraintVar> = [];

        beforeEach(() => {
            const {f} = setup = getSolver();
            [vA, vB, vRep, vRep1, vRep2] = "A B rep rep1 rep2".split(" ").map(s => f.varProducer.intermediateVar(param, s));
        });

        test("subset edge: source", () => {
            const {solver, f, redirect} = setup;

            solver.addSubsetConstraint(vA, vB);
            redirect(vA, vRep);

            expect(f.isRepresentative(vA)).toBeFalsy();
            assert(f.isRepresentative(vRep) && f.isRepresentative(vB));
            expect([...f.subsetEdges.get(vRep)!]).toContain(vB);
            expect([...f.subsetEdges.keys()]).not.toContain(vA);
            const revB = [...f.reverseSubsetEdges.get(vB)!];
            expect(revB).toContain(vRep);
            expect(revB).not.toContain(vA);
        });

        test("subset edge: target", () => {
            const {solver, f, redirect} = setup;

            solver.addSubsetConstraint(vA, vB);
            redirect(vB, vRep);

            expect(f.isRepresentative(vB)).toBeFalsy();
            assert(f.isRepresentative(vRep) && f.isRepresentative(vA));
            expect([...f.reverseSubsetEdges.get(vRep)!]).toContain(vA);
            expect([...f.reverseSubsetEdges.keys()]).not.toContain(vB);
            const fwA = [...f.subsetEdges.get(vA)!];
            expect(fwA).toContain(vRep);
            expect(fwA).not.toContain(vB);
        });

        test("subset edge: both", () => {
            const {solver, f, redirect} = setup;

            solver.addSubsetConstraint(vA, vB);
            redirect(vA, vRep1);
            redirect(vB, vRep2);

            expect(f.isRepresentative(vA)).toBeFalsy();
            expect(f.isRepresentative(vB)).toBeFalsy();
            assert(f.isRepresentative(vRep1) && f.isRepresentative(vRep2));
            expect([...f.subsetEdges.get(vRep1)!]).toContain(vRep2);
            expect([...f.reverseSubsetEdges.get(vRep2)!]).toContain(vRep1);
            const keys = [...f.subsetEdges.keys()];
            expect(keys).not.toContain(vA);
            expect(keys).not.toContain(vB);
        });

        test("pair listener 1", () => {
            const {solver, a, f, redirect} = setup;

            const at = a.canonicalizeToken(new ObjectToken(param));
            const ft = a.canonicalizeToken(new FunctionToken(fun0, m));

            const fn = jest.fn();
            solver.addForAllPairsConstraint(vA, vB, TokenListener.AWAIT, param, fn);
            redirect(vB, vRep1);
            solver.addTokenConstraint(ft, vB);
            solver.addSubsetConstraint(vA, vRep2);
            solver.addTokenConstraint(at, vRep2);
            assert(f.isRepresentative(vA) && f.isRepresentative(vRep2));
            solver.redirect(vA, vRep2);

            expect(f.postponedListenerCalls, "Pair listener call should be enqueued", {showMatcherMessage: false}).
                toContainEqual([fn, [at, ft]]);
        });

        test("pair listener 1 & 2", () => {
            const {solver, a, f} = setup;

            const at = a.canonicalizeToken(new ObjectToken(param));
            const ft = a.canonicalizeToken(new FunctionToken(fun0, m));

            const fn = jest.fn();
            solver.addForAllPairsConstraint(vA, vA, TokenListener.AWAIT, param, fn);
            solver.addTokenConstraint(ft, vA);
            assert(f.isRepresentative(vA) && f.isRepresentative(vRep));
            solver.addSubsetEdge(vA, vRep, false);
            solver.addTokenConstraint(at, vRep);
            solver.redirect(vA, vRep);

            expect(f.postponedListenerCalls, "Pair listener call should be enqueued", {showMatcherMessage: false}).
                toContainEqual([fn, [at, ft]]);
        });

        test("object property", () => {
            const {solver, a, f, redirect} = setup;

            const ot = a.canonicalizeToken(new ObjectToken(param));
            const ft = a.canonicalizeToken(new FunctionToken(fun0, m));
            const vA = f.varProducer.objPropVar(ot, "A");
            redirect(vA, vRep);
            solver.addTokenConstraint(ft, vRep);

            expect(
                f.objectProperties.get(ot),
                "An object property for ot should be registered regardless of redirection",
            ).toEqual(new Set(["A"]));
        });
    });

    describe("escaping", () => {
        let setup: ReturnType<typeof getSolver>;
        let tModule: NativeObjectToken, tExports: NativeObjectToken, tUnknown: AccessPathToken;
        let vExports: ObjectPropertyVar, v: IntermediateVar;

        beforeEach(() => {
            const {solver, a} = setup = getSolver();

            tUnknown = a.canonicalizeToken(new AccessPathToken(UnknownAccessPath.instance));
            tModule = a.canonicalizeToken(new NativeObjectToken("module", m));
            tExports = a.canonicalizeToken(new NativeObjectToken("exports", m));
            vExports = solver.varProducer.objPropVar(tModule, "exports");
            solver.addTokenConstraint(tExports, vExports);
            v = solver.varProducer.intermediateVar(param, "fake");
        });

        test("module.exports = function", () => {
            const {solver, a, f, getTokens} = setup;

            solver.addTokenConstraint(a.canonicalizeToken(new FunctionToken(fun1, m)), vExports);
            expect([...f.vars]).toContain(vExports);

            const escaping = findEscapingObjects(m, solver);
            expect(escaping.size).toBe(0);

            expect(getTokens(f.varProducer.nodeVar(param))).toContain(tUnknown);
        });

        test("maybeEscapingFromModule(function)", () => {
            const {solver, a, f, getTokens} = setup;

            solver.addTokenConstraint(a.canonicalizeToken(new FunctionToken(fun1, m)), v);
            f.registerEscapingFromModule(v);

            const escaping = findEscapingObjects(m, solver);
            expect(escaping.size).toBe(0);

            expect(getTokens(f.varProducer.nodeVar(param))).toContain(tUnknown);
        });

        test("module.exports = object", () => {
            const {solver, a, f} = setup;

            const tObject = a.canonicalizeToken(new ObjectToken(param));
            solver.addTokenConstraint(tObject, vExports);
            const vA = f.varProducer.objPropVar(tObject, "A");
            solver.addTokenConstraint(a.canonicalizeToken(new ObjectToken(fun0)), vA);

            // Note: objects that are assigned to 'exports' (or to properties of such objects) are not considered escaping
            expect(findEscapingObjects(m, solver)).toEqual(new Set());
        });

        test("maybeEscapingFromModule(object)", () => {
            const {solver, a, f, getTokens} = setup;

            const tObject = a.canonicalizeToken(new ObjectToken(param));
            solver.addTokenConstraint(tObject, v);
            f.registerEscapingFromModule(v);

            const vA = f.varProducer.objPropVar(tObject, "A");
            const tFunction = a.canonicalizeToken(new FunctionToken(fun1, m));
            solver.addTokenConstraint(tFunction, vA);

            expect(findEscapingObjects(m, solver)).toEqual(new Set([tObject]));
            expect(getTokens(vA)).toEqual([tFunction, tUnknown]);
            expect(getTokens(f.varProducer.nodeVar(param))).toEqual([tUnknown]);
        });

        test("module.exports = object && maybeEscapingFromModule(object)", () => {
            const {solver, a, f} = setup;

            const tObject = a.canonicalizeToken(new ObjectToken(param));
            solver.addTokenConstraint(tObject, vExports);
            solver.addTokenConstraint(tObject, v);
            f.registerEscapingFromModule(v);

            expect(findEscapingObjects(m, solver)).toEqual(new Set([tObject]));
        });

        test("maybeEscapingFromModule(redirected object)", () => {
            const {solver, a, f, redirect, getTokens} = setup;

            const tObject = a.canonicalizeToken(new ObjectToken(param));
            solver.addTokenConstraint(tObject, v);
            // the not-redirected variable escapes
            f.registerEscapingFromModule(v);

            const rep = f.varProducer.intermediateVar(param, "rep");
            redirect(v, rep);
            expect(f.isRepresentative(v)).toBeFalsy();
            expect(f.isRepresentative(rep)).toBeTruthy();
            expect(getTokens(rep)).toContain(tObject);

            // the variable should still escape, even though it is redirected!
            expect(findEscapingObjects(m, solver)).toEqual(new Set([tObject]));
        });

        test("maybeEscapingFromModule(complex redirection)", () => {
            const {solver, a, f, redirect, getTokens} = setup;

            const tObject = a.canonicalizeToken(new ObjectToken(param));
            solver.addTokenConstraint(tObject, v);
            f.registerEscapingFromModule(v);

            const vA = f.varProducer.objPropVar(tObject, "A");
            const tFunction = a.canonicalizeToken(new FunctionToken(fun1, m));
            solver.addTokenConstraint(tFunction, vA);

            const rep = f.varProducer.intermediateVar(param, "rep");
            redirect(vA, rep);
            expect(f.isRepresentative(vA)).toBeFalsy();

            expect(findEscapingObjects(m, solver)).toEqual(new Set([tObject]));
            expect(getTokens(rep)).toEqual([tFunction, tUnknown]);
            expect(getTokens(f.varProducer.nodeVar(param))).toEqual([tUnknown]);
        });
    });
});
