import assert from "assert";

export type Glob = string;

export abstract class DetectionPattern {

    readonly ap: AccessPathPattern;

    protected constructor(ap: AccessPathPattern) {
        this.ap = ap;
    }

    abstract toString(): string
}

export class ImportDetectionPattern extends DetectionPattern {

    readonly onlyDefault: boolean; // TODO: change to "importDefault"?

    constructor(ap: ImportAccessPathPattern, onlyDefault: boolean) {
        super(ap);
        this.onlyDefault = onlyDefault;
    }

    toString(): string {
        return `import${this.onlyDefault ? "D" : ""} ${this.ap}`;
    }
}

export class ReadDetectionPattern extends DetectionPattern {

    readonly notInvoked: boolean; // TODO: change to "readNotCall"?

    readonly baseFilter: Array<Type> | undefined;

    constructor(ap: PropertyAccessPathPattern, notInvoked: boolean, baseFilter: Array<Type> | undefined) {
        super(ap);
        this.notInvoked = notInvoked;
        this.baseFilter = baseFilter;
    }

    toString(): string {
        const base = this.baseFilter ? ` base:${this.baseFilter.length === 1 ? this.baseFilter[0] : `{${this.baseFilter.join(",")}`}` : "";
        return `read${this.notInvoked ? "O" : ""} ${this.ap}${base}`;
    }
}

export class WriteDetectionPattern extends DetectionPattern {

    readonly valueFilter: Array<Type> | undefined;

    readonly baseFilter: Array<Type> | undefined;

    constructor(ap: PropertyAccessPathPattern, valueFilter: Array<Type> | undefined, baseFilter: Array<Type> | undefined) {
        super(ap);
        this.valueFilter = valueFilter;
        this.baseFilter = baseFilter;
        // TODO: assert type 'any' not in filters?
    }

