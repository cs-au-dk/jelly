import {isClassMethod, isFunctionDeclaration, isFunctionExpression} from "@babel/types";
import Solver from "../analysis/solver";
import {FunctionToken, ObjectToken} from "../analysis/tokens";
import logger from "../misc/logger";
import {INTERNAL_PROTOTYPE} from "../natives/ecmascript";
import {isObjectPropertyVarObj, ObjectPropertyVarObj} from "../analysis/constraintvars";
import {locationToStringWithFileAndEnd, mapGetSet} from "../misc/util";

/**
 * Patches 'this' for each function where ThisVar is empty and has listeners or outgoing subset edges,
 * unless it's a method (in which case it's typically not supposed to be instantiated)
 * or some other function inherits from it (in which case we'll instantiate that function).
 */
export function patchThis(solver: Solver) {
    const f = solver.fragmentState;
    const vp = f.varProducer;

    // find candidate functions
    const funs = new Set<FunctionToken>();
    for (const ft of f.functionTokens)
        if (isFunctionDeclaration(ft.fun) || isFunctionExpression(ft.fun) || isClassMethod(ft.fun, {kind: "constructor"})) {
            const tv = f.getRepresentative(vp.thisVar(ft.fun));
            if (f.isEmpty(tv) && (f.subsetEdges.has(tv) || f.tokenListeners.has(tv) || f.tokenListeners2.has(tv)))
                funs.add(ft);
        }

    const prototypes = new Set<ObjectPropertyVarObj>();
    const inversePrototypes = new Map<ObjectPropertyVarObj, Set<FunctionToken>>();
    for (const ft of f.functionTokens) {

        if (isClassMethod(ft.fun, {"kind": "constructor"})) {

            // for ES6 classes: <Child>.%[[Prototype]] === <Parent>
            for (const pt of f.getTokens(f.getRepresentative(vp.objPropVar(ft, INTERNAL_PROTOTYPE()))))
                if (pt instanceof FunctionToken)
                    funs.delete(pt); // class ft inherits from pt

        } else if (isFunctionDeclaration(ft.fun) || isFunctionExpression(ft.fun)) {

            // for old-style constructor functions, collect prototypes
            for (const pt of f.getTokens(f.getRepresentative(vp.objPropVar(ft, "prototype"))))
                if (isObjectPropertyVarObj(pt)) {
                    prototypes.add(pt);
                    mapGetSet(inversePrototypes, pt).add(ft);
                }
        }
    }

    for (const pt of prototypes) {

        // for old-style constructor functions: <Child>.prototype.%[[proto]] === <Parent>.prototype
        for (const qt of f.getTokens(f.getRepresentative(vp.objPropVar(pt, INTERNAL_PROTOTYPE()))))
            if (isObjectPropertyVarObj(qt)) {
                const its = inversePrototypes.get(qt);
                if (its)
                    for (const it of its)
                        funs.delete(it); // constructor inherits from it
            }

        // for old-style constructor functions: <Constructor>.prototype.<Method>
        const props = f.objectProperties.get(pt);
        if (props)
            for (const prop of props)
                if (prop !== "constructor")
                    for (const mt of f.getTokens(f.getRepresentative(vp.objPropVar(pt, prop))))
                        if (mt instanceof FunctionToken)
                            funs.delete(mt); // constructor has method mt
    }

    for (const ft of funs) {
        if (logger.isDebugEnabled())
            logger.debug(`patchThis ${locationToStringWithFileAndEnd(ft.fun.loc)}`);

        // constraint: q ∈ ⟦this_f⟧ where q is the instance object
        const q = solver.globalState.canonicalizeToken(new ObjectToken(ft.fun));
        solver.addTokenConstraint(q, vp.thisVar(ft.fun));

        // constraint: ⟦t.prototype⟧ ⊆ ⟦q.[[Prototype]]⟧
        solver.addInherits(q, vp.objPropVar(ft, "prototype"));
    }
}