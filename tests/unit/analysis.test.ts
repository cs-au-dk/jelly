import assert from "assert";
import {Node, blockStatement, functionExpression, identifier, traverse, SourceLocation} from "@babel/types";
import {UnknownAccessPath} from "../../src/analysis/accesspaths";
import {ConstraintVar, IntermediateVar, ObjectPropertyVar, isObjectPropertyVarObj} from "../../src/analysis/constraintvars";
import {findEscapingObjects} from "../../src/analysis/escaping";
import {ModuleInfo, PackageInfo} from "../../src/analysis/infos";
import Solver from "../../src/analysis/solver";
import {
    AccessPathToken,
    ArrayToken,
    FunctionToken,
    NativeObjectToken,
    ObjectToken,
    PackageObjectToken,
    Token,
} from "../../src/analysis/tokens";
import {options, resetOptions} from "../../src/options";
import {JELLY_NODE_ID} from "../../src/parsing/extras";
import {TokenListener} from "../../src/analysis/listeners";
import {Operations} from "../../src/analysis/operations";
import {widenObjects} from "../../src/analysis/widening";
import {patchDynamics} from "../../src/patching/patchdynamics";
import "../../src/testing/compare";

describe("tests/unit/analysis", () => {
    beforeEach(() => {
        resetOptions();
        options.cycleElimination = true;
    });

    const p = new PackageInfo("fake", undefined, undefined, "node_modules/fake", true);
    const packagekey = "fake@?";
    const m = new ModuleInfo("fake.js", p, true, true);

    let nextNodeID = 0;
    const fixNode = <T extends Node>(n: T): T => {
        traverse(n, {
            enter(node: Node) {
                (node as any)[JELLY_NODE_ID] ??= ++nextNodeID;
                node.loc ??= {
                    start: {line: nextNodeID, column: ++nextNodeID},
                    end: {line: nextNodeID, column: ++nextNodeID},
                    module: m,
                } as unknown as SourceLocation;
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

        test("object property", () => {
            const {solver, a, f, redirect} = setup;

            const ot = a.canonicalizeToken(new ObjectToken(param));
            const ft = a.canonicalizeToken(new FunctionToken(fun0));
            const vA = f.varProducer.objPropVar(ot, "A");
            redirect(vA, vRep);
            solver.addTokenConstraint(ft, vRep);

            expect(
                f.objectProperties.get(ot),
                "An object property for ot should be registered regardless of redirection",
            ).toEqual(new Set(["A"]));
        });

        test("read property chain getters", async () => {
            const {solver, a, f, redirect, getTokens} = setup;

            const ot1 = a.canonicalizeToken(new ObjectToken(fun0));
            const ot2 = a.canonicalizeToken(new ObjectToken(fun1));
            const g1 = f.varProducer.objPropVar(ot1, "A", "get");
            const g2 = f.varProducer.objPropVar(ot2, "A", "get");
            redirect(g1, g2);

            // fun0 is a getter that returns an array
            const ft = a.canonicalizeToken(new FunctionToken(fun0));
            const at = a.canonicalizeToken(new ArrayToken(fun0));
            solver.addTokenConstraint(ft, g2);
            solver.addTokenConstraint(at, solver.varProducer.returnVar(fun0));

            const op = new Operations(m.getPath(), solver, new Map());
            const r2 = op.readPropertyFromChain(ot2, "A")!;
            await solver.propagate("test");
            expect(getTokens(r2)).toEqual([at]);

            // both tokens should be able to read from the getter(s)
            const r1 = op.readPropertyFromChain(ot1, "A")!;
            await solver.propagate("test");
            expect(getTokens(r1)).toEqual([at]);
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

            solver.addTokenConstraint(a.canonicalizeToken(new FunctionToken(fun1)), vExports);
            expect([...f.vars]).toContain(vExports);

            const escaping = findEscapingObjects(m, solver);
            expect(escaping.size).toBe(0);

            expect(getTokens(f.varProducer.nodeVar(param))).toContain(tUnknown);
            expect(getTokens(f.varProducer.thisVar(fun1))).toContain(tUnknown);
        });

        test("maybeEscapingFromModule(function)", () => {
            const {solver, a, f, getTokens} = setup;

            solver.addTokenConstraint(a.canonicalizeToken(new FunctionToken(fun1)), v);
            f.registerEscaping(v);

            const escaping = findEscapingObjects(m, solver);
            expect(escaping.size).toBe(0);

            expect(getTokens(f.varProducer.nodeVar(param))).toContain(tUnknown);
        });

        test("module.exports = object", () => {
            const {solver, a, f} = setup;

            const tObject = a.canonicalizeToken(new ObjectToken(param));
            solver.addTokenConstraint(tObject, vExports);

            const vA = f.varProducer.objPropVar(tObject, "A");
            const tObject2 = a.canonicalizeToken(new ObjectToken(fun0));
            expect(tObject).not.toBe(tObject2);
            solver.addTokenConstraint(tObject2, vA);

            // Note: objects that are assigned to 'exports' (or to properties of such objects) are not considered escaping
            expect(findEscapingObjects(m, solver)).toEqual(new Set());
        });

        test("maybeEscapingFromModule(object)", () => {
            const {solver, a, f, getTokens} = setup;

            const tObject = a.canonicalizeToken(new ObjectToken(param));
            solver.addTokenConstraint(tObject, v);
            f.registerEscaping(v);

            const vA = f.varProducer.objPropVar(tObject, "A");
            const tFunction = a.canonicalizeToken(new FunctionToken(fun1));
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
            f.registerEscaping(v);

            expect(findEscapingObjects(m, solver)).toEqual(new Set([tObject]));
        });

        test("maybeEscapingFromModule(redirected object)", () => {
            const {solver, a, f, redirect, getTokens} = setup;

            const tObject = a.canonicalizeToken(new ObjectToken(param));
            solver.addTokenConstraint(tObject, v);
            // the not-redirected variable escapes
            f.registerEscaping(v);

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
            f.registerEscaping(v);

            const vA = f.varProducer.objPropVar(tObject, "A");
            const tFunction = a.canonicalizeToken(new FunctionToken(fun1));
            solver.addTokenConstraint(tFunction, vA);

            const rep = f.varProducer.intermediateVar(param, "rep");
            redirect(vA, rep);
            expect(f.isRepresentative(vA)).toBeFalsy();

            expect(findEscapingObjects(m, solver)).toEqual(new Set([tObject]));
            expect(getTokens(rep)).toEqual([tFunction, tUnknown]);
            expect(getTokens(f.varProducer.nodeVar(param))).toEqual([tUnknown]);
        });

        test.each(["./fake.js", "./*", "./*.js"])("exported library module: %s", (pattern: string) => {
            const {solver, a, f, getTokens} = setup;

            a.packageJsonInfos.set(p.dir, {
                name: p.name,
                dir: p.dir,
                version: undefined,
                main: undefined,
                packagekey,
                exports: [pattern],
            });

            solver.addTokenConstraint(a.canonicalizeToken(new FunctionToken(fun1)), vExports);
            expect(findEscapingObjects(m, solver).size).toBe(0);
            expect(getTokens(f.varProducer.nodeVar(param))).toContain(tUnknown);
        });

        test("unexported library module", () => {
            const {solver, a, f, getTokens} = setup;

            a.packageJsonInfos.set(p.dir, {
                name: p.name,
                dir: p.dir,
                version: undefined,
                main: undefined,
                packagekey,
                exports: ["./other-file.js"],
            });

            solver.addTokenConstraint(a.canonicalizeToken(new FunctionToken(fun1)), vExports);
            expect(findEscapingObjects(m, solver).size).toBe(0);
            expect(getTokens(f.varProducer.nodeVar(param))).not.toContain(tUnknown);
        });
    });

    describe("widening", () => {
        let setup: ReturnType<typeof getSolver>;
        let [vA]: Array<ConstraintVar> = [];
        let ot: ObjectToken;
        let pt: PackageObjectToken;

        beforeEach(() => {
            const {f, a} = setup = getSolver();
            ot = a.canonicalizeToken(new ObjectToken(param));
            pt = a.canonicalizeToken(new PackageObjectToken(p));
            [vA] = "A B rep rep1 rep2".split(" ").map(s => f.varProducer.intermediateVar(param, s));
        });

        test("simple", () => {
            const {solver, f, a, getTokens} = setup;
            solver.addTokenConstraint(ot, vA);
            const ot2 = a.canonicalizeToken(new ObjectToken(fun0));
            solver.addTokenConstraint(ot2, vA);

            widenObjects(new Set([ot]), solver);

            expect([...f.widened]).toContain(ot);
            expect([...f.widened]).not.toContain(ot2);
            expect(getTokens(vA).sort()).toEqual([ot2, pt].sort());
        });

        test("token is put in unprocessedTokens for PackagePropVar", () => {
            const {solver, f, getTokens} = setup;

            const ppV = f.varProducer.packagePropVar(p, "A");
            const opV = f.varProducer.objPropVar(ot, "A");
            solver.addTokenConstraint(ot, opV);

            widenObjects(new Set([ot]), solver);

            expect(f.getRepresentative(opV)).toBe(ppV);
            expect(getTokens(ppV)).toEqual([pt]);
            assert(f.isRepresentative(ppV));
            expect(solver.unprocessedTokens.get(ppV)).toEqual(pt);
        });

        test("PackageObjectToken gets object properties", () => {
            const {solver, f} = setup;

            solver.addObjectProperty(ot, "A");

            const fn = jest.fn();
            solver.addForAllObjectPropertiesConstraint(pt, TokenListener.AWAIT, param, fn);

            widenObjects(new Set([ot]), solver);

            expect(f.objectProperties.get(pt)).toEqual(new Set(["A"]));
            expect(f.postponedListenerCalls, "Object property listener should be enqueued", {showMatcherMessage: false}).
                toContainEqual([fn, "A"]);
        });

        test("PackagePropVar gets object property listeners", () => {
            const {solver, a, f} = setup;

            const ot1 = a.canonicalizeToken(new ObjectToken(fun0));
            expect(ot).not.toBe(ot1);

            const ot2 = a.canonicalizeToken(new ObjectToken(fun1));
            const fn1 = jest.fn();
            const fn2 = jest.fn();
            solver.addForAllObjectPropertiesConstraint(ot1, TokenListener.NATIVE_ASSIGN_ITERATOR_MAP_VALUE_PAIRS, param, fn1);
            solver.addForAllObjectPropertiesConstraint(ot2, TokenListener.NATIVE_ASSIGN_BASE_ARRAY_ARRAY_VALUE_TO_ARRAY, param, fn2);

            solver.addObjectProperty(ot, "A");

            widenObjects(new Set([ot, ot1, ot2]), solver);

            expect(f.objectProperties.get(pt)).toEqual(new Set(["A"]));
            expect([...f.objectProperties.keys()]).toEqual([pt]);
            expect([...f.objectPropertiesListeners.keys()]).toEqual([pt]);
            expect(f.objectPropertiesListeners.get(pt)!.size).toBe(2);
            expect(f.postponedListenerCalls, "Object property listener 1 should be enqueued", {showMatcherMessage: false}).
                toContainEqual([fn1, "A"]);
            expect(f.postponedListenerCalls, "Object property listener 2 should be enqueued", {showMatcherMessage: false}).
                toContainEqual([fn2, "A"]);
        });

        test("PackagePropVar gets listeners from redirected ObjectPropertyVar", async () => {
            const {solver, f, redirect} = setup;

            const ppV = f.varProducer.packagePropVar(p, "A");
            solver.addTokenConstraint(pt, ppV);

            const opV = f.varProducer.objPropVar(ot, "A");
            const fn = jest.fn();
            solver.addForAllTokensConstraint(opV, TokenListener.AWAIT, param, fn);

            redirect(opV, vA);
            await solver.propagate("test"); // clear nodesWithNewEdges

            widenObjects(new Set([ot]), solver);

            expect(fn).not.toHaveBeenCalled();
            expect(f.postponedListenerCalls, "Token listener should be enqueued", {showMatcherMessage: false}).
                toContainEqual([fn, pt]);
        });

        test("PackageObjectToken gets ancestor listeners", async () => {
            const {solver} = setup;

            solver.addTokenConstraint(ot, vA);
            const fn = jest.fn();
            solver.addForAllTokensConstraint(vA, TokenListener.WRITE_BASE, param, (t: Token) => {
                assert(isObjectPropertyVarObj(t));
                solver.addForAllAncestorsConstraint(t, TokenListener.WRITE_ANCESTORS, {n: param}, fn);
            });

            await solver.propagate("test");
            expect(fn).toHaveBeenLastCalledWith(ot);

            widenObjects(new Set([ot]), solver);

            await solver.propagate("test");
            expect(fn).toHaveBeenLastCalledWith(pt);
        });

        test("Ancestor listener triggers for widened ancestor", async () => {
            const {solver, a} = setup;

            const fn = jest.fn();
            solver.addForAllAncestorsConstraint(ot, TokenListener.READ_ANCESTORS, {n: param}, fn);

            await solver.propagate("test");
            expect(fn).toHaveBeenLastCalledWith(ot);

            const anc = a.canonicalizeToken(new ObjectToken(fun0));
            solver.addInherits(ot, anc);

            await solver.propagate("test");
            expect(fn).toHaveBeenLastCalledWith(anc);

            widenObjects(new Set([anc]), solver);

            await solver.propagate("test");
            expect(fn).toHaveBeenLastCalledWith(pt);
        });
    });

    describe("patch dynamics", () => {
        test("cycle elimination", () => {
            options.patchDynamics = true;
            const {solver: solver1} = getSolver();
            const {solver: solver2} = getSolver();

            const fun = (solver: Solver, doCycleElimination: boolean) => {
                // Set up the solver with two distinct empty property reads.
                // The result variables of the reads are in a subset cycle.
                // Both base variables contain the same token, which has been
                // subject to a dynamic property write.
                // If doCycleElimination is true, the two result variables are
                // merged. This should not affect the result of the analysis!
                const a = solver.globalState;
                const ot = a.canonicalizeToken(new ObjectToken(param));
                const pt = a.canonicalizeToken(new PackageObjectToken(p));

                const f = solver.fragmentState;
                const [base1, base2, res1, res2] = "base1 base2 res1 res2".split(" ").map(s => solver.fragmentState.varProducer.intermediateVar(param, s));
                solver.addSubsetConstraint(res1, res2);
                solver.addSubsetConstraint(res2, res1);
                if (doCycleElimination) {
                    assert(f.isRepresentative(res1) && f.isRepresentative(res2));
                    solver.redirect(res1, res2);
                }

                solver.fragmentState.registerPropertyRead("read", res1, base1, pt, "A", param, m);
                solver.fragmentState.registerPropertyRead("read", res2, base2, pt, "A", param, m);
                solver.fragmentState.registerDynamicPropertyWrite(base1);
                solver.addTokenConstraint(ot, base1);
                solver.addTokenConstraint(ot, base2);

                expect(patchDynamics(solver)).toBeTruthy();
            };

            fun(solver1, true);
            fun(solver2, false);

            // TODO: remove cast
            // requires 'import {expect} from "@jest/globals";', but that breaks multi-arg expect
            // from 'jest-expect-message'
            (expect(solver2) as any).toMatchAnalysisResults(solver1);
        });
    });
});
