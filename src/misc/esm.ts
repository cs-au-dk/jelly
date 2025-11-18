import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {realpathSync} from "node:fs";
import {isBuiltin} from "node:module";
import {isDir, isFile, readJSON} from "./files";

const packageJSONCache = new Map<string, unknown>();
const resolveCache = new Map<string, string>();

function getPackageJSON(pkgJsonPath: string): unknown { // TODO: merge with findPackageJson
    const cached = packageJSONCache.get(pkgJsonPath);
    if (cached !== undefined)
        return cached;
    const data = readJSON(pkgJsonPath);
    packageJSONCache.set(pkgJsonPath, data);
    return data;
}

/**
 * LOOKUP_PACKAGE_SCOPE(url)
 * Finds the closest package.json by traversing up the directory tree.
 */
function lookupPackageScope(url: string): string | null {
    let dir = url.startsWith("file:") ? fileURLToPath(url) : url;
    if (isFile(dir))
        dir = path.dirname(dir);
    while (true) {
        const pkgPath = path.join(dir, "package.json");
        if (isFile(pkgPath))
            return pkgPath;
        const parent = path.dirname(dir);
        if (parent === dir)
            return null;
        if (path.basename(dir) === "node_modules")
            return null;
        dir = parent;
    }
}

/**
 * PATTERN_KEY_COMPARE(keyA, keyB)
 * Sorts pattern keys by specificity (longer base path wins, then longer pattern).
 */
function patternKeyCompare(keyA: string, keyB: string): number {
    const indexA = keyA.indexOf("*");
    const indexB = keyB.indexOf("*");
    const baseLenA = indexA === -1 ? keyA.length : indexA + 1;
    const baseLenB = indexB === -1 ? keyB.length : indexB + 1;
    if (baseLenA > baseLenB)
        return -1;
    if (baseLenB > baseLenA)
        return 1;
    if (indexA === -1)
        return 1;
    if (indexB === -1)
        return -1;
    if (keyA.length > keyB.length)
        return -1;
    if (keyB.length > keyA.length)
        return 1;
    return 0;
}

/**
 * PACKAGE_TARGET_RESOLVE(packageURL, target, patternMatch, isImports, conditions)
 * Resolves a single target value (string, array, or conditional object).
 */
