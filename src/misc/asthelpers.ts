import {BabelFile} from "@babel/core";
import {NodePath} from "@babel/traverse";
import {
    CallExpression,
    Class,
    ClassAccessorProperty,
    ClassMethod,
    ClassPrivateMethod,
    ClassPrivateProperty,
    ClassProperty,
    Expression,
    Identifier,
    ImportDefaultSpecifier,
    ImportSpecifier,
    isCallExpression,
    isClassPrivateMethod,
    isClassPrivateProperty,
    isExpression,
    isExpressionStatement,
    isFunctionExpression,
    isIdentifier,
    isImportSpecifier,
    isJSXMemberExpression,
    isMemberExpression,
    isNewExpression,
    isNumericLiteral,
    isOptionalMemberExpression,
    isParenthesizedExpression,
    isPrivateName,
    isStringLiteral,
    JSXMemberExpression,
    MemberExpression,
    NewExpression,
    Node,
    ObjectMethod,
    ObjectProperty,
    OptionalCallExpression,
    OptionalMemberExpression,
    Property,
    SourceLocation,
    StringLiteral,
} from "@babel/types";
import assert from "assert";
import {CallNodePath} from "../natives/nativebuilder";
import {FragmentState} from "../analysis/fragmentstate";
import {Location} from "./util";

export type CallNode = CallExpression | OptionalCallExpression | NewExpression;

/**
 * Finds the property name of a property access, returns undefined if dynamic and not literal string or number.
 * (See also getKey below.)
 */
export function getProperty(node: MemberExpression | OptionalMemberExpression | JSXMemberExpression): string | undefined {
    if (isJSXMemberExpression(node))
        return node.property.name;
    else if (isIdentifier(node.property) && !node.computed)
        return node.property.name;
    else if (isStringLiteral(node.property))
        return node.property.value;
    else if (isNumericLiteral(node.property))
        return node.property.value.toString();
    else if (isPrivateName(node.property))
        return `#${node.property.id.name}`;
    return undefined;
}

/**
 * Finds the property name of an object/class property/method definition, returns undefined if dynamic and not literal string or number.
 * (See also getProperty above.)
 */
export function getKey(node: ObjectProperty | ClassProperty | ClassAccessorProperty | ClassPrivateProperty | ObjectMethod | ClassMethod | ClassPrivateMethod): string | undefined {
    if (isClassPrivateProperty(node) || isClassPrivateMethod(node))
        return `#${node.key.id.name}`;
    else if (isIdentifier(node.key) && !node.computed)
        return node.key.name;
    else if (isStringLiteral(node.key))
        return node.key.value;
    else if (isNumericLiteral(node.key))
        return node.key.value.toString();
    return undefined;
}

/**
 * Checks whether the parent node (possibly in parentheses) is an expression statement.
 */
export function isParentExpressionStatement(path: NodePath): boolean { // TODO: also include nodes that are non-last in expression sequences?
    let p: NodePath | null = path;
    do {
        p = p.parentPath;
    } while (p && isParenthesizedExpression(p.node));
    return p !== null && isExpressionStatement(p.node);
}

function isCallNodePath(path: NodePath, opts?: object): path is CallNodePath {
    return path.isCallExpression(opts) || path.isOptionalCallExpression(opts) || path.isNewExpression(opts);
}

export function isCalleeExpression(path: NodePath): boolean {
    const parent = path.parentPath;
    if (parent?.isParenthesizedExpression())
        return isCalleeExpression(parent);
    return parent !== null && isCallNodePath(parent, {callee: path.node});
}

/**
 * Returns the base expression and property of the given method call, or undefined if not applicable.
 */
export function getBaseAndProperty(path: CallNodePath): {base: Expression, property: string | undefined} | undefined {
    let p: NodePath | null = path.get("callee") as NodePath;
    while (isParenthesizedExpression(p.node))
        p = p.get("expression") as NodePath;
    if (!(isMemberExpression(p.node) || isOptionalMemberExpression(p.node)))
        return undefined;
    const base = p.node.object;
    if (!isExpression(base)) // excluding Super
        return undefined;
    const property = getProperty(p.node);
    return {base, property};
}

