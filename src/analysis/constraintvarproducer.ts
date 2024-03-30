import {
    Expression,
    Function,
    Identifier,
    isBigIntLiteral,
    isBinaryExpression,
    isBooleanLiteral,
    isIdentifier,
    isJSXIdentifier,
    isNullLiteral,
    isNumericLiteral,
    isParenthesizedExpression,
    isStringLiteral,
    isUnaryExpression,
    isUpdateExpression,
    JSXIdentifier,
    JSXMemberExpression,
    JSXNamespacedName,
    Node
} from "@babel/types";
import {NodePath} from "@babel/traverse";
import {
    AccessorType,
    AncestorsVar,
    ArgumentsVar,
    ConstraintVar,
    FunctionReturnVar,
    IntermediateVar,
    NodeVar,
    ObjectPropertyVar,
    ObjectPropertyVarObj,
    ReadResultVar,
    ThisVar
} from "./constraintvars";
import {ArrayToken, ObjectToken, PackageObjectToken} from "./tokens";
import {FilePath, Location} from "../misc/util";
import {PackageInfo} from "./infos";
import {GlobalState} from "./globalstate";
import {FragmentState, MergeRepresentativeVar, RepresentativeVar} from "./fragmentstate";
import assert from "assert";
import Solver from "./solver";
import {ARRAY_ALL, ARRAY_UNKNOWN} from "../natives/ecmascript";
import {options} from "../options";

export class ConstraintVarProducer<RVT extends RepresentativeVar | MergeRepresentativeVar = RepresentativeVar> {

    private readonly a: GlobalState;

    constructor(
        private readonly s: Solver,
        private readonly f: FragmentState<RVT>,
    ) {
        this.a = f.a;
    }

    /**
     * Finds the constraint variable for the given expression in the current module.
     * For parenthesized expressions, the inner expression is used.
     * If the expression definitely cannot evaluate to a function value, undefined is returned.
     * For Identifier expressions, the declaration node is used as constraint variable;
     * For Super expressions, a ClassExtendsVar is used.
     * For other expressions, the expression itself is used.
     */
    expVar(exp: Expression | JSXIdentifier | JSXMemberExpression | JSXNamespacedName, path: NodePath): ConstraintVar | undefined {
        while (isParenthesizedExpression(exp))
            exp = exp.expression; // for parenthesized expressions, use the inner expression
        if (isIdentifier(exp) || isJSXIdentifier(exp)) {
            const id = this.identVar(exp, path);
            if (id instanceof NodeVar && exp.name === "undefined" && (id.node?.loc as Location)?.native === "%ecmascript")
                return undefined;
            return id;
        } else if (isNumericLiteral(exp) || isBigIntLiteral(exp) || isNullLiteral(exp) || isBooleanLiteral(exp) ||
            isStringLiteral(exp) || // note: currently skipping string literals
            isUnaryExpression(exp) || isBinaryExpression(exp) || isUpdateExpression(exp))
            return undefined; // those expressions never evaluate to functions or objects and can safely be skipped
        return this.nodeVar(exp); // other expressions are already canonical
    }

    /**
     * Finds the constraint variable for the given identifier in the current module.
     * If not found, it is added to the program scope (except for 'arguments').
     */
    identVar(id: Identifier | JSXIdentifier, path: NodePath): ConstraintVar {
        const binding = path.scope.getBinding(id.name);
        let d;
        if (binding) {
            d = binding.identifier;
        } else {
            if (id.name === "arguments") {
                const fun = this.f.registerArguments(path);
                return fun ? this.argumentsVar(fun) : this.nodeVar(id); // using the identifier itself as fallback if no enclosing function
            } else {
                const ps = path.scope.getProgramParent();
                d = ps.getBinding(id.name)?.identifier;
                if (!d)
                    assert.fail(`No binding for identifier ${id.name}, should be set by preprocessAst`);
            }
        }
        return this.nodeVar(d);
    }

    /**
     * Finds the constraint variable for a named object property.
     * The (obj, prop) pair is registered on the provided solver instance and listener calls may be enqueued.
     */
    objPropVar(obj: ObjectPropertyVarObj, prop: string, accessor: AccessorType = "normal"): ObjectPropertyVar {
        if (options.widening && obj instanceof ObjectToken && this.f.widened.has(obj))
            return this.packagePropVar(obj.getPackageInfo(), prop, accessor);
        return this.a.canonicalizeVar(ObjectPropertyVar.make(this.s, obj, prop, accessor));
    }

    /**
     * Finds the constraint variable for the array's unknown entries.
     */
    arrayUnknownVar(arr: ArrayToken): ObjectPropertyVar {
        return this.objPropVar(arr, ARRAY_UNKNOWN);
    }

    /**
     * Finds the summary constraint variable for the array.
     * This variable contains the union of tokens in the array's known and unknown entries.
     */
    arrayAllVar(arr: ArrayToken): ObjectPropertyVar {
        return this.objPropVar(arr, ARRAY_ALL);
    }

    /**
     * Finds the constraint variable for an object property for a package.
     */
    packagePropVar(pck: FilePath | PackageInfo, prop: string, accessor: AccessorType = "normal"): ObjectPropertyVar {
        return this.objPropVar(this.a.canonicalizeToken(new PackageObjectToken(pck instanceof PackageInfo ? pck : this.a.getModuleInfo(pck).packageInfo)), prop, accessor);
    }

    /**
     * Finds the constraint variable representing the return values of the given function.
     */
    returnVar(fun: Function): FunctionReturnVar {
        return this.a.canonicalizeVar(new FunctionReturnVar(fun));
    }

    /**
     * Finds the constraint variable representing 'this' for the given function.
     */
    thisVar(fun: Function): ThisVar {
        return this.a.canonicalizeVar(new ThisVar(fun));
    }

    /**
     * Finds the constraint variable representing 'arguments' for the given function.
     */
    argumentsVar(fun: Function): ArgumentsVar {
        return this.a.canonicalizeVar(new ArgumentsVar(fun));
    }

    /**
     * Finds the constraint variable representing the given intermediate result.
     */
    intermediateVar(n: Node, label: string): IntermediateVar {
        return this.a.canonicalizeVar(new IntermediateVar(n, label));
    }

    /**
     * Finds the constraint variable representing the given AST node (or undefined).
     */
    nodeVar(n: Node): NodeVar
    nodeVar(n: Node | undefined): NodeVar | undefined {
        return n !== undefined ? this.a.canonicalizeVar(new NodeVar(n)) : undefined;
    }

    ancestorsVar(t: ObjectPropertyVarObj): AncestorsVar {
        if (options.widening && t instanceof ObjectToken && this.f.widened.has(t))
            t = this.a.canonicalizeToken(new PackageObjectToken(t.getPackageInfo()));
        return this.a.canonicalizeVar(new AncestorsVar(t));
    }

    readResultVar(t: ObjectPropertyVarObj, prop: string): ReadResultVar {
        if (options.widening && t instanceof ObjectToken && this.f.widened.has(t))
            t = this.a.canonicalizeToken(new PackageObjectToken(t.getPackageInfo()));
        return this.a.canonicalizeVar(new ReadResultVar(t, prop));
    }
}
