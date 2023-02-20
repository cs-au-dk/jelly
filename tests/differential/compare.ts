// @ts-nocheck
// too many import from jelly-previous, so disable ts check, otherwise it has compile error when we run test the first time.
import Solver from "../../src/analysis/solver";
import {FunctionInfo, ModuleInfo} from "../../src/analysis/infos";
import {AnalysisState} from "../../src/analysis/analysisstate";
import logger from "../../src/misc/logger";
import {AllocationSiteToken, FunctionToken, SnapshotObjectToken, Token} from "../../src/analysis/tokens";
import {mapGetSet, sourceLocationToString, SourceLocationWithFilename} from "../../src/misc/util";
import {Node} from "@babel/core";
import {ConstraintVar} from "../../src/analysis/constraintvars";
import {default as PrevSolver} from "jelly-previous/src/analysis/solver";
import {FunctionInfo as PrevFunctionInfo, ModuleInfo as PrevModuleInfo} from "jelly-previous/src/analysis/infos";
import {AnalysisState as PrevAnalysisState} from "jelly-previous/src/analysis/analysisstate";
import {ConstraintVar as PrevConstraintVar} from "jelly-previous/src/analysis/constraintvars";
import {SourceLocation} from "@babel/types";
import {SnapshotFunctionDescriptor} from "../../src/blended/snapshots";
import * as PrevTokens from "jelly-previous/src/analysis/tokens";
import {codeFromLocation} from "../../src/misc/files";

/**
 * Compares the previous and the current version of Jelly on the given package.
 * 1. The reachable functions (in app scope) in call graph are more or equal to previous version.
 * 2. The reachable modules (in app scope) in call graph are greater or more to previous version.
 * 3. One callee calls (in app scope) are more or equal to previous version.
 * 4. The number of constraint variables should be greater or equal to previous.
 * 5. The number of tokens in each constraint variables should be greater or equal to previous.
 * 6. The dataflow edge from an app's constraint variables to module's shouldn't be missing in current version.
 * 7. The dataflow edge from a module's constraint variables to app's shouldn't be missing in current version.
 * 8. The dataflow reachability from an app to app shouldn't be missing in current version.
 * 9. The call graph edge from an app's call site to callee shouldn't missing in current version.
 * 10. The call graph reachability from an app to app shouldn't be missing in current version.
 */