/**
 * Finds the exported property name for an export specifier.
 */
export function getExportName(exported: Identifier | StringLiteral): string {
    return isIdentifier(exported) ? exported.name : exported.value;
}

/**
 * Finds the imported property name for an import specifier.
 */
export function getImportName(imp: ImportSpecifier | ImportDefaultSpecifier): string {
    return isImportSpecifier(imp) ? isIdentifier(imp.imported) ? imp.imported.name : imp.imported.value : "default";
}

/**
 * Finds the enclosing ClassDeclaration or ClassExpression of the given node path.
 */
export function getClass(path: NodePath<any>): Class | undefined {
    return (path.find((p) => p.isClass()) as NodePath<Class>)?.node;
}

/**
 * Returns an adjusted call node path that matches source locations reported
 * for calls by the dynamic analysis, which has wrong source locations for calls
 * in certain parenthesized expressions.
 */
export function getAdjustedCallNodePath(path: CallNodePath): NodePath {
    return isParenthesizedExpression(path.parentPath.node) &&
    (isNewExpression(path.node) ||
        (!isParenthesizedExpression(path.node.callee) && !isFunctionExpression(path.node.callee))) ?
        path.parentPath : path;
}

/**
 * Returns true if the given node may be used as a Promise.
 * If the node is a callee in a call node or the receiver in a property read that is not 'then' or 'catch',
 * then false is returned, and otherwise true.
 * From tapir.ts.
 */
export function isMaybeUsedAsPromise(path: NodePath<CallNode>): boolean {
    return !isExpressionStatement(path.node) &&
        // The call is definitely not used as a Promise if the node is a callee in a call node
        !(isCallExpression(path.parent) && path.parent.callee === path.node) &&
        // The call is definitely not used as a Promise if the receiver in a property read that is not then or catch
        !(isMemberExpression(path.parent) &&
            isIdentifier(path.parent.property) &&
            !['then', 'catch'].includes(path.parent.property.name));
}

/**
 * Returns true if the given node occurs in a try block or branch.
 */
export function isInTryBlockOrBranch(path: NodePath): boolean {
    let p: NodePath | null = path;
    do {
        p = p.parentPath;
        if (p) {
            if (p.isFunction())
                return false;
            if (p.isTryStatement() || p.isIfStatement() || p.isSwitchCase() || p.isConditionalExpression())
                return true;
        }
    } while (p);
    return false;
}

export function registerArtificialClassPropertyInitializer(f: FragmentState, path: NodePath<Property>) {
    if (!path.isClassProperty() && !path.isClassPrivateProperty())
        return;

    // dyn.ts treats class property initializers as functions
    let sl: Node["loc"];
    if (path.isClassPrivateProperty() || !path.node.computed)
        sl = path.node.key.loc;
    else if (!path.node.static)
        sl = path.node.loc;
    else {
        // static & computed class property
        // find the location of the bracket between the static keyword and the key
        const tokens = (path.hub as unknown as {file: BabelFile}).
            file.ast.tokens as Array<{start: number, loc: SourceLocation, type: any}>;
        const keyStart = path.node.key.start;
        assert(tokens && typeof keyStart === "number");
        let lo = 0;
        for (let hi = tokens.length; lo < hi;) {
            const mid = (lo + hi) >>> 1;
            if (tokens[mid].start >= keyStart)
                hi = mid;
            else
                lo = mid + 1;
        }
        assert(lo >= 1 && tokens[lo].start === keyStart && tokens[lo-1].type.label === "[");
        sl = tokens[lo-1].loc;
    }
    const m = (path.node.loc as Location).module;
    assert(m);
    f.registerArtificialFunction(m, sl);
}