function packageTargetResolve(
    packageURL: string,
    target: unknown,
    patternMatch: string | null,
    isImports: boolean,
    conditions: Array<string>
): string | undefined {
    if (target === null)
        return undefined;

    if (typeof target === "string") {
        // Handle non-relative targets
        if (!target.startsWith("./")) {
            // Spec: If isImports is false OR (target starts with "../" or "/" OR target is valid URL): throw
            if (!isImports || target.startsWith("../") || target.startsWith("/"))
                throw new Error("Invalid package target");

            // Check if target is a valid URL (which is invalid for imports)
            let isValidURL = false;
            try {
                new URL(target);
                isValidURL = true;
            } catch {
                // Not a valid URL
            }

            if (isValidURL)
                throw new Error("Invalid package target");

            // For imports with bare package names
            if (patternMatch !== null)
                return packageResolve(target.replace(/\*/g, patternMatch), packageURL, conditions);
            return packageResolve(target, packageURL, conditions);
        }

        // Validate path segments (after first ".")
        // Checks for encoded ".", "..", and "node_modules" with case-insensitive encoding
        const invalidSegmentRegEx = /(^|\\|\/)((\.|%2e)(\.|%2e)?|(n|%6e|%4e)(o|%6f|%4f)(d|%64|%44)(e|%65|%45)(_|%5f)(m|%6d|%4d)(o|%6f|%4f)(d|%64|%44)(u|%75|%55)(l|%6c|%4c)(e|%65|%45)(s|%73|%53))(\\|\/|$)/i;
        const afterFirstSegment = target.slice(target.indexOf('/') + 1);
        if (invalidSegmentRegEx.test(afterFirstSegment))
            throw new Error("Invalid package target");

        // Validate patternMatch if present
        if (patternMatch !== null) {
            const invalidSegmentRegEx = /(^|\\|\/)((\.|%2e)(\.|%2e)?|(n|%6e|%4e)(o|%6f|%4f)(d|%64|%44)(e|%65|%45)(_|%5f)(m|%6d|%4d)(o|%6f|%4f)(d|%64|%44)(u|%75|%55)(l|%6c|%4c)(e|%65|%45)(s|%73|%53))(\\|\/|$)/i;
            if (invalidSegmentRegEx.test(patternMatch))
                throw new Error("Invalid module specifier");
        }

        let resolvedTarget = target;
        if (patternMatch !== null)
            resolvedTarget = resolvedTarget.replace(/\*/g, patternMatch);

        const resolved = new URL(resolvedTarget, packageURL);
        const resolvedPath = fileURLToPath(resolved);

        // Validate that resolved path is within package
        const packagePath = fileURLToPath(packageURL);
        if (!resolvedPath.startsWith(packagePath))
            throw new Error("Invalid package target");

        if (!isFile(resolvedPath))
            return undefined;

        return resolved.href;
    }
    if (Array.isArray(target)) {
        if (target.length === 0)
            return undefined;

        // Try each target in order, continue on "Invalid Package Target" errors
        let lastError: any = null;
        let lastResult: string | undefined;
        for (const item of target) {
            try {
                const resolved = packageTargetResolve(packageURL, item, patternMatch, isImports, conditions);
                if (resolved !== undefined)
                    return resolved;
                lastResult = resolved;
            } catch (e: any) {
                if (e.message && e.message.includes("Invalid package target")) {
                    lastError = e;
                    continue;
                }
                throw e;
            }
        }
        // Return or throw last result
        if (lastError)
            throw lastError;
        return lastResult;
    }

    if (typeof target === "object") {
        // Validate no array indices (numeric keys)
        const keys = Object.keys(target);
        for (const key of keys)
            if (/^\d+$/.test(key))
                throw new Error("Invalid package configuration");

        // Conditional exports/imports
        for (const key of keys)
            if (key === "default" || conditions.includes(key)) {
                const resolved = packageTargetResolve(packageURL, (target as any)[key] as unknown, patternMatch, isImports, conditions);
                if (resolved !== undefined)
                    return resolved;
            }
        return undefined; // Objects return undefined per spec
    }
    throw new Error("Invalid package target");
}

/**
 * PACKAGE_IMPORTS_EXPORTS_RESOLVE(matchKey, matchObj, packageURL, isImports, conditions)
 * Resolves subpath patterns and direct matches in exports/imports per spec.
 */
function packageImportsExportsResolve(
    matchKey: string,
    matchObj: object,
    packageURL: string,
    isImports: boolean,
    conditions: Array<string>
): string | undefined {
    // Step 1: Reject if matchKey ends with "/"
    if (matchKey.endsWith("/") && matchKey !== "./")
        throw new Error("Invalid module specifier");

    // Step 2: Direct match without "*"
    if (typeof matchObj === "object" && matchObj !== null && matchKey in matchObj && !matchKey.includes("*")) {
        const target: unknown = (matchObj as any)[matchKey];
        return packageTargetResolve(packageURL, target, null, isImports, conditions);
    }

    // Step 3: Get expansion keys with single "*", sorted by PATTERN_KEY_COMPARE
    const expansionKeys = Object.keys(matchObj).filter(k => {
        const firstIndex = k.indexOf("*");
        if (firstIndex === -1)
            return false;
        return k.lastIndexOf("*") === firstIndex; // Ensures only one asterisk
    }).sort(patternKeyCompare);

    // Step 4: Pattern matching
    for (const expansionKey of expansionKeys) {
        const starIndex = expansionKey.indexOf("*");
        const patternBase = expansionKey.substring(0, starIndex);

        // Match must start with (but not equal) patternBase
        if (matchKey === patternBase || !matchKey.startsWith(patternBase))
            continue;

        const patternTrailer = expansionKey.substring(starIndex + 1);

        // Check patternTrailer conditions
        if (patternTrailer.length === 0 ||
            (matchKey.endsWith(patternTrailer) && matchKey.length >= expansionKey.length)) {
            const patternMatch = matchKey.substring(patternBase.length, matchKey.length - patternTrailer.length);
            const target: unknown = (matchObj as any)[expansionKey];
            // Return result directly - if pattern matches, use it even if target resolves to undefined
            return packageTargetResolve(packageURL, target, patternMatch, isImports, conditions);
        }
    }

    // Step 5: Return null/undefined per spec
    return undefined;
}

