import {
    AccessPathPattern,
    CallDetectionPattern,
    CallResultAccessPathPattern,
    ComponentDetectionPattern,
    DetectionPattern,
    DisjunctionAccessPathPattern,
    ExclusionAccessPathPattern,
    Filter,
    FilterSelector,
    Glob,
    ImportAccessPathPattern,
    ImportDetectionPattern,
    NumArgsCallFilter,
    PotentiallyUnknownAccessPathPattern,
    PropertyAccessPathPattern,
    ReadDetectionPattern,
    SimpleType,
    Type,
    TypeFilter,
    WildcardAccessPathPattern,
    WriteDetectionPattern
} from "./patterns";

export class AccessPathPatternCanonicalizer {

    canonical: Map<string, AccessPathPattern> = new Map;

    canonicalize<T extends AccessPathPattern>(p: T): T {
        const key = p.toString();
        const c = this.canonical.get(key) as T;
        if (c)
            return c;
        this.canonical.set(key, p);
        return p;
    }
}

// parse-unparse detection pattern if run as script
if (require.main === module) {
    console.log(parseDetectionPattern(process.argv[2], new AccessPathPatternCanonicalizer()).toString());
}

/**
 * Attempts to parse an access path pattern.
 * @throws position in string where parsing failed, in case of parse error
 */
