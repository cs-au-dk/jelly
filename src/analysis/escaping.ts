import {ModuleInfo} from "./infos";
import {AccessPathToken, AllocationSiteToken, FunctionToken, NativeObjectToken, ObjectToken, Token} from "./tokens";
import {ConstraintVar, ObjectPropertyVar} from "./constraintvars";
import {mapGetArray} from "../misc/util";
import logger from "../misc/logger";
import {isIdentifier} from "@babel/types";
import Solver from "./solver";
import {UnknownAccessPath} from "./accesspaths";

/**
 * Finds the ObjectTokens that may be accessed from outside the module via exporting to or importing from other modules.
 * Also adds UnknownAccessPath at parameters of escaping functions.
 * Note: objects that are assigned to 'exports' (or to properties of such objects) are not considered escaping
 * (unless also returned by an escaping function or passed as argument to an external function).
 */
export function findEscapingObjects(m: ModuleInfo, solver: Solver): Set<ObjectToken> {
    const a = solver.analysisState;
    const f = solver.fragmentState;
    const worklist: Array<Token> = [];
    const visited = new Set<Token>();
    const escaping = new Set<ObjectToken>();
    const theUnknownAccessPathToken = a.canonicalizeToken(new AccessPathToken(UnknownAccessPath.instance));

    /**
     * Adds the tokens of the given constraint variable to the worklist if not already visited.
     * Note: PackageObjectTokens and AccessPathTokens are ignored.
     */
    function addToWorklist(v: ConstraintVar) {
        for (const t of f.getTokens(v))
            if ((t instanceof AllocationSiteToken || t instanceof FunctionToken || t instanceof NativeObjectToken) && !visited.has(t)) {
                worklist.push(t);
                visited.add(t);
            }
    }

    // find object properties
    const objprops = new Map<Token, Array<ObjectPropertyVar>>();
    for (const v of f.vars)
        if (v instanceof ObjectPropertyVar)
            mapGetArray(objprops, v.obj).push(v);

    // first round, seed worklist with module.exports, find functions accessible via property reads
    addToWorklist(a.varProducer.objPropVar(a.canonicalizeToken(new NativeObjectToken("module", m)), "exports"));
    const w2: Array<Token> = [];
    while (worklist.length !== 0) {
        const t = worklist.shift()!; // breadth-first
        if (t instanceof FunctionToken)
            w2.push(t);
        else if (t instanceof ObjectToken || (t instanceof NativeObjectToken && t.name === "exports"))
            for (const w of mapGetArray(objprops, t))
                addToWorklist(w);
    }
    worklist.push(...w2);
    // add expressions collected during AST traversal
    for (const v of solver.analysisState.maybeEscaping)
        addToWorklist(v);

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
            addToWorklist(a.varProducer.returnVar(t.fun));

            // add UnknownAccessPath at parameters
            for (const param of t.fun.params)
                if (isIdentifier(param)) // TODO: Pattern|RestElement?
                    solver.addToken(theUnknownAccessPathToken, f.getRepresentative(a.varProducer.nodeVar(param)));

            // TODO: also consider inheritance, ClassExtendsVar?
        }

        // properties of escaping objects are escaping
        for (const w of mapGetArray(objprops, t)) {
            addToWorklist(w);
            solver.addToken(theUnknownAccessPathToken, w);
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