export function compare(prevSolver: PrevSolver, currSolver: Solver, _package: string) {
    let entryModulePaths: string[] = filterEntryModules(prevSolver.analysisState.moduleInfos).map(([filepath, _]) => filepath);

    /**
     * Filter function in application scope from functionInfos.
     */
    function filterEntryFunctions(functionInfos: Map<any, FunctionInfo | PrevFunctionInfo>) {
        return [...functionInfos].filter(([_, functionInfo]) => functionInfo.moduleInfo.isEntry);
    }

    /**
     * Filter module in application scope from moduleInfos.
     */
    function filterEntryModules(moduleInfos: Map<string, ModuleInfo | PrevModuleInfo>) {
        return [...moduleInfos].filter(([_, moduleInfo]) => moduleInfo.isEntry);
    }

    /**
     * Get the number of callsites in app scope with only one callee.
     */
    function getOneCalleeCallsInAppScope(a: AnalysisState | PrevAnalysisState) {
        let r = 0;
        for (const c of a.callLocations) {
            if (c.loc && "filename" in c.loc && entryModulePaths.includes(<string>c.loc.filename)) {
                const cs = a.callToFunction.get(c);
                if (cs)
                    if (cs.size === 1)
                        r++;
                    else if (cs.size > 1)
                        if (logger.isDebugEnabled())
                            logger.debug(`Call with multiple callees at ${c}: ${cs.size}`);
            }
        }
        return r;
    }

    // 1. The reachable functions (in app scope) in call graph are more or equal to previous version.
    expect(filterEntryFunctions(currSolver.analysisState.functionInfos).length,
        `Unexpected analysisState.functionInfos.size`)
        .toBeGreaterThanOrEqual(filterEntryFunctions(prevSolver.analysisState.functionInfos).length);
    // 2. The reachable modules (in app scope) in call graph are greater or more to previous version.
    expect(filterEntryModules(currSolver.analysisState.moduleInfos).length,
        `Unexpected analysisState.moduleInfos.size`)
        .toBeGreaterThanOrEqual(filterEntryModules(prevSolver.analysisState.moduleInfos).length);
    // 3. One callee calls (in app scope) are more or equal to previous version.
    expect(getOneCalleeCallsInAppScope(currSolver.analysisState),
        `Unexpected number of OneCalleeCalls`)
        .toBeGreaterThanOrEqual(getOneCalleeCallsInAppScope(prevSolver.analysisState));

    /**
     * Get tokens by previous version's constraint variable.
     */
    function getTokensByPrevConstraintVar(prevVar: PrevConstraintVar, currSolver: Solver): Array<Token> {
        for (const [newConstraintVar, tokens] of currSolver.fragmentState.getAllVarsAndTokens())
            if (varToCodeString(newConstraintVar) === varToCodeString(prevVar))
                return Array.from(tokens);
        return [];
    }

    // compare dataflow graph: constraint variables->tokens map (4 and 5)
    for (const [prevConstraintVar, prevTokens] of prevSolver.fragmentState.getAllVarsAndTokens()) {
        let m = prevSolver.analysisState.getConstraintVarParent(prevConstraintVar);
        if (m && m.isEntry) {
            const prevTokenStrings = Array.from(prevTokens)
                .filter((t: Token) => {
                    const loc = getTokenLocation(t);
                    return loc && entryModulePaths.includes((<SourceLocationWithFilename>loc).filename);
                }).map((t: any) => t.toString());
            const currTokens = getTokensByPrevConstraintVar(prevConstraintVar, currSolver);
            const currTokenStrings = currTokens
                .filter((t: Token) => {
                    const loc = getTokenLocation(t);
                    return loc && entryModulePaths.includes((<SourceLocationWithFilename>loc).filename);
                }).map((t: any) => t.toString());
            for (const prevTokenString of prevTokenStrings) {
                expect(currTokenStrings,
                    `Token ${prevTokenString} in ${prevConstraintVar.toString()} is missing`)
                    .toContain(prevTokenString);
            }
        }
    }
    // compare dataflow graph: edge app->module, module->app (6 and 7)
    const currSubsetStrEdge = new Map<string, Set<string>>();
    for (const fromVar of currSolver.fragmentState.vars) {
        for (const toVar of mapGetSet(currSolver.fragmentState.subsetEdges, fromVar)) {
            const m = currSolver.analysisState.getConstraintVarParent(fromVar);
            const n = currSolver.analysisState.getConstraintVarParent(toVar);
            if ((m && m.isEntry) || (n && n.isEntry)) {
                const s = mapGetSet(currSubsetStrEdge, varToCodeString(fromVar));
                const toVarStr = varToCodeString(toVar);
                if (toVarStr)
                    s.add(toVarStr);
            }
        }
    }
    for (const fromVar of prevSolver.fragmentState.vars) {
        for (const toVar of mapGetSet(prevSolver.fragmentState.subsetEdges, fromVar)) {
            const m = prevSolver.analysisState.getConstraintVarParent(fromVar);
            const n = prevSolver.analysisState.getConstraintVarParent(toVar);
            if (varToCodeString(fromVar) && varToCodeString(toVar))
                if ((m && m.isEntry) || (n && n.isEntry) ) {
                    expect(currSubsetStrEdge.keys(),
                        `Dataflow doesn't have node ${varToCodeString(fromVar)}`)
                        .toContain(varToCodeString(fromVar));
                    expect(mapGetSet(currSubsetStrEdge, varToCodeString(fromVar)),
                        `Dataflow edge(app->module,module->app) \u2329${varToCodeString(fromVar)}\u232a->\u2329${varToCodeString(toVar)}\u232a doesn't exist`)
                        .toContain(varToCodeString(toVar));
                }
        }
    }

    /**
     * A breadth-first search to get reachable nodes.
     */
    function bfsReachability<T>(graph: Map<T, Set<T>>, start: T): Set<T> {
        const queue: Array<T> = [start];
        const visited: Set<T> = new Set<T>();
        while (queue.length > 0) {
            const node = queue.shift();
            if (node && !visited.has(node)) {
                visited.add(node);
                queue.push(...mapGetSet(graph, node));
            }
        }
        return visited;
    }
    // 8. The dataflow reachability from a app to app shouldn't be missing in current version.
    const currReachability = new Map<string, Set<string>>();
    for (const fromVar of currSolver.fragmentState.vars) {
        const m = currSolver.analysisState.getConstraintVarParent(fromVar);
        if (m && m.isEntry) {
            const s = new Set<string>();
            const fromVarStr = varToCodeString(fromVar);
            if (fromVarStr)
                currReachability.set(fromVarStr, s);
            for (const toVar of bfsReachability<ConstraintVar>(currSolver.fragmentState.subsetEdges, fromVar)) {
                const toVarStr = varToCodeString(toVar);
                if (toVarStr)
                    s.add(toVarStr);
            }
        }
    }
    for (const fromVar of prevSolver.fragmentState.vars) {
        const m = prevSolver.analysisState.getConstraintVarParent(fromVar);
        if (m && m.isEntry) {
            for (const toVar of bfsReachability<PrevConstraintVar>(prevSolver.fragmentState.subsetEdges, fromVar)) {
                const n = prevSolver.analysisState.getConstraintVarParent(toVar);
                if (n && n.isEntry && n !== m && varToCodeString(fromVar) && varToCodeString(toVar))
                    expect(mapGetSet(currReachability, varToCodeString(fromVar)),
                        `Dataflow reachability(app-->app) \u2329${varToCodeString(fromVar)}\u232a-->\u2329${varToCodeString(toVar)}\u232a doesn't exist`)
                        .toContain(varToCodeString(toVar));
            }
        }
    }

    // compare call graph: app --> function or module edge

    /**
     * Transform a map from node to node to a map from string
     * And only keep the call node that is in the application module.
     */
    function transformCallToFunctionOrModuleToStringMap(callToFunctionOrModule: Map<Node, Set<any>>) {
        const ret: Map<string, Set<string>> = new Map<string, Set<string>>();
        for (const [callNode, funcOrModules] of callToFunctionOrModule) {
            if (callNode.loc && "filename" in callNode.loc && entryModulePaths.includes(<string>callNode.loc.filename)) {
                const s = new Set<string>();
                for (const callee of funcOrModules)
                    s.add(funcOrModuleToString(callee));
                ret.set(`'${codeFromLocation(callNode.loc)}'${sourceLocationToString(callNode.loc)}`, s);
            }
        }
        return ret;
    }

    // 9. The callgraph edge from a app's callsite to callee shouldn't missing in current version.
    let prevNode2callee = transformCallToFunctionOrModuleToStringMap(prevSolver.analysisState.callToFunctionOrModule);
    let currNode2callee = transformCallToFunctionOrModuleToStringMap(currSolver.analysisState.callToFunctionOrModule);
    for (const [caller, callees] of prevNode2callee)
        for (const callee of callees)
            expect(mapGetSet(currNode2callee, caller),
                `CallGraph edge(app->module) ${caller} -> ${callee} is missing`
            ).toContain(callee);

    /**
     * Transform a map from CallGraph to String Graph.
     * @param cgEdge
     */
    function translateNodeGraphToStringGraph(cgEdge: Map<FunctionInfo | ModuleInfo, Set<FunctionInfo | ModuleInfo>>): [Set<string>, Map<string, Set<string>>] {
        const vertices = new Set<string>();
        const edges = new Map<string, Set<string>>();
        for (const [caller, callees] of cgEdge) {
            const s = new Set<string>();
            for (const callee of callees) {
                const calleeStr = funcOrModuleToString(callee);
                s.add(calleeStr);
                vertices.add(calleeStr);
            }
            const callerStr = funcOrModuleToString(caller);
            vertices.add(callerStr);
            edges.set(callerStr, s);
        }
        return [vertices, edges];
    }

    // 10. The callgraph reachability from a app to app shouldn't missing in current version.
    const [_, currCGEdge] = getCallGraph(currSolver.analysisState);
    const [__, currCGEdgeStr] = translateNodeGraphToStringGraph(currCGEdge);
    const [prevCGvertices, prevCGEdges] = getCallGraph(prevSolver.analysisState);
    for (const from of prevCGvertices)
        if (from.packageInfo.isEntry) {
            const currReachability = bfsReachability<string>(currCGEdgeStr, funcOrModuleToString(from));
            for (const to of bfsReachability<PrevModuleInfo | PrevFunctionInfo>(prevCGEdges, from))
                if (to.packageInfo.isEntry)
                    expect(currReachability,
                        `CallGraph reachability(app-->app) \u2329${funcOrModuleToString(from)} --> ${funcOrModuleToString(to)} is missing`
                    ).toContain(funcOrModuleToString(to));
        }
}

