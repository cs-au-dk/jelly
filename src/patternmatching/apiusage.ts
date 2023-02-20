import {AnalysisState} from "../analysis/analysisstate";
import logger from "../misc/logger";
import {mapGetSet, sourceLocationToStringWithFileAndEnd, SourceLocationWithFilename} from "../misc/util";
import {
    AbbreviatedPathPattern,
    AccessPathPattern,
    CallResultAccessPathPattern,
    ComponentAccessPathPattern,
    ImportAccessPathPattern,
    PropertyAccessPathPattern
} from "./patterns";
import {isCallExpression, isNewExpression, isOptionalCallExpression, Node} from "@babel/types";
import {AccessPathPatternCanonicalizer} from "./patternparser";
import {AccessPath} from "../analysis/accesspaths";

export type PatternType = "import" | "read" | "write" | "call" | "component";

export type AccessPathPatternToNodes = Record<PatternType, Map<AccessPathPattern, Set<Node>>>;
export type NodeToAccessPathPatterns = Record<PatternType, Map<Node, Set<AccessPathPattern>>>;
export type AccessPathString = string;
export type AccessPathPatternStringToNodes = Record<PatternType, Record<AccessPathString, Array<SourceLocationWithFilename>>>;

/**
 * Finds the usage of the API of external modules.
 */
export function getAPIUsage(a: AnalysisState): [AccessPathPatternToNodes, NodeToAccessPathPatterns] { // TODO: parameter to choose which map to produce?
    logger.info("Collecting API usage");
    const reached: AccessPathPatternToNodes = {import: new Map, read: new Map, write: new Map, call: new Map, component: new Map};
    const res1: AccessPathPatternToNodes = {import: new Map, read: new Map, write: new Map, call: new Map, component: new Map};
    const res2: NodeToAccessPathPatterns = {import: new Map, read: new Map, write: new Map, call: new Map, component: new Map};
    const c = new AccessPathPatternCanonicalizer;
    const worklist = new Map<AccessPathPattern, Set<AccessPath>>();

    function add(t: PatternType, p: AccessPathPattern, ap: AccessPath, n: Node) {

        function sub(p: AccessPathPattern): AccessPathPattern | undefined {
            return p instanceof PropertyAccessPathPattern ? p.base :
                    p instanceof CallResultAccessPathPattern ? p.fun :
                        p instanceof ComponentAccessPathPattern ? p.component :
                            undefined;
        }

        function copyWithSub(as: AccessPathPattern, sub: AccessPathPattern): AccessPathPattern {
            if (as instanceof PropertyAccessPathPattern)
                return new PropertyAccessPathPattern(sub, as.props);
            else if (as instanceof CallResultAccessPathPattern)
                return new CallResultAccessPathPattern(sub);
            else if (as instanceof ComponentAccessPathPattern)
                return new ComponentAccessPathPattern(sub);
            else
                return as;
        }

        // abbreviate long patterns
        const p1 = sub(p);
        if (p1) {
            const p2 = sub(p1);
            if (p2) {
                if (p2 instanceof AbbreviatedPathPattern && p1 instanceof CallResultAccessPathPattern && !(p instanceof CallResultAccessPathPattern)) // m…()d --> m…d
                    p = copyWithSub(p, p2);
                else {
                    const p3 = sub(p2);
                    if (p3) {
                        if (p3 instanceof AbbreviatedPathPattern) {
                            if (p1 instanceof CallResultAccessPathPattern) // m…b()d --> m…d
                                p = copyWithSub(p, p3);
                            else // m…bcd --> m…cd
                                p = copyWithSub(p, copyWithSub(p1, p3));
                        } else {
                            const p4 = sub(p3);
                            if (p4)
                                if (p1 instanceof CallResultAccessPathPattern) // mab()d --> ma…d
                                    p = copyWithSub(p, new AbbreviatedPathPattern(p3));
                                else // mabcd --> ma…cd
                                    p = copyWithSub(p, copyWithSub(p1, new AbbreviatedPathPattern(p3)));

                        }
                    }
                }
            }
        }

        p = c.canonicalize(p);
        const aps = mapGetSet(reached[t], p);
        if (!aps.has(n)) {
            if (logger.isDebugEnabled())
                logger.debug(`Found ${t} ${p} at ${sourceLocationToStringWithFileAndEnd(n.loc)}`);
            aps.add(n);
            function isReadAtCall(): boolean {
                if (t === "read") {
                    const m = a.callResultAccessPaths.get(ap);
                    if (m)
                        for (const f of m.keys())
                            if ((isCallExpression(f) || isOptionalCallExpression(f) || isNewExpression(f)) && f.callee === n)
                                return true;
                }
                return false;
            }
            if (isReadAtCall()) { // if read occurs at call function expression, exclude in output
                if (logger.isDebugEnabled())
                    logger.debug(`Read-call ${ap} at ${sourceLocationToStringWithFileAndEnd(n.loc)}`);
            } else {
                mapGetSet(res1[t], p).add(n);
                mapGetSet(res2[t], n).add(p);
            }
            mapGetSet(worklist, p).add(ap);
        }
    }
    // find imports
    for (const [ap, ns] of a.moduleAccessPaths)
        for (const n of ns)
            add("import", c.canonicalize(new ImportAccessPathPattern(ap.moduleInfo.getOfficialName())), ap, n); // TODO: technically, official-name is not a glob?
    // iteratively find property reads, writes, calls and components
    for (const [p, aps] of worklist)
        for (const ap of aps) {
            aps.delete(ap);
            if (aps.size === 0)
                worklist.delete(p);
            // property reads
            const m1 = a.propertyReadAccessPaths.get(ap);
            if (m1)
                for (const [prop, np] of m1)
                    for (const [n2, {bp}] of np)
                        add("read", c.canonicalize(new PropertyAccessPathPattern(p, [prop])), bp, n2);
            // property writes
            const m2 = a.propertyWriteAccessPaths.get(ap);
            if (m2)
                for (const [prop, np] of m2)
                    for (const [n2, {bp}] of np)
                        add("write", c.canonicalize(new PropertyAccessPathPattern(p, [prop])), bp, n2);
            // calls
            const m3 = a.callResultAccessPaths.get(ap);
            if (m3)
                for (const [n2, {bp}] of m3)
                    add("call", c.canonicalize(new CallResultAccessPathPattern(p)), bp, n2);
            // components
            const m4 = a.componentAccessPaths.get(ap);
            if (m4)
                for (const [n2, {bp}] of m4)
                    add("component", c.canonicalize(new ComponentAccessPathPattern(p)), bp, n2);
        }
    return [res1, res2];
}

