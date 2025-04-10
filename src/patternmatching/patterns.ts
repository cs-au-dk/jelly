import assert from "assert";

export type Glob = string;

export abstract class DetectionPattern {

    protected constructor(readonly ap: AccessPathPattern) {}

    abstract toString(): string
}

export class ImportDetectionPattern extends DetectionPattern {

    constructor(
        ap: ImportAccessPathPattern,
        readonly onlyDefault: boolean // TODO: change to "importDefault"?
    ) {
        super(ap);
    }

    toString(): string {
        return `import${this.onlyDefault ? "D" : ""} ${this.ap}`;
    }
}

export class ReadDetectionPattern extends DetectionPattern {

    constructor(
        ap: PropertyAccessPathPattern,
        readonly notInvoked: boolean, // TODO: change to "readNotCall"?
        readonly baseFilter: Array<Type> | undefined
    ) {
        super(ap);
    }

    toString(): string {
        const base = this.baseFilter ? ` base:${this.baseFilter.length === 1 ? this.baseFilter[0] : `{${this.baseFilter.join(",")}`}` : "";
        return `read${this.notInvoked ? "O" : ""} ${this.ap}${base}`;
    }
}

export class WriteDetectionPattern extends DetectionPattern {

    constructor(
        ap: PropertyAccessPathPattern,
        readonly valueFilter: Array<Type> | undefined,
        readonly baseFilter: Array<Type> | undefined
    ) {
        super(ap);
        // TODO: assert type 'any' not in filters?
    }

    toString(): string {
        const base = this.baseFilter ? ` base:${this.baseFilter.length === 1 ? this.baseFilter[0] : `{${this.baseFilter.join(",")}`}` : "";
        const value = this.valueFilter ? ` value:${this.valueFilter.length === 1 ? this.valueFilter[0] : `{${this.valueFilter.join(",")}`}` : "";
        return `write ${this.ap}${base}${value}`;
    }
}

export class CallDetectionPattern extends DetectionPattern {

    constructor(
        ap: AccessPathPattern,
        readonly onlyReturnChanged: boolean, // TODO: change to "callReturns"?
        readonly onlyWhenUsedAsPromise: boolean,
        readonly onlyNonNewCalls: boolean,
        readonly filters: Array<Filter> | undefined
    ) {
        super(ap);
    }

    toString(): string {
        return `call${this.onlyReturnChanged ? "R" : this.onlyWhenUsedAsPromise ? "Promise" : this.onlyNonNewCalls ? "NotNew" : ""} ${this.ap}${this.filters && this.filters.length > 0 ? " " + this.filters.join(" ") : ""}`;
    }
}

export class ComponentDetectionPattern extends DetectionPattern {

    constructor(
        ap: AccessPathPattern,
        readonly filters: Array<Filter> | undefined
    ) {
        super(ap);
    }

    toString(): string {
        return `component ${this.ap}${this.filters && this.filters.length > 0 ? " " + this.filters.join(" ") : ""}`;
    }
}

export interface AccessPathPattern {

    toString(): string

    visitAccessPathPatterns(visitor: (p: AccessPathPattern) => void): void
}

export class ImportAccessPathPattern {

    constructor(readonly glob: Glob) {}

    toString(): string {
        return `<${this.glob}>`;
    }

    visitAccessPathPatterns(visitor: (p: AccessPathPattern) => void): void {
        visitor(this);
    }
}

export class PropertyAccessPathPattern {

    constructor(
        readonly base: AccessPathPattern,
        readonly props: Array<string>
    ) {}

    toString(): string {
        return `${this.base}.${this.props.length === 1 ? `${this.props[0]}` : `{${this.props.join(',')}}`}`;
    }

    visitAccessPathPatterns(visitor: (p: AccessPathPattern) => void): void {
        visitor(this);
        this.base.visitAccessPathPatterns(visitor);
    }
}

export class CallResultAccessPathPattern {

    constructor(readonly fun: AccessPathPattern) {}

    toString(): string {
        return `${this.fun}()`;
    }

    visitAccessPathPatterns(visitor: (p: AccessPathPattern) => void): void {
        visitor(this);
        this.fun.visitAccessPathPatterns(visitor);
    }
}

export class ComponentAccessPathPattern {

    constructor(readonly component: AccessPathPattern) {}

    toString(): string {
        return `${this.component}<>`;
    }

    visitAccessPathPatterns(visitor: (p: AccessPathPattern) => void): void {
        visitor(this);
        this.component.visitAccessPathPatterns(visitor);
    }
}

export class AbbreviatedPathPattern {

    constructor(readonly prefix: AccessPathPattern) {}

    toString(): string {
        return `${this.prefix}…`;
    }

    visitAccessPathPatterns(visitor: (p: AccessPathPattern) => void): void {
        visitor(this);
        this.prefix.visitAccessPathPatterns(visitor);
    }
}

export class DisjunctionAccessPathPattern {

    constructor(readonly aps: Array<AccessPathPattern>) {}

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

    constructor(
        readonly include: AccessPathPattern,
        readonly exclude: AccessPathPattern
    ) {
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

    constructor(readonly ap: AccessPathPattern) {}

    toString(): string {
        return `${this.ap}**`;
    }

    visitAccessPathPatterns(visitor: (p: AccessPathPattern) => void): void {
        visitor(this);
        this.ap.visitAccessPathPatterns(visitor);
    }
}

export class PotentiallyUnknownAccessPathPattern {

    constructor(readonly ap: AccessPathPattern) {}

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

    constructor(
        readonly minArgs: number | undefined,
        readonly maxArgs: number | undefined
    ) {
        super();
    }

    public toString(): string {
        return `[${this.minArgs !== undefined ? this.minArgs : ""},${this.maxArgs !== undefined ? this.maxArgs : ""}]`;
    }
}

export class TypeFilter extends Filter {

    constructor(
        readonly selector: FilterSelector,
        readonly types: Array<Type>
    ) {
        super();
        // TODO: type 'any' should only be used with access path selectors
    }

    public toString(): string {
        return `${this.selector}:${this.types.length === 1 ? this.types[0] : `{${this.types.join(",")}`}`;
    }
}

export class FilterSelector {

    constructor(
        readonly head: number | "base",
        readonly props: Array<string> | undefined
    ) {}

    public toString(): string {
        return `${this.head}${this.props ? `.${this.props.join(".")}` : ""}`;
    }
}

export type SimpleType = "undefined" | "boolean" | "string" | "number" | "array" | "empty-array" | "object" | "null" | "function" | "any";

export type ValueType = string | number | boolean;

export class Type {

    constructor(
        readonly simpleType: SimpleType | undefined, // 'any' only for access path selectors
        readonly functionArgs: number | undefined, // only for type "function"
        readonly valueType: ValueType | undefined,
        readonly tsType: string | undefined // TODO: assume disjoint from String(this.type)?
    ) {
        assert((simpleType !== undefined ? 1 : 0) + (valueType !== undefined ? 1 : 0) + (tsType !== undefined ? 1 : 0) === 1);
        assert(!functionArgs || simpleType === "function");
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
        return new Type(simpleType, functionArgs, undefined, undefined);
    }

    static makeValueType(valueType: ValueType): Type {
        return new Type(undefined, undefined, valueType, undefined);
    }

    static makeTSType(tsType: string): Type {
        return new Type(undefined, undefined, undefined, tsType);
    }
}
