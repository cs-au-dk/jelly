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
    Function,
    Identifier,
    ImportDefaultSpecifier,
    ImportSpecifier,
    isArrowFunctionExpression,
    isCallExpression,
    isClass,
    isClassMethod,
    isClassPrivateMethod,
    isClassPrivateProperty,
    isClassProperty,
    isExpressionStatement,
    isFunction,
    isFunctionExpression,
    isIdentifier,
    isImportSpecifier,
    isJSXMemberExpression,
    isMemberExpression,
    isNewExpression,
    isNumericLiteral,
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
import {Location, locationToStringWithFileAndEnd, nodeToString} from "./util";

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
export function getAdjustedCallNodePath(path: CallNodePath): NodePath { // XXX: remove with new dyn.ts?
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
        if (!(tokens && typeof keyStart === "number")) { // TODO: see test262-main/test and TypeScript-main/tests/cases
            f.error(`Unexpected key.start ${keyStart} at ${locationToStringWithFileAndEnd(path.node.loc)}`);
            return;
        }
        let lo = 0;
        for (let hi = tokens.length; lo < hi;) {
            const mid = (lo + hi) >>> 1;
            if (tokens[mid].start >= keyStart)
                hi = mid;
            else
                lo = mid + 1;
        }
        if (!(lo >= 1 && tokens[lo].start === keyStart && tokens[lo-1].type.label === "[")) { // TODO: see test262-main/test and TypeScript-main/tests/cases
            f.error(`Unexpected label ${tokens[lo - 1].type.label} at ${locationToStringWithFileAndEnd(path.node.loc)}`);
            return;
        }
        sl = tokens[lo-1].loc;
    }
    const m = (path.node.loc as Location).module;
    assert(m);
    f.registerArtificialFunction(m, sl);
}

/**
 * Returns the path for the enclosing function, or undefined if no such function.
 * Positions in default parameters belong to the function being defined.
 * Positions in computed function names belong to the enclosing function of the function being defined.
 * Positions in instance member initializers belong to the class constructor.
 */
function getEnclosingFunctionPath(path: NodePath): NodePath<Function> | null {
    let p: NodePath | null = path, c: Node | undefined = undefined, cc: Node | undefined = undefined;
    do {
        cc = c;
        c = p.node;
        p = p?.parentPath;
        if (p && isClass(p.node) && (isClassProperty(cc) || isClassPrivateProperty(cc)) && !cc.static) {
            for (const b of p.get("body.body") as Array<NodePath>)
                if (isClassMethod(b.node) && b.node.kind === "constructor")
                    return b as NodePath<ClassMethod>;
            assert.fail(`Constructor not found for class ${nodeToString(p.node)}`);
        }
    } while (p && (!isFunction(p.node) || ("id" in p.node && p.node.id === c) || ("key" in p.node && p.node.key === c)));
    return p as NodePath<Function> | null;
}

/**
 * Returns the enclosing non-arrow function, or undefined if no such function.
 */
export function getEnclosingNonArrowFunction(path: NodePath): Function | undefined {
    let p: NodePath | null = path;
    do {
        p = getEnclosingFunctionPath(p!);
    } while (p && isArrowFunctionExpression(p.node));
    return p?.node as Function | undefined;
}

/**
 * Returns the enclosing function, or undefined if no such function.
 */
export function getEnclosingFunction(path: NodePath): Function | undefined {
    return getEnclosingFunctionPath(path)?.node;
}