    toString(): string {
        const base = this.baseFilter ? ` base:${this.baseFilter.length === 1 ? this.baseFilter[0] : `{${this.baseFilter.join(",")}`}` : "";
        const value = this.valueFilter ? ` value:${this.valueFilter.length === 1 ? this.valueFilter[0] : `{${this.valueFilter.join(",")}`}` : "";
        return `write ${this.ap}${base}${value}`;
    }
}

export class CallDetectionPattern extends DetectionPattern { // TODO: introduce ComponentDetectionPattern? (see ComponentAccessPathPattern)

    readonly onlyReturnChanged: boolean; // TODO: change to "callReturns"?

    readonly onlyWhenUsedAsPromise: boolean;

    readonly onlyNonNewCalls: boolean;

    readonly filters: Array<Filter> | undefined;

    constructor(ap: AccessPathPattern, onlyReturnChanged: boolean, onlyWhenUsedAsPromise: boolean, onlyNonNewCalls: boolean, filters: Array<Filter> | undefined) {
        super(ap);
        this.onlyReturnChanged = onlyReturnChanged;
        this.onlyWhenUsedAsPromise = onlyWhenUsedAsPromise;
        this.onlyNonNewCalls = onlyNonNewCalls;
        this.filters = filters;
    }

    toString(): string {
        return `call${this.onlyReturnChanged ? "R" : this.onlyWhenUsedAsPromise ? "Promise" : this.onlyNonNewCalls ? "NotNew" : ""} ${this.ap}${this.filters && this.filters.length > 0 ? " " + this.filters.join(" ") : ""}`;
    }
}

export interface AccessPathPattern {

    toString(): string

    visitAccessPathPatterns(visitor: (p: AccessPathPattern) => void): void
}

export class ImportAccessPathPattern {

    readonly glob: Glob;

    constructor(glob: Glob) {
        this.glob = glob;
    }

    toString(): string {
        return `<${this.glob}>`;
    }

    visitAccessPathPatterns(visitor: (p: AccessPathPattern) => void): void {
        visitor(this);
    }
}

export class PropertyAccessPathPattern {

    readonly base: AccessPathPattern;

    readonly props: Array<string>;

    constructor(base: AccessPathPattern, props: Array<string>) {
        this.base = base;
        this.props = props;
    }

    toString(): string {
        return `${this.base}.${this.props.length === 1 ? `${this.props[0]}` : `{${this.props.join(',')}}`}`;
    }

    visitAccessPathPatterns(visitor: (p: AccessPathPattern) => void): void {
        visitor(this);
        this.base.visitAccessPathPatterns(visitor);
    }
}

export class CallResultAccessPathPattern {

    readonly fun: AccessPathPattern;

    constructor(fun: AccessPathPattern) {
        this.fun = fun;
    }

    toString(): string {
        return `${this.fun}()`;
    }

    visitAccessPathPatterns(visitor: (p: AccessPathPattern) => void): void {
        visitor(this);
        this.fun.visitAccessPathPatterns(visitor);
    }
}

export class ComponentAccessPathPattern {

    readonly component: AccessPathPattern;

    constructor(component: AccessPathPattern) {
        this.component = component;
    }

    toString(): string {
        return `${this.component}<>`;
    }

    visitAccessPathPatterns(visitor: (p: AccessPathPattern) => void): void {
        visitor(this);
        this.component.visitAccessPathPatterns(visitor);
    }
}

export class AbbreviatedPathPattern {

    readonly prefix: AccessPathPattern;

    constructor(prefix: AccessPathPattern) {
        this.prefix = prefix;
    }

    toString(): string {
        return `${this.prefix}…`;
    }

    visitAccessPathPatterns(visitor: (p: AccessPathPattern) => void): void {
        visitor(this);
        this.prefix.visitAccessPathPatterns(visitor);
    }
}

export class DisjunctionAccessPathPattern {

    readonly aps: Array<AccessPathPattern>;

    constructor(aps: Array<AccessPathPattern>) {
        this.aps = aps;
    }

    toString(): string {
        return `{${this.aps.map((ap: AccessPathPattern) => ap.toString()).join(',')}}`;
    }

    visitAccessPathPatterns(visitor: (p: AccessPathPattern) => void): void {
        visitor(this);
        for (const ap of this.aps)
            ap.visitAccessPathPatterns(visitor);
    }
}

export class ExclusionAccessPathPattern {

    readonly include: AccessPathPattern;

    readonly exclude: AccessPathPattern;

    constructor(include: AccessPathPattern, exclude: AccessPathPattern) {
        this.include = include;
        this.exclude = exclude;
    }

    toString(): string {
        return `(${this.include}\\${this.exclude})`;
    }

    visitAccessPathPatterns(visitor: (p: AccessPathPattern) => void): void {
        visitor(this);
        this.include.visitAccessPathPatterns(visitor);
        this.exclude.visitAccessPathPatterns(visitor);
    }
}

export class WildcardAccessPathPattern {

    readonly ap: AccessPathPattern;

    constructor(ap: AccessPathPattern) {
        this.ap = ap;
    }

    toString(): string {
        return `${this.ap}**`;
    }

    visitAccessPathPatterns(visitor: (p: AccessPathPattern) => void): void {
        visitor(this);
        this.ap.visitAccessPathPatterns(visitor);
    }
}

export class PotentiallyUnknownAccessPathPattern {

    readonly ap: AccessPathPattern;

    constructor(ap: AccessPathPattern) {
        this.ap = ap;
    }

    toString(): string {
        return `${this.ap}?`;
    }

    visitAccessPathPatterns(visitor: (p: AccessPathPattern) => void): void {
        visitor(this);
        this.ap.visitAccessPathPatterns(visitor);
    }
}

export abstract class Filter {

    abstract toString(): string
}

export class NumArgsCallFilter extends Filter {

    readonly minArgs: number | undefined;

    readonly maxArgs: number | undefined;

    constructor(minArgs: number | undefined, maxArgs: number | undefined) {
        super();
        this.minArgs = minArgs;
        this.maxArgs = maxArgs;
    }

    public toString(): string {
        return `[${this.minArgs !== undefined ? this.maxArgs : ""},${this.maxArgs !== undefined ? this.maxArgs : ""}]`;
    }
}

export class TypeFilter extends Filter {

    readonly selector: FilterSelector;

    readonly types: Array<Type>;

    constructor(selector: FilterSelector, types: Array<Type>) {
        super();
        this.selector = selector;
        this.types = types;
        // TODO: type 'any' should only be used with access path selectors
    }

    public toString(): string {
        return `${this.selector}:${this.types.length === 1 ? this.types[0] : `{${this.types.join(",")}`}`;
    }
}

export class FilterSelector {

    head: number | "base";

    props: Array<string> | undefined;

    constructor(head: number | "base", props: Array<string> | undefined) {
        this.head = head;
        this.props = props;
    }

    public toString(): string {
        return `${this.head}${this.props ? `.${this.props.join(".")}` : ""}`;
    }
}

export type SimpleType = "undefined" | "boolean" | "string" | "number" | "array" | "empty-array" | "object" | "null" | "function" | "any";

export type ValueType = string | number | boolean;

export class Type {

    readonly simpleType: SimpleType | undefined; // 'any' only for access path selectors

    readonly functionArgs: number | undefined; // only for type "function"

    readonly valueType: ValueType | undefined;

    readonly tsType: string | undefined; // TODO: assume disjoint from String(this.type)?

    constructor(simpleType: SimpleType | undefined, functionArgs: number | undefined, valueType: ValueType | undefined, tsType: string | undefined) {
        assert((simpleType !== undefined ? 1 : 0) + (valueType !== undefined ? 1 : 0) + (tsType !== undefined ? 1 : 0) === 1);
        assert(!functionArgs || simpleType === "function");
        this.simpleType = simpleType;
        this.functionArgs = functionArgs;
        this.valueType = valueType;
        this.tsType = tsType;
    }

    toString(): string {
        if (this.simpleType)
            return this.simpleType + (this.functionArgs !== undefined ? this.functionArgs : "");
        if (this.tsType)
            return this.tsType;
        assert(this.valueType !== undefined, "Unexpected type in toString");
        switch (typeof this.valueType) {
            case "string":
                return `"${this.valueType}"`;
            case "number":
            case "boolean":
                return this.valueType.toString();
            default:
                assert.fail(`Unexpected type ${typeof this.valueType}`);
        }
    }

    static makeSimpleType(simpleType: SimpleType, functionArgs?: number | undefined): Type {
        return new Type(simpleType, functionArgs, undefined, undefined)
    }

    static makeValueType(valueType: ValueType): Type {
        return new Type(undefined, undefined, valueType, undefined);
    }

    static makeTSType(tsType: string): Type {
        return new Type(undefined, undefined, undefined, tsType);
    }
}
