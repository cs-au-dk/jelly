import {GlobalState} from "../analysis/globalstate";
import {AccessPathPatternCanonicalizer} from "./patternparser";
import {
    AllocationSiteToken,
    FunctionToken,
    NativeObjectToken,
    PackageObjectToken
} from "../analysis/tokens";
import {FragmentState} from "../analysis/fragmentstate";
import {
    AccessPathPattern,
    CallResultAccessPathPattern,
    ImportAccessPathPattern,
    PropertyAccessPathPattern
} from "./patterns";
import logger from "../misc/logger";
import {mapGetSet, locationContains, locationToStringWithFileAndEnd} from "../misc/util";
import {ConstraintVar, FunctionReturnVar, ObjectPropertyVarObj} from "../analysis/constraintvars";
import {resolve} from "path";
import {FunctionInfo, ModuleInfo} from "../analysis/infos";
import assert from "assert";
import {isInternalProperty} from "../natives/ecmascript";

const MAX_ACCESS_PATHS = 10;

/**
 * Find the exported API of all modules.
 */
export function getAPIExported(f: FragmentState): Map<ObjectPropertyVarObj, Set<AccessPathPattern>> {
    logger.info("Collecting exported API");
    const c = new AccessPathPatternCanonicalizer;
    const res = new Map<ObjectPropertyVarObj, Set<AccessPathPattern>>();
    const worklist = new Map<ObjectPropertyVarObj, Set<AccessPathPattern>>();

    function add(v: ConstraintVar, ap: ImportAccessPathPattern | PropertyAccessPathPattern | CallResultAccessPathPattern) {
        for (const t of f.getTokens(f.getRepresentative(v)))
            // TODO: ignore certain tokens? ((t instanceof NativeObjectToken && t.name === "exports") || t instanceof AllocationSiteToken || t instanceof FunctionToken) {
            if (t instanceof NativeObjectToken || t instanceof AllocationSiteToken || t instanceof FunctionToken || t instanceof PackageObjectToken) {
                const aps = mapGetSet(res, t);
                let prefix: AccessPathPattern = ap;
                do { // check if a prefix has already been recorded
                    if (aps.has(prefix))
                        return;
                    if (prefix instanceof PropertyAccessPathPattern)
                        prefix = prefix.base;
                    else if (prefix instanceof CallResultAccessPathPattern)
                        prefix = prefix.fun;
                } while (!(prefix instanceof ImportAccessPathPattern));
                if (aps.size + 1 >= MAX_ACCESS_PATHS) {
                    logger.debug(`Reached ${MAX_ACCESS_PATHS} access paths for ${t}, skipping remaining ones`);
                    if (aps.size >= MAX_ACCESS_PATHS)
                        continue;
                }
                if (logger.isDebugEnabled())
                    logger.debug(`Added access path for ${t}: ${ap}`);
                if (logger.isVerboseEnabled())
                    if (t instanceof FunctionToken)
                        logger.info(`Access path for ${t.fun.type} at ${locationToStringWithFileAndEnd(t.fun.loc)}: ${ap}`);
                aps.add(ap);
                mapGetSet(worklist, t).add(ap);
            }
    }

    // find exports
    for (const m of f.a.moduleInfos.values())
        add(f.varProducer.objPropVar(f.a.canonicalizeToken(new NativeObjectToken("module", m)), "exports"),
            c.canonicalize(new ImportAccessPathPattern(m.getOfficialName()))); // TODO: technically, official-name is not a glob?

    // iteratively find reachable objects and functions
    for (const [t, aps] of worklist)
        for (const ap of aps) {
            aps.delete(ap);
            if (aps.size === 0)
                worklist.delete(t);

            // look at object properties
            for (const prop of f.objectProperties.get(t) ?? [])
                if (!isInternalProperty(prop))
                    add(f.varProducer.objPropVar(t, prop),
                        c.canonicalize(new PropertyAccessPathPattern(ap, [prop])));

            // look at function returns
            if (t instanceof FunctionToken)
                add(f.a.canonicalizeVar(new FunctionReturnVar(t.fun)),
                    c.canonicalize(new CallResultAccessPathPattern(ap)));

            // TODO: we don't have patterns for class instantiation, methods and fields are described as properties of the classes
        }

    return res;
}