export function reportAPIUsage(r1: AccessPathPatternToNodes, r2: NodeToAccessPathPatterns) { // TODO: split into two functions?
    logger.info("API usage, access path patterns -> nodes:");
    let numAccessPathPatterns = 0, numAccessPathPatternsAtNodes = 0;
    for (const [t, m] of Object.entries(r1)) {
        for (const [p, ns] of m) {
            logger.info(`${t} ${p}:`);
            for (const n of ns)
                logger.info(`  ${sourceLocationToStringWithFileAndEnd(n.loc)}`);
            numAccessPathPatternsAtNodes += ns.size;
        }
        numAccessPathPatterns += m.size;
    }
    // logger.info("API usage, nodes -> access path patterns:"); // TODO: remove this part, also in getAPIUsage?
    // for (const [t, m] of Object.entries(r2))
    //     for (const [n, ps] of m) {
    //         logger.info(`${sourceLocationToStringWithFileAndEnd(n.loc)}:`);
    //         for (const p of ps)
    //             logger.info(`  ${t} ${p}`);
    //     }
    logger.info(`Access path patterns: ${numAccessPathPatterns}, access path patterns at nodes: ${numAccessPathPatternsAtNodes}`);
}

export function convertAPIUsageToJSON(r: AccessPathPatternToNodes): AccessPathPatternStringToNodes {
    const res: AccessPathPatternStringToNodes = {import: {}, read: {}, write: {}, call: {}, component: {}};
    for (const type of Object.getOwnPropertyNames(r) as Array<PatternType>) {
        const t: Record<AccessPathString, Array<SourceLocationWithFilename>> = {};
        for (const [p, nodes] of r[type]) {
            const a: Array<SourceLocationWithFilename> = [];
            for (const n of nodes)
                a.push(n.loc as SourceLocationWithFilename);
            t[p.toString()] = a;
        }
        res[type] = t;
    }
    return res;
}
