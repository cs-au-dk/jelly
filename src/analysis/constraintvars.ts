import {Class, Function, isIdentifier, Node} from "@babel/types";
import {nodeToString, locationToStringWithFileAndEnd} from "../misc/util";
import {
    AllocationSiteToken,
    ArrayToken,
    FunctionToken,
    NativeObjectToken,
    PackageObjectToken,
    Token,
} from "./tokens";
import {ModuleInfo, PackageInfo} from "./infos";
import {IDENTIFIER_KIND} from "./astvisitor";

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

    readonly node: Node;

    constructor(node: Node) {
        super();
        this.node = node;
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

export function isObjectProperyVarObj(t: Token | undefined): t is ObjectPropertyVarObj {
    return t instanceof AllocationSiteToken || t instanceof FunctionToken || t instanceof PackageObjectToken || t instanceof NativeObjectToken;
}

/**
 * A constraint variable for an object property.
 */
export class ObjectPropertyVar extends ConstraintVar {

    readonly obj: ObjectPropertyVarObj;

    readonly prop: string

    readonly accessor: AccessorType;

    constructor(obj: ObjectPropertyVarObj, prop: string, accessor: AccessorType = "normal") {
        super();
        this.prop = prop;
        this.obj = obj;
        this.accessor = accessor;
    }

    toString(): string {
        return `${this.accessor === "get" ? "(get)" : this.accessor === "set" ? "(set)" : ""}${this.obj}.${this.prop}`;
    }

    getParent() {
        return this.obj instanceof AllocationSiteToken ? this.obj.allocSite :
            this.obj instanceof FunctionToken ? this.obj.fun :
                this.obj instanceof NativeObjectToken ? this.obj.moduleInfo :
                    this.obj.packageInfo;
    }
}

/**
 * A constraint variable for an unknown array entry.
 */
export class ArrayValueVar extends ConstraintVar {

    readonly array: ArrayToken;

    constructor(array: ArrayToken) {
        super();
        this.array = array;
    }

    toString(): string {
        return `${this.array}.*`;
    }

    getParent(): Node {
        return this.array.allocSite;
    }
}

/**
 * A constraint variable for a function return.
 */
export class FunctionReturnVar extends ConstraintVar {

    readonly fun: Function;

    constructor(fun: Function) {
        super();
        this.fun = fun;
    }

    toString() {
        return `Return[${locationToStringWithFileAndEnd(this.fun.loc, true)}]`
    }

    getParent(): Node {
        return this.fun;
    }
}

/**
 * A constraint variable for 'this'.
 */
export class ThisVar extends ConstraintVar {

    readonly fun: Function;

    constructor(fun: Function) {
        super();
        this.fun = fun;
    }

    toString() {
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

    readonly fun: Function;

    constructor(fun: Function) {
        super();
        this.fun = fun;
    }

    toString() {
        return `Arguments[${locationToStringWithFileAndEnd(this.fun.loc, true)}]`;
    }

    getParent(): Node {
        return this.fun;
    }
}

/**
 * A constraint variable for the super-class of a class.
 */
export class ClassExtendsVar extends ConstraintVar {

    readonly cl: Class;

    constructor(cl: Class) {
        super();
        this.cl = cl;
    }

    toString() {
        return `Extends[${locationToStringWithFileAndEnd(this.cl.loc, true)}]`
    }

    getParent(): Node {
        return this.cl;
    }
}

/**
 * A constraint variable for an intermediate result.
 */
export class IntermediateVar extends ConstraintVar {

    readonly node: Node;

    readonly label: string;

    constructor(node: Node, label: string) {
        super();
        this.node = node;
        this.label = label;
    }

    toString() {
        return `#${this.label}[${locationToStringWithFileAndEnd(this.node.loc, true)}]`
    }

    getParent(): Node {
        return this.node;
    }
}
