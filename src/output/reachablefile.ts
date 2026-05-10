/**
 * reachable-file serializer.
 *
 * Produces a JSON object with two arrays — every package and every module
 * encountered during analysis. Shape:
 *
 *     {
 *       "packages": [ { "name": string, "version"?: string }, ... ],
 *       "modules":  [
 *         // resolved modules in non-entry packages
 *         { "package": { "name": string, "version"?: string }, "moduleName": string },
 *         // dummy modules (failed to resolve / not installed)
 *         { "moduleName": string }
 *       ]
 *     }
 *
 * Packages are deduplicated by (name, version). When the solver has no
 * version information for a package (e.g. root project, workspace
 * pseudo-packages), the `version` field is omitted entirely. An input
 * package with `version: ""` (empty string) is treated as version-absent.
 *
 * `packages` includes every package encountered in the require graph,
 * including packages excluded from deep analysis by --include-packages /
 * --ignore-dependencies / --exclude-packages. This matches the semantics of
 * reportReachablePackagesAndModules (the stderr --modules-only output) and
 * is what downstream consumers want for import-reachability pruning: a vuln
 * in a "scope-excluded" package can still be reachable via imports.
 *
 * `modules` lists modules in NON-entry packages (entry-package modules are
 * the user's own code; they are out of scope here). Dummy modules — those
 * that failed to resolve at parse time — are emitted without a `package`
 * field.
 */

import {writeFileSync} from "fs";
import Solver from "../analysis/solver";
import logger from "../misc/logger";

export interface ReachablePackage {
    name: string;
    version?: string;
}

export interface ReachableModule {
    /** Module name (e.g. "lodash/cloneDeep") as returned by ModuleInfo.getOfficialName(). */
    moduleName: string;
    /** Owning package, or undefined for dummy / unresolved modules. */
    package?: ReachablePackage;
}

export interface ReachableOutput {
    packages: ReachablePackage[];
    modules: ReachableModule[];
}

/**
 * Transform raw package + module info records into the reachable-file shape.
 * Packages are deduplicated by `(name, version)`; modules are emitted in
 * input order with no dedup (the solver's module map is already keyed
 * uniquely).
 */
export function serializeReachable(
    packages: readonly ReachablePackage[],
    modules: readonly ReachableModule[],
): ReachableOutput {
    const seenPkg = new Set<string>();
    const outPackages: ReachablePackage[] = [];
    for (const p of packages) {
        const ver = p.version || undefined;  // normalize "" to undefined
        const key = `${p.name}@${ver ?? ""}`;
        if (seenPkg.has(key)) continue;
        seenPkg.add(key);
        const entry: ReachablePackage = {name: p.name};
        if (ver !== undefined) entry.version = ver;
        outPackages.push(entry);
    }

    const outModules: ReachableModule[] = [];
    for (const m of modules) {
        const entry: ReachableModule = {moduleName: m.moduleName};
        if (m.package) {
            const ver = m.package.version || undefined;
            const pkg: ReachablePackage = {name: m.package.name};
            if (ver !== undefined) pkg.version = ver;
            entry.package = pkg;
        }
        outModules.push(entry);
    }

    return {packages: outPackages, modules: outModules};
}

/**
 * Collect reachable packages + modules from the solver's globalState and
 * write them as a JSON object at `path`.
 *
 * Modules in entry packages (the user's own source) are excluded — only
 * dependency modules and unresolved/dummy modules appear. This mirrors the
 * standalone `--modules-only` stderr report.
 */
export function saveReachable(solver: Solver, path: string): void {
    const g = solver.globalState;
    const packages = Array.from(g.packageInfos.values());

    const modules: ReachableModule[] = [];
    for (const m of g.moduleInfos.values()) {
        if (m.packageInfo.isEntry) continue;
        modules.push({
            moduleName: m.getOfficialName(),
            package: {name: m.packageInfo.name, version: m.packageInfo.version},
        });
    }
    for (const dm of g.dummyModuleInfos.values()) {
        modules.push({moduleName: dm.getOfficialName()});
    }

    const json = JSON.stringify(serializeReachable(packages, modules), null, 2);
    writeFileSync(path, json);
    logger.info(`Reachable packages and modules written to ${path}`);
}