export function parseDetectionPattern(pattern: string, c: AccessPathPatternCanonicalizer): DetectionPattern {

    function parseSpace(start: number, optional: boolean = true): number {
        let pos = start;
        while (pattern[pos] === " ")
            pos++;
        if (!optional && pos === start)
            throw pos;
        return pos;
    }

    function parseEnd(start: number) {
        if (start != pattern.length)
            throw start;
    }

    function parseOptionalKeyword(start: number, keyword: string): [boolean, number] {
        if (pattern.substring(start, start + keyword.length).toLowerCase() === keyword)
            return [true, start + keyword.length];
        else
            return [false, start];
    }

    function parseChar(start: number, char: string): number {
        if (pattern[start] === char)
            return start + 1;
        else
            throw start;
    }

    function parseAccessPathPattern(start: number): [AccessPathPattern, number] {
        let p, pos;
        pos = parseSpace(start);
        switch (pattern[pos]) {
            case "<":
                let g;
                [g, pos] = parseGlob(pos + 1);
                p = c.canonicalize(new ImportAccessPathPattern(g));
                pos = parseSpace(pos);
                pos = parseChar(pos, ">");
                break;
            case "{":
                pos = pos + 1;
                const aps: Array<AccessPathPattern> = [];
                do {
                    let q;
                    [q, pos] = parseAccessPathPattern(pos);
                    pos = parseSpace(pos);
                    aps.push(q);
                } while (pattern[pos] === "," && ++pos);
                pos = parseChar(pos, "}");
                p = c.canonicalize(new DisjunctionAccessPathPattern(aps));
                break;
            case "(":
                let incl, excl;
                [incl, pos] = parseAccessPathPattern(pos + 1);
                pos = parseSpace(pos);
                pos = parseChar(pos, "\\");
                [excl, pos] = parseAccessPathPattern(pos);
                pos = parseSpace(pos);
                pos = parseChar(pos, ")");
                p = c.canonicalize(new ExclusionAccessPathPattern(incl, excl));
                break;
            default:
                throw start;
        }
        pos = parseSpace(pos);
        while ("(.?*".includes(pattern[pos])) {
            if (pattern[pos] === ".") {
                pos++;
                pos = parseSpace(pos);
                const props: Array<string> = [];
                if (pattern[pos] === "{" && ++pos) {
                    do {
                        let prop;
                        pos = parseSpace(pos);
                        [prop, pos] = parseProp(pos);
                        pos = parseSpace(pos);
                        props.push(prop);
                    } while (pattern[pos] === "," && ++pos);
                    pos = parseChar(pos, "}");
                } else {
                    let prop;
                    [prop, pos] = parseProp(pos);
                    props.push(prop);
                }
                p = c.canonicalize(new PropertyAccessPathPattern(p, props));
            } else if (pattern[pos] === "(" && pattern[pos + 1] === ")") {
                pos += 2;
                pos = parseSpace(pos);
                p = c.canonicalize(new CallResultAccessPathPattern(p));
            } else if (pattern[pos] === "?") {
                pos++;
                pos = parseSpace(pos);
                p = c.canonicalize(new PotentiallyUnknownAccessPathPattern(p));
            } else if (pattern[pos] === "*" && pattern[pos + 1] === "*") {
                pos += 2;
                pos = parseSpace(pos);
                p = c.canonicalize(new WildcardAccessPathPattern(p));
            } else
                throw pos + 1;
            pos = parseSpace(pos);
        }
        return [p, pos];
    }

    function parseProp(start: number): [string, number] {
        let pos = start;
        while (pos < pattern.length && !",{}./()*<>[]: ".includes(pattern[pos]))
            pos++;
        if (pos === start)
            throw pos;
        return [pattern.substring(start, pos), pos];
    }

    function parseGlob(start: number): [Glob, number] {
        let end = pattern.indexOf(">", start); // TODO: ignoring that '>' may be escaped/quoted
        if (end === -1)
            end = pattern.length;
        const glob = pattern.substring(start, end).trim();
        return [glob, end];
    }

    function parseOptionalNumber(start: number, allowNegative: boolean = false): [number | undefined, number] {
        let pos = start;
        if (allowNegative && pattern[pos] === "-")
            pos++;
        while (pattern[pos] >= "0" && pattern[pos] <= "9")
            pos++;
        if (pos === start)
            return [undefined, start];
        return [parseInt(pattern.substring(start, pos), 10), pos];
    }

    function parseTypeScriptType(start: number): [string, number] { // TODO: what syntax should be allowed for TS types?
        let pos = start, c: string;
        // noinspection CommaExpressionJS
        while (c = pattern[pos], (c >= "0" && c <= "9") || (c >= "a" && c <= 'z') || (c >= "A" && c <= "Z") || "._$".includes(c))
            pos++;
        if (pos === start)
            throw start;
        return [pattern.substring(start, pos), pos];
    }

    function parseFilter(start: number): [Filter, number] {
        let pos = start;
        if (pattern[pos] === "[") {
            pos++;
            pos = parseSpace(pos);
            let minArgs;
            [minArgs, pos] = parseOptionalNumber(pos);
            pos = parseSpace(pos);
            pos = parseChar(pos, ",");
            pos = parseSpace(pos);
            let maxArgs;
            [maxArgs, pos] = parseOptionalNumber(pos);
            pos = parseSpace(pos);
            pos = parseChar(pos, "]");
            pos = parseSpace(pos);
            return [new NumArgsCallFilter(minArgs, maxArgs), pos];
        } else {
            let selector;
            [selector, pos] = parseFilterSelector(pos);
            pos = parseSpace(pos);
            pos = parseChar(pos, ":");
            pos = parseSpace(pos);
            let types;
            [types, pos] = parseTypes(pos);
            pos = parseSpace(pos);
            return [new TypeFilter(selector, types), pos];
        }
    }

    function parseColonTypes(start: number): [Array<Type>, number] {
        pos = parseSpace(start);
        pos = parseChar(pos, ":");
        pos = parseSpace(pos);
        let types;
        [types, pos] = parseTypes(pos);
        pos = parseSpace(pos);
        return [types, pos];
    }

    function parseOptionalBaseFilter(start: number): [Array<Type> | undefined, number] {
        let [base, pos] = parseOptionalKeyword(start, "base");
        if (!base)
            return [undefined, pos];
        let types;
        [types, pos] = parseColonTypes(pos);
        return [types, pos];
    }

    function parseOptionalValueFilter(start: number): [Array<Type> | undefined, number] {
        let [value, pos] = parseOptionalKeyword(start, "value");
        if (!value)
            return [undefined, pos];
        let types;
        [types, pos] = parseColonTypes(pos);
        return [types, pos];
    }

    function parseOptionalValueBaseFilters(start: number): [Array<Type> | undefined, Array<Type> | undefined, number] {
        let [valueFilter, pos] = parseOptionalValueFilter(start);
        let baseFilter;
        [baseFilter, pos] = parseOptionalBaseFilter(pos);
        if (!valueFilter && baseFilter)
            [valueFilter, pos] = parseOptionalValueFilter(pos);
        return [valueFilter, baseFilter, pos];
    }

    function parseFilterSelector(start: number): [FilterSelector, number] {
        let head: number | "base" | undefined;
        let [base, pos] = parseOptionalKeyword(start, "base");
        if (base)
            head = "base";
        else {
            [head, pos] = parseOptionalNumber(pos, true);
            if (head === undefined)
                throw start;
        }
        const props = [];
        pos = parseSpace(pos);
        while (pattern[pos] === "." && ++pos) {
            let prop;
            pos = parseSpace(pos);
            [prop, pos] = parseProp(pos);
            pos = parseSpace(pos);
            props.push(prop);
        }
        return [new FilterSelector(head, props.length > 0 ? props : undefined), pos];
    }

    function parseTypes(start: number): [Array<Type>, number] {
        let pos = start;
        const types: Array<Type> = [];
        if (pattern[pos] === "{" && ++pos) {
            do {
                let typ;
                pos = parseSpace(pos);
                [typ, pos] = parseType(pos);
                pos = parseSpace(pos);
                types.push(typ);
            } while (pattern[pos] === "," && ++pos);
            pos = parseChar(pos, "}");
        } else {
            let typ;
            [typ, pos] = parseType(pos);
            types.push(typ);
        }
        return [types, pos];
    }

    function parseType(start: number): [Type, number] {
        for (const t of ["undefined", "boolean", "string", "number", "array", "empty-array", "object", "null", "function", "any"])
            if (pattern.startsWith(t, start)) {
                let num, pos = start + t.length;
                if (t === "function")
                    [num, pos] = parseOptionalNumber(pos);
                return [new Type(t as SimpleType, num, undefined, undefined), pos];
            }
        let match, pos;
        [match, pos] = parseOptionalKeyword(start, "true");
        if (match)
            return [new Type(undefined, undefined, true, undefined), pos];
        [match, pos] = parseOptionalKeyword(start, "false");
        if (match)
            return [new Type(undefined, undefined, false, undefined), pos];
        if (pattern[pos] === "\"" && ++pos) {
            const i = pattern.indexOf("\"", pos);
            if (i === -1)
                throw pos;
            const str = pattern.substring(pos, i);
            pos = i + 1;
            return [new Type(undefined, undefined, str, undefined), pos];
        }
        let num;
        [num, pos] = parseOptionalNumber(start, true); // TODO: support floating-point numbers?
        if (num !== undefined)
            return [new Type(undefined, undefined, num, undefined), pos];
        let tsType;
        [tsType, pos] = parseTypeScriptType(start);
        return [new Type(undefined, undefined, undefined, tsType), pos];
    }

    let pos, res, p, b;
    pos = parseSpace(0);
    if (([b, pos] = parseOptionalKeyword(pos, "import")) && b) {
        let onlyDefault;
        [onlyDefault, pos] = parseOptionalKeyword(pos, "d");
        pos = parseSpace(pos, false);
        if (pattern[pos] !== "<") { // legacy mode
            let g;
            [g, pos] = parseGlob(pos);
            p = c.canonicalize(new ImportAccessPathPattern(g));
        } else {
            [p, pos] = parseAccessPathPattern(pos);
            if (!(p instanceof ImportAccessPathPattern))
                throw pos;
        }
        res = new ImportDetectionPattern(p, onlyDefault);
    } else if (([b, pos] = parseOptionalKeyword(pos, "read")) && b) {
        let notInvoked;
        [notInvoked, pos] = parseOptionalKeyword(pos, "o");
        pos = parseSpace(pos, false);
        [p, pos] = parseAccessPathPattern(pos);
        if (!(p instanceof PropertyAccessPathPattern))
            throw pos;
        let baseFilter;
        [baseFilter, pos] = parseOptionalBaseFilter(pos);
        res = new ReadDetectionPattern(p, notInvoked, baseFilter);
    } else if (([b, pos] = parseOptionalKeyword(pos, "write")) && b) {
        pos = parseSpace(pos, false);
        [p, pos] = parseAccessPathPattern(pos);
        if (!(p instanceof PropertyAccessPathPattern))
            throw pos;
        let valueFilter, baseFilter;
        [valueFilter, baseFilter, pos] = parseOptionalValueBaseFilters(pos);
        res = new WriteDetectionPattern(p, valueFilter, baseFilter);
    } else if (([b, pos] = parseOptionalKeyword(pos, "call")) && b) {
        let onlyReturnChanged, onlyWhenUsedAsPromise, onlyNonNewCalls;
        [onlyReturnChanged, pos] = parseOptionalKeyword(pos, "r");
        [onlyWhenUsedAsPromise, pos] = parseOptionalKeyword(pos, "promise");
        [onlyNonNewCalls, pos] = parseOptionalKeyword(pos, "notnew");
        pos = parseSpace(pos, false);
        [p, pos] = parseAccessPathPattern(pos);
        const filters: Array<Filter> = [];
        while (pos < pattern.length) {
            let filter;
            [filter, pos] = parseFilter(pos);
            filters.push(filter);
        }
        res = new CallDetectionPattern(p, onlyReturnChanged, onlyWhenUsedAsPromise, onlyNonNewCalls, filters.length > 0 ? filters : undefined);
    } else if (([b, pos] = parseOptionalKeyword(pos, "component")) && b) {
        pos = parseSpace(pos, false);
        [p, pos] = parseAccessPathPattern(pos);
        const filters: Array<Filter> = [];
        while (pos < pattern.length) {
            let filter;
            [filter, pos] = parseFilter(pos);
            filters.push(filter);
        }
        res = new ComponentDetectionPattern(p, filters.length > 0 ? filters : undefined);
    } else
        throw 0;
    pos = parseSpace(pos);
    parseEnd(pos);
    return res;
}