/**
 * Return the code with location string of the constraint variable, otherwise return variable.toString.
 */

export function varToCodeString<T extends ConstraintVar | PrevConstraintVar>(v: T): string | undefined { // TODO: Will be replaced with constraintVarToString in the future.
    if (!("loc" in v))
        return v.toString();
    else if (v.loc && "filename" in v.loc && v.loc.filename !== "%nodejs" && v.loc.filename !== "%ecmascript")
        return `'${codeFromLocation(v.loc)}'[${sourceLocationToString(v.loc, true, true)}]`;
    else
        return undefined; // dummy location
}

/**
 * Extract the source location from a token, if token doesn't contain source location, return undefined.
 */
export function getTokenLocation<T extends Token | PrevTokens.Token>(token: T): SourceLocation | undefined {
    if (token instanceof FunctionToken || token instanceof PrevTokens.FunctionToken) {
        if (token.fun.loc)
            return token.fun.loc;
    } else if (token instanceof AllocationSiteToken || token instanceof PrevTokens.AllocationSiteToken) {
        if (token.allocSite.loc)
            return token.allocSite.loc;
    } else if (token instanceof SnapshotObjectToken || token instanceof PrevTokens.SnapshotObjectToken) {
        if (token.obj instanceof SnapshotFunctionDescriptor)
            return token.obj.loc;
    }
    return undefined;
}

