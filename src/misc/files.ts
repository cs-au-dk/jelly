import {
    closeSync,
    existsSync,
    openSync,
    readdirSync,
    readFileSync,
    readSync,
    realpathSync,
    statSync,
    writeSync
} from "fs";
import {basename, dirname, extname, relative, resolve, sep} from "path";
import module from "module";
import {options} from "../options";
import micromatch from "micromatch";
import {FilePath, Location, locationToStringWithFileAndEnd, longestCommonPrefix} from "./util";
import logger from "./logger";
import {Node} from "@babel/types";
import stringify from "stringify2stream";
import {FragmentState} from "../analysis/fragmentstate";
import {findPackageJson} from "./packagejson";
import {GlobalState} from "../analysis/globalstate";

/**
 * Expands the given list of file paths.
 * Each given file path is resolved relative to the current working directory.
 * Directories are traversed recursively (except node_modules, .git, and .yarn,
 * and also excluding out, build, dist, generated and sub-directories that contain package.json unless inside a node_modules directory),
 * and all .js, .es, .mjs, .cjs, .ts, .tsx and Node.js shebang files are included
 * (except .d.ts and paths matching options.excludeEntries and also excluding .min.js, .bundle.js unless inside a node_modules directory within basedir).
 * Symlinks are ignored.
 * The resulting paths are relative to options.basedir.
 */
export function expand(paths: Array<string> | string): Array<string> {
    if (typeof paths === "string")
        paths = [paths];
    const res: Array<string> = [];
    const visited: Set<string> = new Set();
    for (const path of paths)
        for (const e of expandRec(resolve(path), false, visited))
            res.push(e); // TODO: complain if e starts with "."? (happens if path is outside basedir)
    if (options.excludeEntries)
        return micromatch.not(res, options.excludeEntries);
    else
        return res;
}

function* expandRec(path: string, sub: boolean, visited: Set<string>): Generator<string> {
    try {
        path = realpathSync(path);
        if (visited.has(path))
            return;
        visited.add(path);
        const stat = statSync(path);
        const inNodeModules = options.library || path.includes("node_modules");
        if (stat.isDirectory()) {
            const base = basename(path);
            if (!sub || !(
                /* skip sub-directories with these names */
                ["node_modules", ".git", ".yarn"].includes(base) ||
                (inNodeModules &&
                    /* skip sub-directories with these names if inside node_modules */
                    ["test"].includes(base)) ||
                (!inNodeModules &&
                    /* skip sub-directories with these names if not inside node_modules */
                    ["out", "build", "dist", "generated", "compiled"].includes(base))
            )) {
                const files = readdirSync(path); // TODO: use withFileTypes and dirent.isdirectory()
                if (!sub || inNodeModules || !files.includes("package.json"))
                    for (const file of files.map(f => resolve(path, f)).sort((f1, f2) => {
                        // make sure files are ordered before directories
                        return (statSync(f1).isDirectory() ? 1 : 0) - (statSync(f2).isDirectory() ? 1 : 0) || f1.localeCompare(f2);
                    }))
                        yield* expandRec(file, true, visited);
                else
                    logger.debug(`Skipping directory ${path}`);
            } else
                logger.debug(`Skipping directory ${path}`);
        } else if (stat.isFile() &&
            /* skip files with this extension */
            !path.endsWith(".d.ts") &&
            (!inNodeModules || !(
                /* skip files with these extensions if inside node_modules */
                path.endsWith(".min.js") || path.endsWith(".bundle.js") || path.endsWith(".spec.js")
            )) &&
            /* include files with these extensions */
            (path.endsWith(".js") || path.endsWith(".es") || path.endsWith(".mjs") || path.endsWith(".cjs") ||
                (!inNodeModules && (
                    /* include files with these extensions if not inside node_modules */
                    path.endsWith(".jsx") || path.endsWith(".ts") || path.endsWith(".tsx") || path.endsWith(".mts") || path.endsWith(".cts") ||
                    /* include shebang files if not inside node_modules */
                    isShebang(path)
                ))))
            yield relative(options.basedir, path);
        else
            (sub ? logger.debug : logger.warn)(`Skipping file ${path}`);
    } catch {
        logger.error(`Error: Unable to read ${path}`);
    }
}

/**
 * Attempts to detect whether the given file is a Node.js shebang file.
 */
export function isShebang(path: string): boolean { // TODO: doesn't work with hacks like https://sambal.org/2014/02/passing-options-node-shebang-line/
    const fd = openSync(path, 'r');
    const buf = Buffer.alloc(256);
    readSync(fd, buf, 0, buf.length, 0);
    closeSync(fd);
    const str = buf.toString('utf8');
    return str.startsWith("#!") && str.substring(0, str.indexOf("\n")).includes("node");
}

export function isLocalRequire(str: string): boolean {
    return str.startsWith("./") || str.startsWith("../");
}

/**
 * Resolves a 'require' string to a file path.
 * @return resolved file path if successful, undefined if file type not analyzable
 * @throws exception if the module is not found
 */
