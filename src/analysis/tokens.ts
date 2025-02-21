import {Function, Node} from "@babel/types";
import {Location, locationToStringWithFileAndEnd} from "../misc/util";
import assert from "assert";
import {ModuleInfo, PackageInfo} from "./infos";
import {AccessPath} from "./accesspaths";
import {NativeFunctionAnalyzer} from "../natives/nativebuilder";

/**
 * Abstract value for constraint variables.
 */
export abstract class Token {

    hash: number | undefined; // set by canonicalizeToken

    abstract toString(): string
}

/**
 * Token that represents function objects.
 */
export class FunctionToken extends Token {

    constructor(readonly fun: Function) {
        super();
    }

    toString(): string {
        return `Function[${locationToStringWithFileAndEnd(this.fun.loc, true)}]`;
    }
}

/**
 * Object kinds, used by AllocationSiteToken and PackageObjectToken.
 *
 * Iterator represents an abstraction of Iterator, Iterable, IterableIterator and IteratorResult
 * (thus conflating the different kinds of objects).
 * It has a property 'value' holding the iterator values and a method 'next' that returns the abstract object itself.
 * Similarly, Generator represents both Generator and AsyncGenerator as a subclass of Iterator.
 *
 * PromiseResolve and PromiseReject represent the resolve and reject function arguments of promise executors,
 * using the same allocation site as the promise they belong to.
 *
 * Prototype represents prototype objects associated with functions.
 */
export type ObjectKind = "Object" | "Array" | "Class" | "Map" | "Set" | "WeakMap" | "WeakSet" | "WeakRef" | "Iterator" | "Generator" | "RegExp" | "Date" | "Promise" | "PromiseResolve" | "PromiseReject" | "Error" | "Prototype"; // XXX: "Class" only used if options.oldobj enabled

/**
 * Token that represents objects with a specific allocation site.
 */
export class AllocationSiteToken extends Token {

    constructor(
        readonly kind: ObjectKind,
        readonly allocSite: Node
    ) {
        super();
        assert(this instanceof ArrayToken || kind !== "Array", "AllocationSiteTokens of kind Array must be created using ArrayToken");
        assert(this instanceof ObjectToken || kind !== "Object", "AllocationSiteTokens of kind Object must be created using ObjectToken");
        assert(this instanceof PrototypeToken || kind !== "Prototype", "AllocationSiteTokens of kind Prototype must be created using PrototypeToken");
    }

    toString(): string {
        return `${this.kind}[${locationToStringWithFileAndEnd(this.allocSite.loc, true)}]`;
    }
}

/**
 * Token that represents ordinary objects with a specific allocation site.
 */
export class ObjectToken extends AllocationSiteToken {

    constructor(allocSite: Node) {
        super("Object", allocSite);
    }

    getPackageInfo(): PackageInfo {
        const loc = this.allocSite.loc as Location;
        assert(loc && loc.module);
        return loc.module.packageInfo;
    }
}

/**
 * Token that represents prototype objects associated with a function.
 */
export class PrototypeToken extends AllocationSiteToken {

    constructor(allocSite: Node) {
        super("Prototype", allocSite);
    }
}

/**
 * Token that represents arrays with a specific allocation site.
 */
export class ArrayToken extends AllocationSiteToken {

    constructor(allocSite: Node) {
        super("Array", allocSite);
    }
}

/**
 * Token that represents classes with a specific allocation site.
 */
export class ClassToken extends AllocationSiteToken { // XXX: only used if options.oldobj enabled

    constructor(allocSite: Node) {
        super("Class", allocSite);
    }
}

/**
 * Token that represents a native object.
 */
export class NativeObjectToken extends Token {

    constructor(
        readonly name: string,
        readonly moduleInfo?: ModuleInfo,
        readonly invoke?: NativeFunctionAnalyzer,
        readonly constr: boolean = false
    ) {
        super();
    }

    toString(): string {
        return `%${this.name}${this.moduleInfo ? `[${this.moduleInfo}]` : ""}`;
    }
}

/**
 * Token that represents unknown values belonging to a specific package.
 */
export class PackageObjectToken extends Token {

    constructor(
        readonly packageInfo: PackageInfo,
        readonly kind: ObjectKind = "Object"
    ) {
        super();
    }

    toString(): string {
        return `*${this.kind === "Object" ? "" : `(${this.kind})`}[${this.packageInfo}]`;
    }
}

/**
 * Token that describes values that come from non-analyzed code (either libraries or clients).
 * In vulnerability pattern matching mode, access path tokens are used for values from tracked modules.
 */
export class AccessPathToken extends Token {

    constructor(readonly ap: AccessPath) {
        super();
    }

    toString(): string {
        return `@${this.ap}`;
    }
}