/**
 * A string formatter for function/module info,
 * if the constraint variable has source location, it is ast node, return the code of the constraint variable with constraint variable.toString()
 * otherwise, return variable.toString().
 */
export function funcOrModuleToString(info: FunctionInfo | ModuleInfo | PrevFunctionInfo | PrevModuleInfo): string { // TODO: Will be replaced with function.toString() and module.toString() in the future.
    if ((info instanceof FunctionInfo || info instanceof PrevFunctionInfo) && info.loc)
        return `'${codeFromLocation(info.loc)}'${sourceLocationToString(info.loc)}}`;
    else
        return `${(<ModuleInfo|PrevModuleInfo>info).path}`;
}


/**
 * Merge require graph and function to function graph to a call graph ( Function/Module × Function/Module )
 * @param a analysis state
 * @returns a tuple of vertexes and edges
 */
export function getCallGraph<A extends AnalysisState|PrevAnalysisState,
    N extends (A extends AnalysisState ? FunctionInfo|ModuleInfo: PrevFunctionInfo|PrevModuleInfo)>(a: A):
    [Set<N>, Map<N, Set<N>>] {
    const vertexes = new Set<N>();
    const edges = new Map<N, Set<N>>();
    for (const [caller, callees] of a.requireGraph) {
        const s = mapGetSet(edges, caller);
        vertexes.add(<N>caller);
        for (const callee of callees) {
            s.add(<N>callee);
            vertexes.add(<N>callee);
        }
    }
    for (const [caller, callees] of a.functionToFunction) {
        const s = mapGetSet(edges, caller);
        vertexes.add(<N>caller);
        for (const callee of callees) {
            s.add(<N>callee);
            vertexes.add(<N>callee);
        }
    }
    return [vertexes, edges];
}