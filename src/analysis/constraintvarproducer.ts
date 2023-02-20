import {
    Class,
    Expression,
    Function,
    identifier,
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
    isSuper,
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
    ArgumentsVar,
    ArrayValueVar,
    ClassExtendsVar,
    ConstraintVar,
    FunctionReturnVar,
    IntermediateVar,
    NodeVar,
    ObjectPropertyVar,
    ObjectPropertyVarObj,
    ThisVar
} from "./constraintvars";
import logger from "../misc/logger";
import {ArrayToken, ObjectToken, PackageObjectToken} from "./tokens";
import {FilePath, sourceLocationToStringWithFile} from "../misc/util";
import {PackageInfo} from "./infos";
import {AnalysisState, globalLoc, undefinedIdentifier} from "./analysisstate";
import {getClass} from "../misc/asthelpers";

export class ConstraintVarProducer {

    private readonly a: AnalysisState

    constructor(a: AnalysisState) {
        this.a = a;
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
            if (id instanceof NodeVar && id.node === undefinedIdentifier)
                return undefined;
            return id;
        } else if (isNumericLiteral(exp) || isBigIntLiteral(exp) || isNullLiteral(exp) || isBooleanLiteral(exp) ||
            isStringLiteral(exp) || // note: currently skipping string literals
            isUnaryExpression(exp) || isBinaryExpression(exp) || isUpdateExpression(exp))
            return undefined; // those expressions never evaluate to functions or objects and can safely be skipped
        else if (isSuper(exp)) {
            const cl = getClass(path);
            if (!cl) {
                this.a.warnUnsupported(exp, `Ignoring super in object expression at ${sourceLocationToStringWithFile(exp.loc)}`, true); // TODO: object expressions may have prototypes, e.g. __proto__
                return undefined;
            }
            return this.extendsVar(cl);
        }
        return this.a.varProducer.nodeVar(exp); // other expressions are already canonical
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
                const fun = this.a.registerArguments(path);
                return fun ? this.a.canonicalizeVar(new ArgumentsVar(fun)) : this.a.varProducer.nodeVar(id); // using the identifier itself as fallback if no enclosing function
            } else {
                const ps = path.scope.getProgramParent();
                d = ps.getBinding(id.name)?.identifier;
                if (!d) {
                    d = identifier(id.name);
                    d.loc = globalLoc;
                    ps.push({id: d});
                    if (logger.isDebugEnabled())
                        logger.debug(`No binding for identifier ${id.name}, creating one in program scope`);
                } else if (logger.isDebugEnabled())
                    logger.debug(`No binding for identifier ${id.name}, using the one in program scope`);
            }
        }
        return this.a.varProducer.nodeVar(d); // Identifiers are already canonical
    }

    /**
     * Finds the constraint variable for a named object property.
     */
    objPropVar(obj: ObjectPropertyVarObj, prop: string, accessor: AccessorType = "normal"): ObjectPropertyVar {
        if (obj instanceof ObjectToken && this.a.widened.has(obj))
            return this.packagePropVar(obj.packageInfo, prop, accessor);
        return this.a.canonicalizeVar(new ObjectPropertyVar(obj, prop, accessor));
    }

    /**
     * Finds the constraint variable for an array value.
     */
    arrayValueVar(arr: ArrayToken): ArrayValueVar {
        return this.a.canonicalizeVar(new ArrayValueVar(arr));
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
     * Finds the constraint variable representing the super-class of the given class.
     */
    extendsVar(cl: Class): ClassExtendsVar {
        return this.a.canonicalizeVar(new ClassExtendsVar(cl));
    }

    /**
     * Finds the constraint variable representing 'this' for the given function.
     */
    thisVar(fun: Function): ThisVar {
        return this.a.canonicalizeVar(new ThisVar(fun));
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
    nodeVar(n: Node | undefined): NodeVar | undefined
    nodeVar(n: Node | undefined): NodeVar | undefined {
        return n !== undefined ? this.a.canonicalizeVar(new NodeVar(n)) : undefined;
    }
}