/**
 * Reports access paths for all exported functions.
 */
export function reportAPIExportedFunctions(r: Map<ObjectPropertyVarObj, Set<AccessPathPattern>>) {
    for (const [t, aps] of r)
        for (const ap of aps)
            if (t instanceof FunctionToken)
                logger.info(`${locationToStringWithFileAndEnd(t.fun.loc)}: ${ap}`);
}

/**
 * Finds the function or module (as a top-level) at the given location.
 */
function findFunctionAtLocation(a: GlobalState, loc: string): FunctionInfo | ModuleInfo | undefined {
    const i = loc.lastIndexOf(":");
    if (i != -1) {
        const file = resolve(loc.substring(0, i));
        const line = parseInt(loc.substring(i + 1), 10);
        const modinfo = a.moduleInfosByPath.get(file);
        if (line > 0 && modinfo && modinfo.loc && line <= modinfo.loc.end.line) {
            let best: FunctionInfo | ModuleInfo = modinfo;
            for (const funinfo of a.functionInfos.values())
                if (locationContains(funinfo.loc, file, line))
                    if (best.loc!.start.line < funinfo.loc.start.line || funinfo.loc.end.line < best.loc!.end.line)
                        best = funinfo; // assuming only a single best match on that line
            return best;
        }
    }
    return undefined;
}

function getReverseGraph<N1, N2>(g: Map<N1, Set<N2>>): Map<N2, Set<N1>> {
    const r = new Map<N2, Set<N1>>();
    for (const [from, tos] of g)
        for (const to of tos)
            mapGetSet(r, to).add(from);
    return r;
}

/**
 * Finds the functions and modules (as top-level functions) that may reach the given function.
 * The functions and modules are the keys of the resulting map; the values are the successors toward the given function.
 */
function findReachingFunctions(f: FragmentState, fun: FunctionInfo | ModuleInfo): Map<FunctionInfo | ModuleInfo, Set<FunctionInfo | ModuleInfo>> {
    const callers = getReverseGraph(f.functionToFunction);
    const requires = getReverseGraph(f.requireGraph);
    const r = new Map<FunctionInfo | ModuleInfo, Set<FunctionInfo | ModuleInfo>>();
    const w = new Set<FunctionInfo | ModuleInfo>();
    r.set(fun, new Set());
    w.add(fun);
    for (const f of w) {
        w.delete(f);
        const ps = f instanceof FunctionInfo ? callers.get(f) : requires.get(f);
        if (ps)
            for (const p of ps) {
                if (!r.has(p))
                    w.add(p);
                mapGetSet(r, p).add(f);
            }
    }
    return r;
}

/**
 * Reports access paths for functions and modules (as top-level functions) that may reach the given location.
 */
export function reportAccessPaths(f: FragmentState, r: Map<ObjectPropertyVarObj, Set<AccessPathPattern>>, loc: string) {
    const fun = findFunctionAtLocation(f.a, loc);
    if (!fun) {
        logger.error(`Location ${loc} not found`);
        return;
    }
    if (logger.isDebugEnabled())
        logger.debug(`${loc} belongs to ${fun}`);
    const reach = findReachingFunctions(f, fun);
    logger.info(`Functions that may reach ${loc} (nearest first):`);
    for (const [f, ns] of reach) {
        logger.info(` ${f}`);
        for (const n of ns)
            logger.info(`  ↳ ${n}`);
    }
    logger.info(`Access paths that may reach ${loc}:`);
    for (const m of reach.keys())
        if (m instanceof ModuleInfo)
            logger.info(` ${new ImportAccessPathPattern(m.getOfficialName())}`);
    let more = false;
    const all = new Set<string>();
    for (const [t, aps] of r)
        if (t instanceof FunctionToken) {
            const n = f.a.functionInfos.get(t.fun);
            assert(n);
            if (reach.has(n)) {
                for (const ap of aps)
                    all.add(ap.toString());
                if (aps.size >= MAX_ACCESS_PATHS)
                    more = true;
            }
        }
    for (const ap of Array.from(all).sort())
        logger.info(` ${ap}`);
    if (more)
        logger.info(" ...");
}
