import {AnalysisState} from "../analysis/analysisstate";
import {AccessPathPatternCanonicalizer} from "./patternparser";
import {
    AllocationSiteToken,
    FunctionToken,
    NativeObjectToken,
    ObjectToken,
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
import {mapGetSet, sourceLocationContains, sourceLocationToStringWithFileAndEnd} from "../misc/util";
import {ConstraintVar, FunctionReturnVar, ObjectPropertyVar, ObjectPropertyVarObj} from "../analysis/constraintvars";
import {resolve} from "path";
import {FunctionInfo, ModuleInfo} from "../analysis/infos";
import assert from "assert";

const MAX_ACCESS_PATHS = 10;

/**
 * Find the exported API of all modules.
 */
export function getAPIExported(a: AnalysisState, f: FragmentState): Map<ObjectPropertyVarObj, Set<AccessPathPattern>> {
    logger.info("Collecting exported API");
    const c = new AccessPathPatternCanonicalizer;
    const res = new Map<ObjectPropertyVarObj, Set<AccessPathPattern>>();
    const worklist = new Map<ObjectPropertyVarObj, Set<AccessPathPattern>>();

    function add(v: ConstraintVar, ap: ImportAccessPathPattern | PropertyAccessPathPattern | CallResultAccessPathPattern) {
        for (const t of f.getTokens(v))
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
                        logger.info(`Access path for ${t.fun.type} at ${sourceLocationToStringWithFileAndEnd(t.fun.loc)}: ${ap}`);
                aps.add(ap);
                mapGetSet(worklist, t).add(ap);
            }
    }

    // find object properties
    const objprops = new Map<ObjectPropertyVarObj, Set<string>>();
    for (const v of f.vars)
        if (v instanceof ObjectPropertyVar)
            mapGetSet(objprops, v.obj).add(v.prop);

    // find exports
    for (const m of a.moduleInfos.values())
        add(a.canonicalizeVar(new ObjectPropertyVar(a.canonicalizeToken(new NativeObjectToken("module", m)), "exports")),
            c.canonicalize(new ImportAccessPathPattern(m.getOfficialName()))); // TODO: technically, official-name is not a glob?

    // iteratively find reachable objects and functions
    for (const [t, aps] of worklist)
        for (const ap of aps) {
            aps.delete(ap);
            if (aps.size === 0)
                worklist.delete(t);

            // look at object properties
           if (t instanceof ObjectToken || t instanceof NativeObjectToken || t instanceof PackageObjectToken)
                for (const prop of mapGetSet(objprops, t))
                    add(a.canonicalizeVar(new ObjectPropertyVar(t, prop)),
                        c.canonicalize(new PropertyAccessPathPattern(ap, [prop])))

            // look at function returns
            if (t instanceof FunctionToken)
                add(a.canonicalizeVar(new FunctionReturnVar(t.fun)),
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
                logger.info(`${sourceLocationToStringWithFileAndEnd(t.fun.loc)}: ${ap}`);
}

/**
 * Finds the function or module (as a top-level) at the given location.
 */
function findFunctionAtLocation(a: AnalysisState, loc: string): FunctionInfo | ModuleInfo | undefined {
    const i = loc.lastIndexOf(":");
    if (i != -1) {
        const file = resolve(loc.substring(0, i));
        const line = parseInt(loc.substring(i + 1), 10);
        const modinfo = a.moduleInfos.get(file);
        if (line > 0 && modinfo && modinfo.node?.loc && line <= modinfo.node.loc.end.line) {
            let best: FunctionInfo | ModuleInfo = modinfo;
            for (const [fun, funinfo] of a.functionInfos)
                if (fun.loc && sourceLocationContains(fun.loc, file, line))
                    if (best.node!.loc!.start.line < fun.loc.start.line || fun.loc.end.line < best.node!.loc!.end.line)
                        best = funinfo; // assuming only a single best match on that line
            return best;
        }
    }
    return undefined;
}

function getReverseCallGraph(a: AnalysisState): Map<FunctionInfo, Set<FunctionInfo | ModuleInfo>> {
    const r = new Map<FunctionInfo, Set<FunctionInfo | ModuleInfo>>();
    for (const [from, tos] of a.functionToFunction)
            for (const to of tos)
                mapGetSet(r, to).add(from);
    return r;
}

function getReverseRequireGraph(a: AnalysisState): Map<ModuleInfo, Set<FunctionInfo | ModuleInfo>> {
    const r = new Map<ModuleInfo, Set<FunctionInfo | ModuleInfo>>();
    for (const [from, tos] of a.requireGraph)
        for (const to of tos)
            mapGetSet(r, to).add(from);
    return r;
}

/**
 * Finds the functions and modules (as top-level functions) that may reach the given function.
 * The functions and modules are the keys of the resulting map; the values are the successors toward the given function.
 */
function findReachingFunctions(a: AnalysisState, fun: FunctionInfo | ModuleInfo): Map<FunctionInfo | ModuleInfo, Set<FunctionInfo | ModuleInfo>> {
    const callers = getReverseCallGraph(a);
    const requires = getReverseRequireGraph(a);
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
export function reportAccessPaths(a: AnalysisState, r: Map<ObjectPropertyVarObj, Set<AccessPathPattern>>, loc: string) {
    const fun = findFunctionAtLocation(a, loc);
    if (!fun) {
        logger.error(`Location ${loc} not found`);
        return;
    }
    if (logger.isDebugEnabled())
        logger.debug(`${loc} belongs to ${fun}`);
    const reach = findReachingFunctions(a, fun);
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
            const f = a.functionInfos.get(t.fun);
            assert(f);
            if (reach.has(f)) {
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