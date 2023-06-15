import {isNode, Node} from "@babel/types";
import {Type} from "./patterns";
import {locationToStringWithFileAndEnd, Ternary, ternaryOr, ternaryToString} from "../misc/util";
import {followProps, getNumberOfFunctionParams, getSimpleType, getValueType} from "./astpatterns";
import {TypeScriptTypeInferrer} from "../typescript/typeinferrer";
import logger from "../misc/logger";

/**
 * Gets the type of the given node, returns undefined if uncertain.
 */
function getType(n: Node, typer: TypeScriptTypeInferrer | undefined): Type | undefined {
    let t1;
    const valueType = getValueType(n);
    if (valueType !== undefined)
        t1 = new Type(undefined, undefined, valueType, undefined);
    else {
        const simpleType = getSimpleType(n);
        if (simpleType !== undefined)
            t1 = new Type(simpleType, simpleType === "function" ? getNumberOfFunctionParams(n) : undefined, undefined, undefined);
    }
    const t2 = typer && n.loc ? typer.convertType(typer.getType(n.loc)) : undefined;
    if (t1) {
        if (t2) {
            if (logger.isDebugEnabled() && t1.toString() !== t2.toString() &&
                !(t1.simpleType === "function" && t2.simpleType === "function" && t1.functionArgs !== undefined && t2.functionArgs === undefined) && // TODO: ignoring info currently not supported by typeinferrer
                !(t1.simpleType === "empty-array" && t2.simpleType === "array"))
                logger.debug(`Inferred types differ at ${locationToStringWithFileAndEnd(n.loc)}: ${t1} <-> ${t2}`);
            const m12 = matches(t1, t2);
            const m21 = matches(t2, t1);
            if (m12 === Ternary.False || m21 === Ternary.False)
                logger.warn(`Warning: Incompatible types inferred at ${locationToStringWithFileAndEnd(n.loc)}: ${t1} <-> ${t2}`);
            else if (matches(t2, t1) === Ternary.True) {
                if (logger.isDebugEnabled() && t1.toString() !== t2.toString())
                    logger.debug(`Choosing TypeScript type ${t2} over ${t1}`);
                return t2;
            }
        } else if (typer)
            logger.warn(`Warning: No TypeScript type inferred for ${t1} at ${locationToStringWithFileAndEnd(n.loc)}`);
        return t1;
    } else {
        if (logger.isDebugEnabled() && t2 && (t2.simpleType !== undefined || t2.valueType !== undefined))
            logger.debug(`No pattern type inferred for ${t2} at ${locationToStringWithFileAndEnd(n.loc)}`);
        return t2;
    }
}

/**
 * Checks whether t1 matches t2.
 * Returns True if all t1 values are also t2 values, Maybe if some but not all t1 values are also t2 values, and False if no t1 values are t2 values.
 */
function matches(t1: Type, t2: Type): Ternary { // TODO: "function" and "array" are currently not treated as subtypes of "object"
    if (t2.simpleType === "any" ||
        (t1.simpleType !== undefined && t1.simpleType === t2.simpleType && (t1.simpleType !== "function" || t2.functionArgs === undefined || t1.functionArgs === t2.functionArgs)) ||
        (t1.valueType !== undefined && t1.valueType === t2.valueType) ||
        (t1.valueType !== undefined && typeof t1.valueType === t2.simpleType) ||
        (t1.simpleType === "empty-array" && t2.simpleType === "array") ||
        (t1.tsType !== undefined && t1.tsType === t2.tsType))
        return Ternary.True;
    if (t1.simpleType === "any" ||
        (t2.simpleType && t2.simpleType === t1.simpleType && (t2.simpleType !== "function" || t1.functionArgs === undefined || t2.functionArgs === t1.functionArgs)) ||
        (t2.valueType !== undefined && t2.valueType === t1.valueType) ||
        (t2.valueType !== undefined && typeof t2.valueType === t1.simpleType) ||
        (t2.simpleType === "empty-array" && t1.simpleType === "array") ||
        (t2.tsType !== undefined && (t1.tsType !== undefined || t1.simpleType === "object" || t1.simpleType === "array" || t1.simpleType === "function")))
        return Ternary.Maybe;
    return Ternary.False;
}

/**
 * Checks whether the given expression matches the given union type.
 */
export function expressionMatchesType(n: Node, props: Array<string> | undefined, ts: Array<Type>, typer: TypeScriptTypeInferrer | undefined): Ternary {
    const m = followProps(n, props);
    if (!isNode(m))
        return m;
    const mt = getType(m, typer);
    if (!mt)
        return Ternary.Maybe;
    let res = Ternary.False;
    for (const t of ts) {
        if (t.tsType && !typer)
            logger.error("Error: Pattern uses TypeScript type, but TypeScript type inference is not enabled (see option --typescript)");
        res = ternaryOr(res, matches(mt, t));
    }
    if (logger.isDebugEnabled())
        logger.debug(`expressionMatchesType node: ${locationToStringWithFileAndEnd(n.loc)}, type: ${ts.join(",")}, result: ${ternaryToString(res)}`);
    return res;
}