/**
 * PACKAGE_IMPORTS_RESOLVE(specifier, parentURL, conditions)
 * Resolves package imports (specifiers starting with #).
 */
function packageImportsResolve(
    specifier: string,
    parentURL: string,
    conditions: Array<string>
): string {
    // Step 1: Assert specifier begins with "#"
    if (!specifier.startsWith("#"))
        throw new Error("Assertion failed: specifier must start with #");

    // Step 2: Reject "#" and "#/"
    if (specifier === "#" || specifier.startsWith("#/"))
        throw new Error("Invalid module specifier");

    // Step 3: Find package scope
    const packageJsonPath = lookupPackageScope(parentURL);

    // Step 4: If scope exists
    if (packageJsonPath) {
        const packageJson = getPackageJSON(packageJsonPath);
        if (typeof packageJson === "object" && packageJson !== null && "imports" in packageJson) {
            const imports = packageJson.imports;
            if (typeof imports === "object" && imports !== null) {
                const packageURL = pathToFileURL(path.dirname(packageJsonPath) + "/").href;
                const resolved = packageImportsExportsResolve(specifier, imports, packageURL, true, conditions);
                if (resolved !== undefined)
                    return resolved;
            }
        }
    }

    // Step 5: Throw Package Import Not Defined
    throw new Error(`Package import not defined: "${specifier}"`);
}

/**
 * PACKAGE_EXPORTS_RESOLVE(packageURL, subpath, exports, conditions)
 * Resolves exports field for a given subpath per spec.
 */
function packageExportsResolve(
    packageURL: string,
    subpath: string,
    exports: unknown,
    conditions: Array<string>
): string {
    // Step 1: Check for invalid mixing of keys
    if (typeof exports === "object" && !Array.isArray(exports) && exports !== null) {
        const keys = Object.keys(exports);

        // Check for empty keys
        if (keys.some(k => k === ""))
            throw new Error("Invalid package configuration");

        const hasDot = keys.some(k => k.startsWith("."));
        const hasNonDot = keys.some(k => !k.startsWith("."));

        if (hasDot && hasNonDot)
            throw new Error("Invalid package configuration");
    }

    // Step 2: Handle subpath === "."
    if (subpath === ".") {
        let mainExport: unknown = undefined;

        if (typeof exports === "string" || Array.isArray(exports)) {
            mainExport = exports;
        } else if (typeof exports === "object" && exports !== null) {
            const keys = Object.keys(exports);
            const hasDot = keys.some(k => k.startsWith("."));

            if (!hasDot) // Object with no dot keys = conditional for "."
                mainExport = exports;
            else if ("." in exports)
                mainExport = exports["."];
        }

        if (mainExport !== undefined) {
            const resolved = packageTargetResolve(packageURL, mainExport, null, false, conditions);
            if (resolved !== undefined)
                return resolved;
        }
    } else if (typeof exports === "object" && !Array.isArray(exports) && exports !== null) {
        // Step 3: Else if exports object with all keys starting with "."
        const keys = Object.keys(exports);
        const allDot = keys.every(k => k.startsWith("."));

        if (allDot) {
            // Assert: subpath begins with "./" (only runs when subpath !== ".")
            if (!subpath.startsWith("./"))
                throw new Error("Invalid module specifier");

            const resolved = packageImportsExportsResolve(subpath, exports, packageURL, false, conditions);
            if (resolved !== undefined && resolved !== null)
                return resolved;
        }
    }

    // Step 4: Throw Package Path Not Exported
    throw new Error("Package path not exported");
}

