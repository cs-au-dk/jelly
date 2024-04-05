import {FunctionInfo, ModuleInfo, PackageInfo} from "../analysis/infos";
import logger from "../misc/logger";
import {options} from "../options";
import {writeSync} from "fs";
import {locationToString} from "../misc/util";
import {FragmentState} from "../analysis/fragmentstate";

// TODO: optionally mark reachable packages/modules/functions
// TODO: optionally highlight call edges where the target package is not in the transitive dependencies of the source package (or vice versa)
// TODO: optionally highlight paths to selected API points
// TODO: when using option packages: show excluded packages as dummy nodes?

/**
 * Write a Graphviz dot representation of the result to the given file.
 */
export function toDot(f: FragmentState, fd: number = process.stdout.fd) {
    const ids = new Map<PackageInfo | ModuleInfo | FunctionInfo, number>();
    let next = 1;

    function id(x: PackageInfo | ModuleInfo | FunctionInfo): number {
        let t = ids.get(x);
        if (!t) {
            t = next++;
            ids.set(x, t);
            if (logger.isDebugEnabled())
                logger.debug(`Assigning ID ${t} to ${x}`);
        }
        return t;
    }

    function esc(s: string): string {
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    function ind(i: number): string {
        return " ".repeat(i);
    }

    function writeFunction(f: FunctionInfo, i: number, moduleId: number) {
        if (options.graphvizElideFunctions || options.dependenciesOnly)
            ids.set(f, moduleId);
        else
            writeSync(fd, `${ind(i)}subgraph cluster${id(f)} {\n` +
                `${ind(i)} label=\"${f.name ?? "<anon>"}@${locationToString(f.loc)}\";\n` +
                `${ind(i)} bgcolor=\"#ffffff\";\n` +
                `${ind(i)}node${id(f)}[style=invis,shape=point];\n`);
        for (const fs of f.functions)
            writeFunction(fs, i + 1, moduleId);
        if (!options.graphvizElideFunctions && !options.dependenciesOnly)
            writeSync(fd, `${ind(i)}}\n`);
    }

    function writeModule(km: string, m: ModuleInfo, i: number) {
        writeSync(fd, `${ind(i)}subgraph cluster${id(m)} {\n` +
            `${ind(i)} label=\"${esc(km)}\";\n` +
            `${ind(i)} bgcolor=\"#ffffff\";\n` +
            `${ind(i)}node${id(m)}[style=invis,shape=point];\n`);
        for (const f of m.functions)
            writeFunction(f, i + 1, id(m));
        writeSync(fd, `${ind(i)}}\n`);
    }

    function isPackageIncluded(p: PackageInfo): boolean {
        return !options.graphvizPackages || options.graphvizPackages.indexOf(p.name) !== -1;
    }

    writeSync(fd, "digraph G {\n" +
        " graph [ranksep=1];\n" +
        " compound=true;\n" +
        " node [shape=box,fillcolor=\"#ffffff\",style=filled]\n");
    for (const [kp, p] of f.a.packageInfos)
        if (isPackageIncluded(p)) {
            writeSync(fd, ` subgraph cluster${id(p)} {\n` +
                `  label=\"${esc(kp)}\";\n` +
                "  bgcolor=\"#f0f0f0\";\n");
            for (const [km, m] of p.modules)
                writeModule(km, m, 2);
            writeSync(fd, " }\n");
        }
    writeSync(fd, ` edge ${options?.dependenciesOnly ? "[color=\"#000000\",style=solid]" : "[color=\"#888888\",style=dashed]"};\n`);
    for (const [from, tos] of f.requireGraph)
        if (isPackageIncluded(from.packageInfo))
            for (const to of tos)
                if (isPackageIncluded(to.packageInfo))
                    writeSync(fd, ` node${id(from)}->node${id(to)} [lhead=cluster${id(to)}];\n`);
    if (!options?.dependenciesOnly) {
        writeSync(fd, ` edge [color=\"#000000\",style=solid];\n`);
        const es = new Set<string>();
        for (const [from, tos] of f.functionToFunction)
            if (isPackageIncluded(from.packageInfo))
                for (const to of tos)
                    if (isPackageIncluded(to.packageInfo)) {
                        const m = from instanceof FunctionInfo ? from.moduleInfo : from;
                        const str = ` node${id(from)}->node${id(to)}${m !== to.moduleInfo ? ` [lhead=cluster${id(to)}]` : ""};\n`;
                        if (options.graphvizElideFunctions)
                            if (es.has(str))
                                continue; // don't produce duplicate edges
                            else // TODO: also omit self-loops when elideFunctions enabled
                                es.add(str);
                        writeSync(fd, str);
                    }
    }
    writeSync(fd, "}\n");
}
