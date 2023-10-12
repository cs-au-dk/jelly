import {options} from "../options";
import AnalysisDiagnostics from "../analysis/diagnostics";
import {AccessPathPatternToLocations} from "../patternmatching/apiusage";
import {PatternMatchesJSON} from "../patternmatching/patternmatcher";
import {SemanticPatch} from "./tapir";
import {CallGraph} from "./callgraph";
import {LibraryUsageJSON} from "../typescript/typeinferrer";

export interface Message {
    seq?: number;
    type: "request" | "response";
}

export interface Request extends Message {
    type: "request";
    command: RequestCommands;
    arguments?: any;
}

export interface Response extends Message {
    type: "response";
    seq: number;
    command?: RequestCommands;
    request_seq?: number;
    success: boolean;
    message?: string;
    body?: any;
}

export interface SuccessResponse extends Response {
    success: true;
}

export type RequestCommands =
    "options" |
    "expandpaths" |
    "files" |
    "analyze" |
    "abort" |
    "diagnostics" |
    "callgraph" |
    "htmlcallgraph" |
    "htmldataflowgraph" |
    "reachablepackages" |
    "typescript" |
    "tslibraryusage" |
    "apiusage" |
    "patternfiles" |
    "patterns" |
    "patternmatch" |
    "clear" |
    "reset" |
    "exit";

/**
 * Set the given options.
 * Returns simple response.
 */
export interface OptionsRequest extends Request {
    command: "options";
    arguments: Partial<typeof options>;
}

/**
 * Request expansion of list of files and/or directories.
 * Returns ExpandFilesResponse.
 */
export interface ExpandPathsRequest extends Request {
    command: "expandpaths";
    arguments: Array<string> | string;
}

export interface ExpandPathsResponse extends SuccessResponse {
    body: Array<string>;
}

/**
 * Select files.
 * Returns simple response when analysis is completed.
 */
export interface FilesRequest extends Request {
    command: "files";
    arguments: Array<string>;
}

/**
 * Start analysis.
 * Returns simple response when analysis is completed.
 */
export interface AnalyzeRequest extends Request {
    command: "analyze";
}

/**
 * Abort analysis if running.
 * Returns simple response.
 */
export interface AbortRequest extends Request {
    command: "abort";
}

/**
 * Clear results etc. from last analysis.
 * Returns simple response.
 */
export interface ClearRequest extends Request {
    command: "clear";
}

/**
 * Run TypeScript parser on the files selected in the last analysis.
 * Returns simple response.
 */
export interface TypeScriptRequest extends Request {
    command: "typescript";
}

/**
 * Request analysis diagnostics (during or after analysis).
 * Returns DiagnosticsResponse.
 */
export interface DiagnosticsRequest extends Request {
    command: "diagnostics";
}

export interface DiagnosticsResponse extends SuccessResponse {
    body: AnalysisDiagnostics;
}

/**
 * Run API usage analysis (after analysis).
 * Returns ApiUsageResponse.
 */
export interface ApiUsageRequest extends Request {
    command: "apiusage";
}

export interface ApiUsageResponse extends SuccessResponse {
    body: AccessPathPatternToLocations;
}

/**
 * Set patterns from files (before analysis).
 * Returns simple response.
 */
export interface PatternFilesRequest extends Request {
    command: "patternfiles";
    arguments: Array<string>;
}

/**
 * Set patterns (before analysis).
 * Returns simple response.
 */
export interface PatternsRequest extends Request {
    command: "patterns";
    arguments: Array<SemanticPatch>;
}

/**
 * Perform pattern matching (after analysis).
 * Returns PatternMatchResponse.
 */
export interface PatternMatchRequest extends Request {
    command: "patternmatch";
}

export interface PatternMatchResponse extends SuccessResponse {
    body: PatternMatchesJSON;
}

/**
 * Request call graph (after analysis).
 * Returns CallGraphResponse.
 */
export interface CallGraphRequest extends Request {
    command: "callgraph";
}

export interface CallGraphResponse extends SuccessResponse {
    body: CallGraph;
}

/**
 * Request HTML call graph (after analysis).
 * Returns simple response.
 */
export interface HTMLCallGraphRequest extends Request {
    command: "htmlcallgraph";
}

/**
 * Request HTML data-flow graph (after analysis).
 * Returns simple response.
 */
export interface HTMLDataFlowGraphRequest extends Request {
    command: "htmldataflowgraph";
}

/**
 * Request TypeScript library usage (after TypeScript parsing).
 * Returns TSLibraryUsageResponse.
 */
export interface TSLibraryUsageRequest extends Request {
    command: "tslibraryusage";
}

export interface TSLibraryUsageResponse extends SuccessResponse {
    body: LibraryUsageJSON;
}

/**
 * Request list of reachable packages (after analysis).
 * Returns ReachablePackagesResponse.
 */
export interface ReachablePackagesRequest extends Request {
    command: "reachablepackages";
}

export interface ReachablePackagesResponse extends SuccessResponse {
    body: Array<{
        name: string;
        version?: string;
    }>;
}

/**
 * Resets options and clear analysis results etc.
 * Returns simple response.
 */
export interface ResetRequest extends Request {
    command: "reset";
}
