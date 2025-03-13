// noinspection JSUnusedGlobalSymbols

import Module, {LoadFnOutput, LoadHookContext, ResolveFnOutput, ResolveHookContext} from "module";
import {options, setOptions} from "../options";
import {MessagePort} from "worker_threads";
import {FilePath} from "../misc/util";
import {extname} from "path";
import {WHITELISTED} from "./sandbox";
import {TSModuleResolver} from "../typescript/moduleresolver";
import {fileURLToPath} from "node:url";
import {PREFIX} from "./transform";
import {isShebang} from "../misc/files";
import {pathToFileURL} from "url";

const tsModuleResolver = new TSModuleResolver();

let port2: MessagePort | undefined;

const responsePromiseResolves = new Map<FilePath, (transformed: string) => void>();

/**
 * Module hooks initialization.
 * (Registered in approx.ts.)
 */
export async function initialize({opts, port2: p2}: {opts: Partial<typeof options>, port2: MessagePort}) {
    setOptions(opts);
    port2 = p2;
    port2.on("message", ({filename, transformed}: {filename: FilePath, transformed: string}) => {
        const resolve = responsePromiseResolves.get(filename);
        if (!resolve)
            log("error", `Error: Unexpected response for ${filename}`);
        else {
            resolve(transformed);
            responsePromiseResolves.delete(filename);
        }
    });
}

/**
 * Module resolve hook.
 */
export async function resolve(
    specifier: string,
    context: ResolveHookContext,
    nextResolve: (specifier: string, context?: ResolveHookContext) => ResolveFnOutput | Promise<ResolveFnOutput>
): Promise<ResolveFnOutput> {
    if (context.parentURL === `file://${__dirname}/approx.js`)
        context.parentURL = undefined; // approx.js is entry
    log("verbose", `Resolving ${specifier}${context.parentURL ? ` from ${context.parentURL}` : " (entry)"}`);
    const str = specifier.startsWith("node:") ? specifier.substring(5) : specifier;
    if (Module.isBuiltin(str) && !WHITELISTED.has(str))
        return {
            format: "commonjs",
            url: `node:${str}`, // signals to load hook that this is a sandboxed builtin
            shortCircuit: true
        };
    if (context.parentURL && context.parentURL.startsWith("file://") && str.startsWith(".") &&
        [".ts", ".tsx", ".mts", ".cts"].includes(extname(context.parentURL))) { // parent is a TS file
        const parentFile = fileURLToPath(context.parentURL);
        const r = tsModuleResolver.resolveModuleName(specifier, parentFile);
        log("debug", `Resolved as TypeScript: ${r}`);
        try {
            return {
                format: "module",
                url: pathToFileURL(r).toString(),
                shortCircuit: true
            };
        } catch (ex) {
            log("verbose", `TypeScript module resolution failed: ${ex}`);
        }
    }
    return nextResolve(str);
}

/**
 * Module loading hook.
 */
export async function load(
    url: string,
    context: LoadHookContext,
    nextLoad: (url: string, context: LoadHookContext) => Promise<LoadFnOutput>
): Promise<LoadFnOutput> {
    try {
        const ext = extname(url);
        if ([".ts", ".tsx", ".mts", ".cts", ".jsx"].includes(ext))
            context.format = "module";
        else if (ext === "" && url.startsWith("file://") && isShebang(fileURLToPath(url)))
            context.format = "commonjs";
        const sandboxedBuiltin = url.startsWith("node:");
        log("verbose", `Loading ${url} (ESM loader, format: ${sandboxedBuiltin ? "sandboxed builtin" : context.format})`);
        const res = await nextLoad(url, context); // TODO: fails with ERR_UNSUPPORTED_ESM_URL_SCHEME on https and http
        if (sandboxedBuiltin) {
            const m = url.substring(5);
            log("verbose", `Intercepting import "${m}"`);
            res.source = `const m = globalThis.${PREFIX}builtin.${m};`;
            for (const p of Object.getOwnPropertyNames(require(m)))
                res.source += `module.exports.${p} = m.${p};`
            return res;
        }
        if (res.format === "builtin" || res.format === "commonjs" || res.format === "json")
            return res;
        if (res.format !== "module")
            log("warn", `Ignoring ${url} (format: ${res.format})`);
        else if (!url.startsWith("file://"))
            log("error", `Error: Unsupported URL scheme ${url}`);
        else if (!(res.source instanceof Uint8Array))
            log("error", `Error: Unexpected source type for ${url}`);
        else {
            const filename = fileURLToPath(url);
            const transformPromise = new Promise<string>(resolve => {
                if (responsePromiseResolves.has(filename))
                    log("error", `Error: Loading conflict for ${filename}`);
                responsePromiseResolves.set(filename, resolve);
            });
            port2!.postMessage({type: "transform", filename, source: new TextDecoder().decode(res.source)});
            const transformed = await transformPromise;
            return {
                format: "module",
                shortCircuit: true,
                source: transformed
            };
        }
    } catch (err) {
        log("error", `Suppressed exception at module load: ${err instanceof Error ? err.stack : err}`);
    }
    return {
        format: "commonjs",
        shortCircuit: true,
        source: `module.exports = ${PREFIX}proxy`
    };
}

/**
 * TTY doesn't work for hooks thread, so logging is done via the approximate interpretation thread.
 * Note: the logging from this thread is asynchronous so the messages may be written delayed to the log!
 */
function log(level: string, str: string) {
    port2!.postMessage({type: "log", level, str});
}