export function requireResolve(str: string, file: FilePath, a: GlobalState, node?: Node, f?: FragmentState): FilePath | undefined {
    if (str.endsWith(".less") || str.endsWith(".svg") || str.endsWith(".png") || str.endsWith(".css") || str.endsWith(".scss")) {
        logger.verbose(`Ignoring module '${str}' with special extension`);
        return undefined;
    } else if (str[0] === "/") {
        f?.error(`Ignoring absolute module path '${str}'`, node);
        return undefined;
    }
    let filepath;
    try {
        filepath = a.tsModuleResolver.resolveModuleName(str, file);
        // TypeScript prioritizes .ts over .js, overrule if coming from a .js file
        if (file.endsWith(".js") && filepath.endsWith(".ts") && !str.endsWith(".ts")) {
            const p = filepath.substring(0, filepath.length - 3) + ".js";
            if (existsSync(p))
                filepath = p;
        }
    } catch (e) {
        logger.debug(`Could not resolve module '${str}' required from ${file} with TS compiler`);
        try {
            // try to resolve the module using require's logic
            filepath = module.createRequire(file).resolve(str);
        } catch {}

        if (!filepath)
            // see if the string refers to a package that is among those analyzed (and not in node_modules)
            for (const p of a.packageInfos.values())
                if (p.name === str)
                    if (filepath) {
                        f?.error(`Multiple packages named ${str} found, skipping module load`, node);
                        throw e;
                    } else {
                        filepath = resolve(p.dir, p.main || "index.js"); // https://nodejs.org/dist/latest-v8.x/docs/api/modules.html#modules_all_together
                        if (!existsSync(filepath))
                            filepath = undefined;
                    }

        if (!filepath)
            throw e;
    }
    if (filepath.endsWith(".json")) {
        logger.debug(`Skipping JSON file '${str}'`); // TODO: analyze JSON files?
        return undefined;
    } else if (filepath.endsWith(".node")) {
        logger.debug(`Skipping binary addon file '${str}'`);
        return undefined;
    }
    if (!filepath.startsWith(options.basedir) && !filepath.replaceAll("/", "\\").startsWith(options.basedir)) {
        const msg = `Found module at ${filepath}, but not in basedir`;
        logger.debug(msg);
        throw new Error(msg);
    }
    if (filepath.endsWith(".d.ts") || ![".js", ".jsx", ".es", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"].includes(extname(filepath))) {
        f?.warn(`Module '${filepath}' has unrecognized extension, skipping it`, node);
        return undefined;
    }
    if (options.excludeEntries &&
        a.getModuleInfo(file).packageInfo.isEntry &&
        micromatch.isMatch(filepath, options.excludeEntries))
        return undefined; // skip silently
    if (logger.isDebugEnabled())
        logger.debug(`Module '${str}' required from ${file} resolved to: ${filepath}`);
    return realpathSync(filepath);
}

/**
 * Attempts to auto-detect basedir if not set explicitly.
 * If not set explicitly, basedir is set to the nearest enclosing directory of all the given files containing a package.json file.
 * If the resulting directory is inside a node_modules directory, that directory is used instead.
 * @param paths paths to entry files or directories
 * @return true if successful, false if failed
 */
export function autoDetectBaseDir(paths: Array<string>): boolean {
    if (options.basedir) {
        if (!statSync(options.basedir).isDirectory()) {
            logger.info(`Error: basedir ${options.basedir} is not a directory, aborting`);
            return false;
        }
        return true;
    }
    if (paths.length === 0)
        return true;
    const t = findPackageJson(longestCommonPrefix(paths.map(p => {
        const p2 = resolve(process.cwd(), p);
        return statSync(p2).isDirectory() ? p2 : dirname(p2);
    })));
    if (!t) {
        logger.info("Can't auto-detect basedir, package.json not found (use option -b), aborting");
        return false;
    }
    options.basedir = t.dir;
    const i = options.basedir.lastIndexOf(`${sep}node_modules${sep}`);
    if (i !== -1)
        options.basedir = resolve(options.basedir.substring(0, i), "node_modules");
    logger.verbose(`Basedir auto-detected: ${options.basedir}`);
    return true;
}

type SourceLocationStr = string;

const codeCache: Map<SourceLocationStr, string> = new Map<SourceLocationStr, string>();

/**
 * Reads the code for a source location.
 * If cached, returns the cached value. If the code is too long, only returns the head and tail of the code.
 */
export function codeFromLocation(loc: Location | null | undefined): string {
    if (!loc)
        return "-";
    const locStr = locationToStringWithFileAndEnd(loc, true);
    let content = codeCache.get(locStr);
    if (!content) {
        content = "";
        if (loc && loc.module) {
            const fileContent = readFileSync(loc.module.getPath()).toString().split(/\r?\n/);
            let startRecord = false;
            for (let i = loc.start.line; i <= loc.end.line; i++) {
                const currLine = fileContent[i - 1];
                for (let j = 0; j < currLine.length; j++) {
                    if (i === loc.start.line && loc.start.column === j)
                        startRecord = true;
                    if (i === loc.end.line && j === loc.end.column) {
                        startRecord = false;
                        break;
                    }
                    if (startRecord)
                        content += currLine.charAt(j);
                }
            }
            content = content.replaceAll(/\s+/g, " ");
            if (content.length > 50)
                content = `${content.substring(0, 20)}...$${content.substring(content.length - 20)}`;
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
    stringify(value, (chunk: string | undefined) => {
        if (chunk)
            writeSync(fd, chunk);
    }, replacer, space);
}
