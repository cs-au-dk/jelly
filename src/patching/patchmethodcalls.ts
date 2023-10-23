import Solver from "../analysis/solver";
import {options} from "../options";
import logger from "../misc/logger";
import {getOrSet, Location, locationToStringWithFileAndEnd, mapGetArray} from "../misc/util";
import {ObjectPropertyVar} from "../analysis/constraintvars";
import {AccessPathToken, FunctionToken, NativeObjectToken, PackageObjectToken, Token} from "../analysis/tokens";

const IGNORED = new Set([ // method names on String, RegExp and Number, currently ignored
    "charAt", "charCodeAt", "codePointAt", "concat", "endsWith", "includes", "indexOf", "lastIndexOf",
    "localeCompare", "match", "matchAll", "normalize", "padEnd", "padStart", "repeat", "replace", "replaceAll",
    "search", "slice", "split", "startsWith", "substring", "toLocaleLowerCase", "toLocaleUpperCase", "toLowerCase",
    "toString", "toUpperCase", "trim", "trimEnd", "trimStart", "valueOf", "test", "exec",
    "toExponential", "toFixed","toLocaleString", "toPrecision",
    "write" // TODO: add models for console methods, then remove "write" from this list
]);

const PATCH_LIMIT = 25; // TODO: test different values

export function patchMethodCalls(solver: Solver): boolean {
    if (!options.patchMethodCalls)
        return false;
    const f = solver.fragmentState;
    const m = new Map<string, Array<ObjectPropertyVar>>();
    for (const v of [...f.vars, ...f.redirections.keys()])
        if (v instanceof ObjectPropertyVar &&
            v.accessor === "normal" &&
            !(v.obj instanceof NativeObjectToken) &&
            !(v.obj instanceof PackageObjectToken && !["Object", "Array", "Prototype"].includes(v.obj.kind)) &&
            !IGNORED.has(v.prop))
            mapGetArray(m, v.prop).push(v);
    let patched = 0, failed = 0;
    const cache = new Map<string, Map<Token, ObjectPropertyVar>>();
    for (const [node, c] of f.maybeEmptyMethodCalls) {
        if (IGNORED.has(c.prop))
            continue;
        const ts = f.getTokens(f.getRepresentative(c.baseVar));
        let empty = true;
        for (const t of ts)
            if (!(t instanceof AccessPathToken)) {
                empty = false;
                break;
            }
        let any = false;
        if (empty) {
            const vs = m.get(c.prop);
            if (vs) {
                const pck = (node.loc as Location)?.module?.packageInfo;
                if (pck) {
                    const tokens = getOrSet(cache, c.prop, () => {
                        const ts = new Map<Token, ObjectPropertyVar>();
                        build:
                            for (const v of vs)
                                for (const t of f.getTokens(f.getRepresentative(v))) {
                                    if ((t instanceof FunctionToken || t instanceof AccessPathToken) && !ts.has(t)) {
                                        if (ts.size === PATCH_LIMIT) {
                                            ts.clear();
                                            break build;
                                        }
                                        ts.set(t, v);
                                    }
                                }
                        return ts;
                    });
                    let first = true;
                    for (const [t, v] of tokens) {
                        if (first) {
                            log(() => `Call to method named '${c.prop}' with empty base at ${locationToStringWithFileAndEnd(node.loc)}`);
                            first = false;
                        }
                        log(() => `  Adding ${t} from ${v}`);
                        solver.addTokenConstraint(t, c.calleeVar);
                        any = true;
                    }
                }
            }
            if (any)
                patched++;
            else {
                failed++;
                log(() => `Unable to patch call to method named '${c.prop}' with empty base at ${locationToStringWithFileAndEnd(node.loc)}`);
            }
        }
    }
    log(() => `Patched method calls with empty base: ${patched}, not patched: ${failed}`);
    f.maybeEmptyMethodCalls.clear();
    return patched > 0;
}

function log(s: () => string) {
    if (logger.isVerboseEnabled())
        logger.verbose(s());
}