/**
 * PACKAGE_SELF_RESOLVE(packageName, packageSubpath, parentURL)
 * Checks if current package exports the requested subpath for self-reference.
 */
function packageSelfResolve(
    packageName: string,
    packageSubpath: string,
    parentURL: string,
    conditions: Array<string>
): string | undefined {
    const packageJsonPath = lookupPackageScope(parentURL);
    if (!packageJsonPath)
        return undefined;

    const pjson = getPackageJSON(packageJsonPath);
    if (typeof pjson !== "object" || pjson === null || !("exports" in pjson) || pjson.exports === undefined)
        return undefined;

    if ("name" in pjson && pjson.name === packageName) {
        const packageURL = pathToFileURL(path.dirname(packageJsonPath) + "/").href;
        try {
            return packageExportsResolve(packageURL, packageSubpath, pjson.exports, conditions);
        } catch {
            // If exports resolve fails, return undefined (no self-reference match)
            return undefined;
        }
    }
    return undefined;
}

/**
 * PACKAGE_RESOLVE(specifier, parentURL, conditions)
 * Resolves bare specifiers by searching node_modules.
 */
function packageResolve(
    specifier: string,
    parentURL: string,
    conditions: Array<string>
): string {
    // Step 2: Reject empty strings
    if (specifier === "")
        throw new Error("Invalid module specifier");

    // Step 3: Check for builtin modules
    if (isBuiltin(specifier))
        return "node:" + specifier;

    // Step 4-5: Parse package name
    let packageName: string;

    if (!specifier.startsWith("@")) {
        const firstSlash = specifier.indexOf("/");
        packageName = firstSlash === -1 ? specifier : specifier.substring(0, firstSlash);
    } else {
        if (!specifier.includes("/"))
            throw new Error("Invalid module specifier");
        const firstSlash = specifier.indexOf("/");
        const secondSlash = specifier.indexOf("/", firstSlash + 1);
        packageName = secondSlash === -1 ? specifier : specifier.substring(0, secondSlash);
    }

    // Step 6: Validate package name
    if (packageName.startsWith(".") || packageName.includes("\\") || packageName.includes("%"))
        throw new Error("Invalid module specifier");

    // Step 7: Construct packageSubpath
    const packageSubpath = "." + specifier.substring(packageName.length);

    // Step 8-9: Self-reference check
    const selfUrl = packageSelfResolve(packageName, packageSubpath, parentURL, conditions);
    if (selfUrl !== undefined)
        return selfUrl;

    // Walk up directory tree looking for node_modules
    let dir = parentURL.startsWith("file:") ? fileURLToPath(parentURL) : parentURL;
    if (isFile(dir))
        dir = path.dirname(dir);

    while (true) {
        const nodeModulesPath = path.join(dir, "node_modules", packageName);

        if (isDir(nodeModulesPath)) {
            const packageJsonPath = path.join(nodeModulesPath, "package.json");
            const packageURL = pathToFileURL(nodeModulesPath + "/").href;

            if (isFile(packageJsonPath)) {
                const pkg = getPackageJSON(packageJsonPath);

                if (typeof pkg == "object" && pkg !== null && "exports" in pkg && pkg.exports !== undefined) {
                    // Has exports field - must use PACKAGE_EXPORTS_RESOLVE
                    return packageExportsResolve(packageURL, packageSubpath, pkg.exports, conditions);
                }
            }

            // Legacy resolution (no exports field)
            if (packageSubpath === ".") {
                // Try main field
                if (isFile(packageJsonPath)) {
                    const pkg = getPackageJSON(packageJsonPath);
                    if (typeof pkg == "object" && pkg !== null && "main" in pkg && typeof pkg.main === "string") {
                        const mainPath = path.join(nodeModulesPath, pkg.main);
                        if (isFile(mainPath))
                            return pathToFileURL(mainPath).href;
                    }
                }

                // Try index.js
                const indexPath = path.join(nodeModulesPath, "index.js");
                if (isFile(indexPath))
                    return pathToFileURL(indexPath).href;
            } else {
                // Direct subpath resolution (legacy)
                const subpathFile = path.join(nodeModulesPath, packageSubpath.substring(2));
                if (isFile(subpathFile))
                    return pathToFileURL(subpathFile).href;
            }
        }

        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }

    throw new Error(`Cannot find package "${specifier}" from ${parentURL}`);
}

