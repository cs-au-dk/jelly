import {FilePath, pushAll} from "./util";
import {basename, dirname, relative, resolve} from "path";
import {existsSync, readFileSync} from "fs";
import logger from "./logger";
import {options} from "../options";
import {isDir} from "./files";

/**
 * Information about a package.json file.
 */
export interface PackageJsonInfo {

    /**
     * Package key generated from its name and version, or "<unknown>" if package.json file is not found.
     */
    packagekey: string;

    /**
     * Package name, "<main>" if package.json file is not found, or "<anonymous>" if the main field is missing.
     */
    name: string;

    /**
     * Package version, undefined if not available.
     */
    version: string | undefined;

    /**
     * Normalized main file, undefined if not set or file is absent.
     */
    main: string | undefined;

    /**
     * Directory containing the package.json file, or current working directory if the file is not found.
     */
    dir: string;

    /**
     * All values in "exports", undefined if absent.
     */
    exports: Array<string> | undefined;
}

/**
 * Finds the enclosing package.json file if present.
 */
export function findPackageJson(file: FilePath): {packageJson: FilePath, dir: FilePath} | undefined {
    let dir = isDir(file) ? file : dirname(file);
    while (true) {
        if (options.basedir && !dir.startsWith(options.basedir))
            return undefined;
        const parentDir = dirname(dir);
        const packageJson = resolve(dir, "package.json");
        if (existsSync(packageJson)) { // ignore package.json if inside node_modules but not at package root (not perfect, but seems to work)
            let ok = true;
            if (dir.includes("node_modules")) {
                const b = basename(parentDir);
                ok = b === "node_modules" || (b.startsWith("@") && basename(dirname(parentDir)) === "node_modules");
            }
            if (ok)
                return {packageJson, dir};
            else
                logger.verbose(`Ignoring ${packageJson} in search for package.json`);
        }
        if (parentDir === dir)
            return undefined;
        dir = parentDir;
    }
}

/**
 * Loads and parses the given package.json file.
 */
function parsePackageJson(packageJson: FilePath): unknown {
    return JSON.parse(readFileSync(packageJson, {encoding: "utf8"}));
}

/**
 * Extracts PackageJsonInfo for the package containing the given file.
 */
export function getPackageJsonInfo(tofile: FilePath): PackageJsonInfo {
    let packagekey, name: string, version: string | undefined, main: string | undefined, dir: string, exports: Array<string> | undefined;
    const p = findPackageJson(tofile); // TODO: add command-line option to skip search for package.json for entry files?
    let f: unknown;
    if (p) {
        try {
            f = parsePackageJson(p.packageJson);
        } catch {
            logger.warn(`Unable to parse ${p.packageJson}`);
        }
    }
    if (p && f) {
        dir = p.dir;
        if (typeof f === "object" && "name" in f && typeof f.name === "string")
            name = f.name;
        else {
            logger.verbose(`Package name missing in ${p.packageJson}`);
            name = "<anonymous>";
        }
        if (typeof f === "object" && "version" in f && typeof f.version === "string")
            version = f.version;
        else
            logger.verbose(`Package version missing in ${p.packageJson}`);
        packagekey = `${name}@${version ?? "?"}`;
        if (typeof f === "object" && "main" in f && typeof f.main === "string") {
            try {
                // normalize main file path
                main = relative(dir, require.resolve("./".includes(f.main[0]) ? f.main : "./" + f.main, {paths: [dir]}));
            } catch {
                logger.verbose(`Unable to locate package main file '${f.main}' at ${dir}`);
                main = undefined;
            }
        }
        if (typeof f === "object" && "exports" in f) {
            // This documentation is better than the NodeJS documentation: https://webpack.js.org/guides/package-exports/
            // TODO: negative patterns, e.g., {"./test/*": null}
            exports = [];
            if (main)
                exports.push(main);
            const queue = [f.exports];
            while (queue.length > 0) {
                const exp = queue.pop();
                if (typeof exp === "string") {
                    if (exp.startsWith("./"))
                        exports.push(exp !== "./" && exp.endsWith("/") ? exp + "*" : exp);
                    else {
                        exports = undefined;
                        logger.warn(`Warning: Non-relative export (${exp}) found in ${p.packageJson}`);
                        break;
                    }
                } else if (Array.isArray(exp))
                    pushAll(exp, queue);
                else if (exp === null)
                    logger.warn(`Warning: Unsupported negative exports pattern found in ${p.packageJson}`);
                else if (typeof exp === "object")
                    pushAll(Object.values(exp), queue);
                else {
                    exports = undefined;
                    logger.warn(`Warning: Invalid export (${exp}) found in ${p.packageJson}`);
                    break;
                }
            }
        }
    } else {
        name = "<main>";
        packagekey = "<unknown>";
        dir = process.cwd();
    }
    return {packagekey, name, version, main, dir, exports};
}

/**
 * Checks if a file (relative path) belongs to the exports of a package.
 */
export function isInExports(rel: string, exports: Array<string>): boolean {
    // TODO: all wildcards in a pattern should expand to the same value
    for (const path of exports)
        if (path.includes("*")) {
            if (new RegExp(`^${path.replaceAll(/\*/g, ".*")}$`).test(rel))
                return true;
        } else if (path === rel)
            return true;
    return false;
}
