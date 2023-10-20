import {Class, Function, isIdentifier, Node} from "@babel/types";
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

    getParent() {
        return this.obj instanceof AllocationSiteToken ? this.obj.allocSite :
            this.obj instanceof FunctionToken ? this.obj.fun :
                this.obj instanceof NativeObjectToken ? this.obj.moduleInfo :
                    this.obj.packageInfo;
    }
}

/**
 * A constraint variable for a function return.
 */
export class FunctionReturnVar extends ConstraintVar {

    constructor(readonly fun: Function) {
        super();
    }

    toString() {
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

    constructor(readonly fun: Function) {
        super();
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

    constructor(readonly cl: Class) {
        super();
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

    constructor(
        readonly node: Node,
        readonly label: string
    ) {
        super();
    }

    toString() {
        return `#${this.label}[${locationToStringWithFileAndEnd(this.node.loc, true)}]`
    }

    getParent(): Node {
        return this.node;
    }
}