/**
 * ESM_RESOLVE(specifier, parentURL)
 * Main ESM resolution algorithm following Node.js specification.
 * @param specifier module to import
 * @param parentURL URL of current module
 * @return URL of imported module
 * @throws error if unable to resolve
 */
export function resolveESM(specifier: string, parentURL: string): string {
    const cacheKey = specifier + "\0" + parentURL;
    const cached = resolveCache.get(cacheKey);
    if (cached)
        return cached;

    const conditions = ["node", "import", "default"];
    let resolved: string;

    // Try to parse as URL
    let parsed: URL | null = null;
    try {
        parsed = new URL(specifier);
    } catch {
        // Not a valid URL, will use path-based resolution below
    }

    // If successfully parsed as URL, handle URL protocols
    if (parsed !== null) {
        if (parsed.protocol === "node:")
            resolved = specifier;
        else if (parsed.protocol === "file:") {
            // Check for percent-encoded "/" or "\"
            const href = parsed.href;
            if (href.includes("%2F") || href.includes("%2f") || href.includes("%5C") || href.includes("%5c"))
                throw new Error("Invalid module specifier: percent-encoded slash");

            const filePath = fileURLToPath(parsed);

            // Check if directory
            if (isDir(filePath))
                throw new Error("Unsupported directory import");

            // Check if file exists
            if (!isFile(filePath))
                throw new Error(`Module not found: ${filePath}`);

            // Resolve to real path (resolve symlinks)
            try {
                const realPath = realpathSync(filePath);
                const realURL = pathToFileURL(realPath);
                // Preserve query and fragment
                if (parsed.search)
                    realURL.search = parsed.search;
                if (parsed.hash)
                    realURL.hash = parsed.hash;
                resolved = realURL.href;
            } catch {
                throw new Error(`Module not found: ${filePath}`);
            }
        } else if (parsed.protocol === "data:" || parsed.protocol === "http:" || parsed.protocol === "https:")
            resolved = parsed.href;
        else
            throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    } else {
        // Path-based resolution (not a URL)
        // Spec order: relative paths, then #imports, then bare specifiers
        if (specifier.startsWith("/") || specifier.startsWith("./") || specifier.startsWith("../")) {
            // Relative or absolute path
            let absolutePath: string;

            if (specifier.startsWith("/"))
                absolutePath = specifier;
            else {
                const parentPath = parentURL.startsWith("file:") ? fileURLToPath(parentURL) : parentURL;
                const parentDir = isFile(parentPath) ? path.dirname(parentPath) : parentPath;
                absolutePath = path.resolve(parentDir, specifier);
            }
            if (!isFile(absolutePath))
                throw new Error(`File not found: ${absolutePath}`);
            resolved = pathToFileURL(absolutePath).href;
        } else if (specifier.startsWith("#")) // Package imports
            resolved = packageImportsResolve(specifier, parentURL, conditions);
        else // Bare specifier
            resolved = packageResolve(specifier, parentURL, conditions);
    }
    resolveCache.set(cacheKey, resolved!);
    return resolved;
}
