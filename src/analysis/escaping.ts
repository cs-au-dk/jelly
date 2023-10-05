import {ModuleInfo} from "./infos";
import {AccessPathToken, AllocationSiteToken, FunctionToken, NativeObjectToken, ObjectToken, Token} from "./tokens";
import {ConstraintVar, ObjectPropertyVarObj} from "./constraintvars";
import logger from "../misc/logger";
import {isIdentifier} from "@babel/types";
import Solver from "./solver";
import {UnknownAccessPath} from "./accesspaths";

/**
 * Finds the ObjectTokens that may be accessed from outside the module via exporting to or importing from other modules.
 * Also adds UnknownAccessPath at parameters of escaping functions and properties of escaping objects.
 * Note: objects that are assigned to 'exports' (or to properties of such objects) are not considered escaping
 * (unless also returned by an escaping function or passed as argument to an external function).
 */
export function findEscapingObjects(m: ModuleInfo, solver: Solver): Set<ObjectToken> {
    const a = solver.globalState;
    const f = solver.fragmentState; // (don't use in callbacks)
    const worklist: Array<ObjectPropertyVarObj> = [];
    const visited = new Set<Token>();
    const escaping = new Set<ObjectToken>();
    const theUnknownAccessPathToken = a.canonicalizeToken(new AccessPathToken(UnknownAccessPath.instance));

    /**
     * Adds the tokens of the given constraint variable to the worklist if not already visited.
     * Note: PackageObjectTokens, AccessPathTokens and (most) NativeObjectTokens are ignored.
     */
    function addToWorklist(v: ConstraintVar) {
        for (const t of f.getTokens(f.getRepresentative(v)))
            if ((t instanceof AllocationSiteToken || t instanceof FunctionToken || (t instanceof NativeObjectToken && t.name === "exports")) && !visited.has(t)) {
                worklist.push(t);
                visited.add(t);
            }
    }

    // first round, seed worklist with module.exports, find functions accessible via property reads
    addToWorklist(f.varProducer.objPropVar(a.canonicalizeToken(new NativeObjectToken("module", m)), "exports"));
    const w2: Array<ObjectPropertyVarObj> = [];
    while (worklist.length !== 0) {
        const t = worklist.shift()!; // breadth-first
        if (t instanceof FunctionToken)
            w2.push(t);
        else if (t instanceof ObjectToken || (t instanceof NativeObjectToken && t.name === "exports"))
            for (const p of f.objectProperties.get(t) ?? [])
                addToWorklist(f.varProducer.objPropVar(t, p));
    }
    visited.clear();
    for (const t of w2) {
        visited.add(t);
        worklist.push(t);
    }
    // add expressions collected during AST traversal
    for (const v of f.maybeEscapingFromModule)
        addToWorklist(v);
    f.maybeEscapingFromModule.clear(); // no longer needed

    // FIXME: arguments to (non-modeled) native functions should also be considered escaped?

    // second round, find objects that are accessible externally via functions and expressions found in first round
    while (worklist.length !== 0) {
        const t = worklist.shift()!; // breadth-first
        if (t instanceof ObjectToken) {
            if (logger.isDebugEnabled())
                logger.debug(`Escaping object: ${t}`);
            escaping.add(t);
        }
        if (t instanceof FunctionToken) {

            // values returned from escaping functions are escaping
            addToWorklist(f.varProducer.returnVar(t.fun));

            // add UnknownAccessPath at parameters
            for (const param of t.fun.params)
                if (isIdentifier(param)) // TODO: Pattern|RestElement?
                    solver.addToken(theUnknownAccessPathToken, f.getRepresentative(f.varProducer.nodeVar(param)));

            // TODO: also consider inheritance, ClassExtendsVar?
        }

        // properties of escaping objects are escaping
        for (const p of f.objectProperties.get(t) ?? []) {
            const w = f.varProducer.objPropVar(t, p);
            addToWorklist(w);
            solver.addToken(theUnknownAccessPathToken, f.getRepresentative(w));
        }
    }

    if (logger.isVerboseEnabled()) {
        const objecttokens = new Set<ObjectToken>();
        for (const [, ts] of f.getAllVarsAndTokens())
            for (const t of ts)
                if (t instanceof ObjectToken)
                    objecttokens.add(t);
        logger.verbose(`Escaping objects: ${escaping.size}/${objecttokens.size}`);
    }

    return escaping;
}
