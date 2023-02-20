import {SimpleType, ValueType} from "./patterns";
import {Ternary} from "../misc/util";
import {
    isArrayExpression,
    isArrowFunctionExpression,
    isBooleanLiteral,
    isFunctionExpression,
    isIdentifier,
    isImportDeclaration,
    isImportDefaultSpecifier,
    isNullLiteral,
    isNumericLiteral,
    isObjectExpression,
    isObjectMethod,
    isObjectProperty,
    isStringLiteral,
    isTemplateLiteral,
    isUnaryExpression,
    Node
} from "@babel/types";
import {getKey} from "../misc/asthelpers";

/**
 * Returns true of the given node is an import declaration that contains a default import specifier.
 */
export function isDefaultImport(n: Node): boolean {
    if (!isImportDeclaration(n))
        return false;
    for (const spec of n.specifiers)
        if (isImportDefaultSpecifier(spec))
            return true;
    return false;
}

/**
 * Gets the simple type of the given node, returns undefined if not a simple type or uncertain.
 */
export function getSimpleType(n: Node): SimpleType | undefined { // TODO: like TAPIR, if the node is an identifier and it has exactly one definition, use that definition (same for getValueType below) - or even better, use proper flow analysis!
    if (isIdentifier(n) && n.name === "undefined") // TODO: use the artificial declaration of 'undefined' instead?
        return "undefined";
    if (isBooleanLiteral(n) || (isUnaryExpression(n) && n.operator === "!"))
        return "boolean";
    if (isStringLiteral(n) || isTemplateLiteral(n))
        return "string";
    if (isNumericLiteral(n))
        return "number";
    if (isArrayExpression(n)) {
        if (n.elements.length === 0)
            return "empty-array";
        return "array";
    }
    if (isObjectExpression(n))
        return "object";
    if (isNullLiteral(n))
        return "null";
    if (isFunctionExpression(n) || isArrowFunctionExpression(n) || isObjectMethod(n))
        return "function";
    return undefined;
}

/**
 * Gets the value type of the given node, returns undefined if not a value type or uncertain.
 */
export function getValueType(n: Node): ValueType | undefined {
    if (isStringLiteral(n) || isNumericLiteral(n) || isBooleanLiteral((n)))
        return n.value;
    return undefined;
}

/**
 * Gets the number of function parameters, returns undefined if not a function or uncertain.
 */
export function getNumberOfFunctionParams(n: Node): number | undefined {
    if (!isFunctionExpression(n) && !isArrowFunctionExpression(n) && !isObjectMethod(n))
        return undefined;
    let plain = true;
    for (const p of n.params)
        if (!isIdentifier(p)) {
            plain = false;
            break;
        }
    if (!plain)
        return undefined;
    return n.params.length;
}

/**
 * Attempts to follow the given property access path for object expressions.
 * Returns Maybe if uncertain and False if the access path definitely doesn't exist.
 */
export function followProps(n: Node, props: Array<string> | undefined): Node | Ternary {
    if (!props)
        return n;
    let m = n;
    for (const prop of props) {
        if (isObjectExpression(m)) {
            let found = false;
            for (const p of m.properties)
                if (isObjectProperty(p) || isObjectMethod(p)) {
                    const key = getKey(p);
                    if (key !== undefined) {
                        if (key === prop) {
                            found = true;
                            m = isObjectProperty(p) ? p.value : p;
                        }
                    } else
                        return Ternary.Maybe;
                } else
                    return Ternary.Maybe;
            if (!found)
                return Ternary.False;
        } else
            return Ternary.Maybe;
    }
    return m;
}
