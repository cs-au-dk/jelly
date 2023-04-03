import {closeSync, existsSync, lstatSync, openSync, readdirSync, readFileSync, readSync, writeSync} from "fs";
import {basename, relative, resolve, sep} from "path";
import {options} from "../options";
import micromatch from "micromatch";
import {FilePath, sourceLocationToStringWithFile} from "./util";
import logger from "./logger";
import {SourceLocation} from "@babel/types";
import {findPackageJson} from "./packagejson";
import {tsResolveModuleName} from "../typescript/moduleresolver";
import stringify from "stringify2stream";
import {builtinModules} from "../natives/nodejs";
import {FragmentState} from "../analysis/fragmentstate";

/**
 * Expands the given list of file paths.
 * Each given file path is resolved relative to the current working directory.
 * Directories are traversed recursively (except node_modules, .git, and .yarn,
 * and also excluding out, build, dist, generated and sub-directories that contain package.json unless inside a node_modules directory within basedir),
 * and all .js, .es, .mjs, .cjs, .ts, .tsx and Node.js shebang files are included
 * (except .d.ts and paths matching options.exclude and also excluding .min.js, .bundle.js unless inside a node_modules directory within basedir).
 * Symlinks are ignored.
 * The resulting paths are relative to options.basedir.
 */
export function expand(paths: Array<string> | string): Array<string> {
    if (typeof paths === "string")
        paths = [paths];
    const res: Array<string> = [];
    for (const path of paths)
        for (const e of expandRec(resolve(path), false))
            res.push(e); // TODO: complain if e starts with "."? (happens if path is outside basedir)
    if (options.exclude) {
        const excl = new Set(micromatch(res, options.exclude));
        const eres = [];
        for (const r of res)
            if (!excl.has(r))
                eres.push(r);
        return eres;
    } else
        return res;
}

function* expandRec(path: string, sub: boolean): Generator<string> {
    const stat = lstatSync(path);
    const inNodeModules = relative(options.basedir, path).split(sep).includes("node_modules");
    if (stat.isDirectory()) {
        const base = basename(path);
        if (!sub ||
            !(["node_modules", ".git", ".yarn"].includes(base) ||
                (!inNodeModules && ["out", "build", "dist", "generated"].includes(base)))) {
            const files = readdirSync(path); // TODO: use withFileTypes and dirent.isdirectory()
            if (!sub || inNodeModules || !files.includes("package.json"))
                for (const file of files.map(f => resolve(path, f)).sort((f1, f2) => {
                    // make sure files are ordered before directories
                    return (lstatSync(f1).isDirectory() ? 1 : 0) - (lstatSync(f2).isDirectory() ? 1 : 0) || f1.localeCompare(f2);
                }))
                    yield* expandRec(file, true);
        } else
            logger.debug(`Skipping directory ${path}`);
    } else if (stat.isFile() && !path.endsWith(".d.ts") &&
        (!inNodeModules || !(path.endsWith(".min.js") || path.endsWith(".bundle.js"))) &&
        (path.endsWith(".js") || path.endsWith(".jsx") || path.endsWith(".es") || path.endsWith(".mjs") || path.endsWith(".cjs") || path.endsWith(".ts") || path.endsWith(".tsx")
            || isShebang(path)))
        yield relative(options.basedir, path);
    else
        logger.debug(`Skipping file ${path}`);
}

/**
 * Attempts to detect whether the given file is a Node.js shebang file.
 */
function isShebang(path: string): boolean { // TODO: doesn't work with hacks like https://sambal.org/2014/02/passing-options-node-shebang-line/
    const fd = openSync(path, 'r');
    const buf = Buffer.alloc(256);
    readSync(fd, buf, 0, buf.length, 0)
    closeSync(fd);
    const str = buf.toString('utf8');
    return str.startsWith("#!") && str.substring(0, str.indexOf("\n")).includes("node");
}

/**
 * Resolves a 'require' string to a file path.
 * @return resolved file path if successful, undefined if file type not analyzable
 * @throws exception if the module is not found
 */
