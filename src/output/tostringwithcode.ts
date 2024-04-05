import {ArgumentsVar, ConstraintVar, FunctionReturnVar, IntermediateVar, NodeVar, ObjectPropertyVar, ThisVar} from "../analysis/constraintvars";
import {codeFromLocation} from "../misc/files";
import {SourceLocation} from "@babel/types";
import {AllocationSiteToken, FunctionToken, Token} from "../analysis/tokens";
import {FunctionInfo} from "../analysis/infos";

/**
 * Returns a string description of the given function, with a code snippet.
 */
export function funcToStringWithCode(info: FunctionInfo): string {
    return `'${codeFromLocation(info.loc)}'${info}`;
}

/**
 * Extracts the source location from a token, or returns undefined if the token doesn't have a source location.
 */
export function getTokenLocation(token: Token): SourceLocation | undefined {
    if (token instanceof FunctionToken) {
        if (token.fun.loc)
            return token.fun.loc;
    } else if (token instanceof AllocationSiteToken) {
        if (token.allocSite.loc)
            return token.allocSite.loc;
    }
    return undefined;
}

/**
 * Returns a string description of the given constraint variable, with a code snippet if it has a source location.
 */
export function constraintVarToStringWithCode(v: ConstraintVar): string {
    if (v instanceof NodeVar || v instanceof IntermediateVar) {
        if (v.toString().startsWith("'"))
            return v.toString();
        return `'${codeFromLocation(v.node.loc)}'${v.toString()}`;
    } else if (v instanceof ObjectPropertyVar)
        return `${v.toString()}${codeFromLocation(getTokenLocation(v.obj)) === "-" ? "" : ` (Object is "${codeFromLocation(getTokenLocation(v.obj))}")`}`;
    else if (v instanceof ArgumentsVar || v instanceof FunctionReturnVar || v instanceof ThisVar)
        return `${v.toString()}${codeFromLocation(v.fun.loc) === "-" ? "" : ` (Function is "${codeFromLocation(v.fun.loc)}")`}`;
    else
        return v.toString();
}
