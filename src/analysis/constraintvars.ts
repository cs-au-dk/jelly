import {Function, isIdentifier, Node} from "@babel/types";
import {nodeToString, locationToStringWithFileAndEnd} from "../misc/util";
import {
    AccessPathToken,
    AllocationSiteToken,
    ArrayToken,
    FunctionToken,
    NativeObjectToken,
    PackageObjectToken,
    Token,
} from "./tokens";
import {ModuleInfo, PackageInfo} from "./infos";
import {IDENTIFIER_KIND} from "./astvisitor";
import Solver from "./solver";
import assert from "assert";

function getTokenParent(obj: Token): Node | PackageInfo | ModuleInfo | undefined {
    if (obj instanceof AllocationSiteToken)
        return obj.allocSite;
    else if (obj instanceof FunctionToken)
        return obj.fun;
    else if (obj instanceof NativeObjectToken)
        return obj.moduleInfo;
    else if (obj instanceof PackageObjectToken)
        return obj.packageInfo;
    else {
        assert(obj instanceof AccessPathToken);
        return undefined;
    }
}

/**
 * A constraint variable.
 */
export abstract class ConstraintVar {

    abstract toString(): string

    /**
     * Finds the AST node, function, module or package this constraint variable belongs to.
     */
    abstract getParent(): Node | PackageInfo | ModuleInfo | undefined

    /**
     * Returns the kind of the constraint variable.
     * Assumes options.variableKinds is set.
     */
    getKind(): string {
        return this.constructor.name;
    }
}

/**
 * A constraint variable for an AST node.
 */
export class NodeVar extends ConstraintVar {

    constructor(readonly node: Node) {
        super();
    }

    toString(): string {
        return nodeToString(this.node);
    }

    getParent(): Node {
        return this.node;
    }

    getKind(): string {
        return isIdentifier(this.node) ? `Identifier[${(this.node as any)[IDENTIFIER_KIND]}]` : this.node.type;
    }
}

/**
 * Kind of ObjectPropertyVar.
 */
export type AccessorType = "get" | "set" | "normal";

export type ObjectPropertyVarObj = AllocationSiteToken | FunctionToken | NativeObjectToken | PackageObjectToken;

export function isObjectPropertyVarObj(t: Token): t is ObjectPropertyVarObj {
    return !(t instanceof AccessPathToken);
}

/**
 * A constraint variable for an object property.
 */
export class ObjectPropertyVar extends ConstraintVar {

    private constructor(
        readonly obj: ObjectPropertyVarObj,
        readonly prop: string,
        readonly accessor: AccessorType,
    ) {
        super();
    }

    /*
     * Factory method for creation of ObjectPropertyVars.
     * The (obj, prop) pair is registered on the provided solver instance and listener calls may be enqueued.
     */
    static make(solver: Solver, obj: ObjectPropertyVarObj, prop: string, accessor: AccessorType = "normal"): ObjectPropertyVar {
        solver.addObjectProperty(obj, prop);
        if (obj instanceof ArrayToken)
            solver.addArrayEntry(obj, prop);
        return new ObjectPropertyVar(obj, prop, accessor);
    }

    toString(): string {
        return `${this.accessor === "get" ? "(get)" : this.accessor === "set" ? "(set)" : ""}${this.obj}.${this.prop}`;
    }

    getParent(): Node | PackageInfo | ModuleInfo | undefined {
        return getTokenParent(this.obj);
    }
}

/**
 * A constraint variable for a function return.
 */
export class FunctionReturnVar extends ConstraintVar {

    constructor(readonly fun: Function) {
        super();
    }

    toString(): string {
        return `Return[${locationToStringWithFileAndEnd(this.fun.loc, true)}]`;
    }

    getParent(): Node {
        return this.fun;
    }
}

/**
 * A constraint variable for 'this'.
 */
export class ThisVar extends ConstraintVar {

    constructor(readonly fun: Function) {
        super();
    }

    toString(): string {
        return `This[${locationToStringWithFileAndEnd(this.fun.loc, true)}]`;
    }

    getParent(): Node {
        return this.fun;
    }
}

/**
 * A constraint variable for 'arguments'.
 */
export class ArgumentsVar extends ConstraintVar {

    constructor(readonly fun: Function) {
        super();
    }

    toString(): string {
        return `Arguments[${locationToStringWithFileAndEnd(this.fun.loc, true)}]`;
    }

    getParent(): Node {
        return this.fun;
    }
}

/**
 * A constraint variable for an intermediate result.
 */
export class IntermediateVar extends ConstraintVar {

    constructor(
        readonly node: Node,
        readonly label: string
    ) {
        super();
    }

    toString(): string {
        return `#${this.label}[${locationToStringWithFileAndEnd(this.node.loc, true)}]`;
    }

    getParent(): Node {
        return this.node;
    }
}

/**
 * A constraint variable for the ancestors in the prototype chain of a token.
 */
export class AncestorsVar extends ConstraintVar {

    constructor(readonly t: ObjectPropertyVarObj) {
        super();
    }

    toString(): string {
        return `Ancestors(${this.t})`;
    }

    getParent(): Node | PackageInfo | ModuleInfo | undefined {
        return getTokenParent(this.t);
    }
}

/**
 * A constraint variable for caching the result of a property read operation
 * that follows the prototype chain.
 */
export class ReadResultVar extends ConstraintVar {

    constructor(
        readonly t: ObjectPropertyVarObj,
        readonly prop: string,
    ) {
        super();
    }

    toString(): string {
        return `ReadResult[${this.t}.${this.prop}]`;
    }

    getParent(): Node | PackageInfo | ModuleInfo | undefined {
        return getTokenParent(this.t);
    }
}
