import {FilePath, LocationJSON} from "../misc/util";

export type RequestType = {

    // file path
    file: FilePath
}

export type ResponseType = {

    // hints
    hints: HintsJSON,

    // number of force-executed functions
    numForced: number,

    // number of force-executed functions with uncaught exceptions
    numForcedExceptions: number,

    // true if uncaught exceptions at execution of the module top-level code
    moduleException: boolean,

    // number of functions transformed for dynamically generated/loaded code
    numStaticFunctions: number,

    // map from module name to static requires in the module
    staticRequires: Array<[string, string]>,

    // total code size (excluding dynamically generated code)
    totalCodeSize: number
}

/**
 * Format of the JSON data produced by the dynamic analysis.
 */
export type HintsJSON = {

    // modules used in LocationJSON strings (manager uses logical module names, approx uses file paths, both may have ":eval[...]" blocks)
    modules: Array<string>,

    // functions visited
    functions: Array<LocationJSON>,

    // read hints
    reads: Array<ReadHint>,

    // write hints
    writes: Array<WriteHint>,

    // require hints
    requires: Array<RequireHint>,

    // eval hints
    evals: Array<EvalHint>
}

export type AllocType = "Object" | "Prototype" | "Function" | "Class" | "Array";

export interface ReadHint {

    // source location of the operation
    loc: LocationJSON,

    // property name (absent if symbol)
    prop?: string,

    // source location of the value object
    valLoc: LocationJSON,

    // type of the value object
    valType: AllocType
}

export interface WriteHint {

    // type of hint
    type: "normal" | "get" | "set",

    // source location of the operation
    loc: LocationJSON, // used for reporting unhandled/patched write operations but not for actual patching

    // source location of the base object ("<module index>:-1:-1:-1:-1" represents the module exports object)
    baseLoc: LocationJSON,

    // type of the base object
    baseType: AllocType,

    // property name
    prop: string,

    // source location of the value object
    valLoc: LocationJSON,

    // type of the value object
    valType: AllocType
}

export interface RequireHint {

    // location of the require/import
    loc: LocationJSON

    // the module string
    str: string
}

export interface EvalHint {

    // location of the eval/Function call
    loc: LocationJSON

    // the code string
    str: string
}
