import assert from "assert";
import {Node, blockStatement, functionExpression, identifier, traverse} from "@babel/types";
import {UnknownAccessPath} from "../../src/analysis/accesspaths";
import {ConstraintVar} from "../../src/analysis/constraintvars";
import {findEscapingObjects} from "../../src/analysis/escaping";
import {ModuleInfo, PackageInfo} from "../../src/analysis/infos";
import Solver from "../../src/analysis/solver";
import {AccessPathToken, FunctionToken, NativeObjectToken, ObjectToken} from "../../src/analysis/tokens";
import {options, resetOptions} from "../../src/options";
import {JELLY_NODE_ID} from "../../src/parsing/extras";
import {Location} from "../../src/misc/util";

describe("tests/unit/escaping", () => {
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

        const tModule = a.canonicalizeToken(new NativeObjectToken("module", m));
        const tExports = a.canonicalizeToken(new NativeObjectToken("exports", m));
        const vExports = solver.varProducer.objPropVar(tModule, "exports");
        solver.addTokenConstraint(tExports, vExports);

        const tUnknown = a.canonicalizeToken(new AccessPathToken(UnknownAccessPath.instance));

        return {
            solver, a, f, tModule, tExports, vExports, tUnknown,
            redirect: (a: ConstraintVar, b: ConstraintVar) => {
                solver.addSubsetConstraint(a, b);
                solver.addSubsetConstraint(b, a);
                assert(f.getRepresentative(a) === a && f.getRepresentative(b) === b);
                solver.redirect(a, b);
            },
        };
    };


    test("module.exports = function", () => {
        const {solver, a, f, vExports, tUnknown} = getSolver();

        solver.addTokenConstraint(a.canonicalizeToken(new FunctionToken(fun1, m)), vExports);
        expect([...f.vars]).toContain(vExports);

        const escaping = findEscapingObjects(m, solver);
        expect(escaping.size).toBe(0);

        expect([...f.getTokens(f.varProducer.nodeVar(param))]).toContain(tUnknown);
    });

    test("maybeEscapingFromModule(function)", () => {
        const {solver, a, f, tUnknown} = getSolver();

        const v = f.varProducer.intermediateVar(param, "fake");
        solver.addTokenConstraint(a.canonicalizeToken(new FunctionToken(fun1, m)), v);
        f.registerEscapingFromModule(v);

        const escaping = findEscapingObjects(m, solver);
        expect(escaping.size).toBe(0);

        expect([...f.getTokens(f.varProducer.nodeVar(param))]).toContain(tUnknown);
    });

    test("module.exports = object", () => {
        const {solver, a, f, vExports} = getSolver();

        const tObject = a.canonicalizeToken(new ObjectToken(param));
        solver.addTokenConstraint(tObject, vExports);
        const vA = f.varProducer.objPropVar(tObject, "A");
        solver.addTokenConstraint(a.canonicalizeToken(new ObjectToken(fun0)), vA);

        // Note: objects that are assigned to 'exports' (or to properties of such objects) are not considered escaping
        expect(findEscapingObjects(m, solver)).toEqual(new Set());
    });

    test("maybeEscapingFromModule(object)", () => {
        const {solver, a, f, tUnknown} = getSolver();

        const tObject = a.canonicalizeToken(new ObjectToken(param));
        const v = f.varProducer.intermediateVar(param, "fake");
        solver.addTokenConstraint(tObject, v);
        f.registerEscapingFromModule(v);

        const vA = f.varProducer.objPropVar(tObject, "A");
        const tFunction = a.canonicalizeToken(new FunctionToken(fun1, m));
        solver.addTokenConstraint(tFunction, vA);

        expect(findEscapingObjects(m, solver)).toEqual(new Set([tObject]));
        expect([...f.getTokens(vA)]).toEqual([tFunction, tUnknown]);
        expect([...f.getTokens(f.varProducer.nodeVar(param))]).toEqual([tUnknown]);
    });

    test("module.exports = object && maybeEscapingFromModule(object)", () => {
        const {solver, a, f, vExports} = getSolver();

        const tObject = a.canonicalizeToken(new ObjectToken(param));
        solver.addTokenConstraint(tObject, vExports);
        const v = f.varProducer.intermediateVar(param, "fake");
        solver.addTokenConstraint(tObject, v);
        f.registerEscapingFromModule(v);

        expect(findEscapingObjects(m, solver)).toEqual(new Set([tObject]));
    });

    test("maybeEscapingFromModule(redirected object)", () => {
        const {solver, a, f, redirect} = getSolver();

        const tObject = a.canonicalizeToken(new ObjectToken(param));
        const v = f.varProducer.intermediateVar(param, "fake");
        solver.addTokenConstraint(tObject, v);
        // the not-redirected variable escapes
        f.registerEscapingFromModule(v);

        const rep = f.varProducer.intermediateVar(param, "rep");
        redirect(v, rep);
        expect([...f.vars]).not.toContain(v);
        expect([...f.getTokens(rep)]).toContain(tObject);

        // the variable should still escape, even though it is redirected!
        expect(findEscapingObjects(m, solver)).toEqual(new Set([tObject]));
    });

    test("maybeEscapingFromModule(complex redirection)", () => {
        const {solver, a, f, tUnknown, redirect} = getSolver();

        const tObject = a.canonicalizeToken(new ObjectToken(param));
        const v = f.varProducer.intermediateVar(param, "fake");
        solver.addTokenConstraint(tObject, v);
        f.registerEscapingFromModule(v);

        const vA = f.varProducer.objPropVar(tObject, "A");
        const tFunction = a.canonicalizeToken(new FunctionToken(fun1, m));
        solver.addTokenConstraint(tFunction, vA);

        const rep = f.varProducer.intermediateVar(param, "rep");
        redirect(vA, rep);
        expect([...f.vars]).not.toContain(vA);

        expect(findEscapingObjects(m, solver)).toEqual(new Set([tObject]));
        expect([...f.getTokens(rep)]).toEqual([tFunction, tUnknown]);
        expect([...f.getTokens(f.varProducer.nodeVar(param))]).toEqual([tUnknown]);
    });
});