export function requireResolve(str: string, file: FilePath, loc: SourceLocation | null | undefined, f: FragmentState): FilePath | undefined {
    if (str.endsWith(".json")) {
        logger.debug(`Skipping JSON file '${str}'`); // TODO: analyze JSON files?
        return undefined;
    } else if (str.endsWith(".node")) {
        logger.debug(`Skipping binary addon file '${str}'`);
        return undefined;
    } else if (str.endsWith(".less") || str.endsWith(".svg") || str.endsWith(".png") || str.endsWith(".css") || str.endsWith(".scss")) {
        logger.verbose(`Ignoring module '${str}' with special extension`);
        return undefined;
    } else if (str[0] === "/") {
        f.warn(`Ignoring absolute module path '${str}'`);
        return undefined;
    }
    let filepath;
    try {
        if (builtinModules.has(str)) {
            // mock the behavior of tsResolveModuleName for builtins like `require('http')`
            filepath = resolveBuiltinModule(str);
        } else if (str.startsWith("node:") && builtinModules.has(str.substring(5))) {
            // mock the behavior of tsResolveModuleName for builtins like `require('node:http')`
            filepath = resolveBuiltinModule(str.substring(5))
        } else {
            filepath = tsResolveModuleName(str, file);
        }

        // TypeScript prioritizes .ts over .js, overrule if coming from a .js file
        if (file.endsWith(".js") && filepath.endsWith(".ts") && !str.endsWith(".ts")) {
            const p = filepath.substring(0, filepath.length - 3) + ".js";
            if (existsSync(p))
                filepath = p;
        }
    } catch (e) {
        // see if the string refers to a package that is among those analyzed (and not in node_modules)
        for (const p of f.a.packageInfos.values())
            if (p.name === str)
                if (filepath) {
                    f.warn(`Multiple packages named ${str} found, skipping module load`);
                    throw e;
                } else {
                    filepath = resolve(p.dir, p.main || "index.js"); // https://nodejs.org/dist/latest-v8.x/docs/api/modules.html#modules_all_together
                    if (!existsSync(filepath))
                        filepath = undefined;
                }
        if (!filepath)
            throw e;
    }

    // not in project basedir or mocked builtin dir, then it will be ignored
    const mockBuiltinDir = resolve(__dirname, '..', 'mockbuiltin');
    if (!filepath.startsWith(options.basedir) && !filepath.startsWith(mockBuiltinDir)) {
        const msg = `Found module at ${filepath}, but not in basedir`;
        logger.debug(msg);
        throw new Error(msg);
    }

    if (!filepath.endsWith(".js") && !filepath.endsWith(".jsx") && !filepath.endsWith(".es") && !filepath.endsWith(".mjs") &&
        !filepath.endsWith(".cjs") && !filepath.endsWith(".ts") && !filepath.endsWith(".tsx")) {
        f.warn(`Module '${filepath}' at ${sourceLocationToStringWithFile(loc)} has unrecognized extension, skipping it`);
        return undefined;
    }
    if (logger.isDebugEnabled())
        logger.debug(`Module '${str}' required from ${file} resolved to: ${filepath}`);
    return filepath;
}

/**
 * Attempts to auto-detect basedir if not set explicitly.
 * If not set explicitly and a single path is given, basedir is set to the nearest enclosing directory
 * of paths[0] that contains a package.json file.
 * @param paths paths to entry files or directories
 * @return true if successful, false if failed
 */
export function autoDetectBaseDir(paths: Array<string>): boolean {
    if (options.basedir) {
        const stat = lstatSync(options.basedir);
        if (!stat.isDirectory()) {
            logger.info(`Error: basedir ${options.basedir} is not a directory, aborting`);
            return false;
        }
        return true;
    }
    if (paths.length === 0)
        return true;
    if (!existsSync(paths[0])) {
        logger.info(`File or directory ${paths[0]} not found, aborting`);
        return false;
    }
    const t = findPackageJson(paths[0]);
    if (!t) {
        logger.info("Can't auto-detect basedir, package.json not found (use option -b), aborting");
        return false;
    }
    options.basedir = resolve(process.cwd(), t.dir);
    logger.verbose(`Basedir auto-detected: ${options.basedir}`);
    return true;
}

type SourceLocationStr = string;

const codeCache: Map<SourceLocationStr, string> = new Map<SourceLocationStr, string>();

/**
 * Reads the code for a source location.
 * If cached, returns the cached value. If the code is too long, only returns the head and tail of the code.
 */
export function codeFromLocation(loc: SourceLocation | null | undefined): string {
    if (!loc)
        return "-";
    let locStr = JSON.stringify(loc);
    let content = codeCache.get(locStr);
    if (!content) {
        content = "";
        if (loc && "filename" in loc) {
            let fileContent = readFileSync(<string>loc.filename).toString().split(/\r?\n/);
            let startRecord = false;
            for (let i = loc.start.line; i <= loc.end.line; i++) {
                let currLine = fileContent[i - 1];
                for (let j = 0; j < currLine.length; j++) {
                    if (i == loc.start.line && loc.start.column == j)
                        startRecord = true;
                    if (i == loc.end.line && j == loc.end.column) {
                        startRecord = false;
                        break;
                    }
                    if (startRecord)
                        content += currLine.charAt(j);
                }
            }
            content = content.replaceAll(/\s+/g, " ");
            if (content.length > 50)
                content = `${content.substring(0, 20)}/*...*/$${content.substring(content.length - 20)}`;
        }
        codeCache.set(locStr, content);
    }
    return content;
}

/**
 * Writes a JSON structure to a file, with streaming to reduce memory usage.
 */
export function writeStreamedStringify(value: any,
                                       fd: number,
                                       replacer?: ((key: string, value: any) => any) | (number | string)[] | null,
                                       space?: string | number) {
    stringify(value, (chunk : string | undefined) => {
        if (chunk)
            writeSync(fd, chunk);
    }, replacer, space);
}

/**
 * Resolve the path of standard module like 'http', 'fs' etc to a local file.
 */
export function resolveBuiltinModule(moduleName: string): FilePath {
    const filepath = resolve(__dirname, `../mockbuiltin/${moduleName}.js`);
    if (!existsSync(filepath)) {
        throw new Error;
    }
    return filepath;
}
