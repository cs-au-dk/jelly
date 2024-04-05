/*! DO NOT INSTRUMENT */

import {decodeAndSetSourceMap, getSourceObject} from "./sourcemaps";

/**
 * Commands that do not need instrumentation, for example because the actual work is known to happen in child processes.
 */
const IGNORED_COMMANDS = [
    "npm", "npm-cli.js",
    "grunt", "rollup", "browserify", "webpack", "terser",
    "rimraf",
    "eslint", "tslint", "jslint", "jshint", "stylelint", "prettier", "xo", "standard",
    "tsc", "tsd",
    "nyc",
    // TODO: other commands where instrumentation can be skipped?
];

// only write messages to stdout if it is a TTY
const log = process.stdout.isTTY ? console.log.bind(console) : () => {};

// capture before application can change directory
const cwd = process.cwd();
// JELLY_BASEDIR is the path that files in the output should be relative to
// propagating this value to child processes makes output paths consistent,
// even when processes are spawned with different working directories
const JELLY_BASEDIR = process.env.JELLY_BASEDIR || cwd;

// override 'node' executable by overwriting process.execPath and prepending $JELLY_BIN to $PATH
const jellybin = process.env.JELLY_BIN;
if (!jellybin) {
    console.error('Error: Environment variable JELLY_BIN not set, aborting');
    process.exit(-1);
}
const node = `${jellybin}/node`;
const child_process = require("child_process");
for (const fun of ["spawn", "spawnSync"]) {
    const real = child_process[fun];
    child_process[fun] = function() {
        const env = arguments[2]?.env || process.env;
        const opts =
            { ...arguments[2],
                    env: {...env,
                        PATH: `${jellybin}${env.PATH ? `:${env.PATH}` : ""}`,
                        NODE: node,
                        npm_node_execpath: node,
                        JELLY_BASEDIR,
                    }};
        // log("jelly:", fun, arguments[0], arguments[1].join(" ")/*, opts*/); // XXX
        return real.call(this, arguments[0], arguments[1], opts);
    };
}

// skip instrumentation of selected commands where actual work is known to happen in child processes
const cmd = process.argv[6];
for (const s of IGNORED_COMMANDS)
    if (cmd.endsWith(`/${s}`)) {
        log(`jelly: Skipping instrumentation of ${cmd}`);
        // @ts-ignore
        return;
    }

const outfile = process.env.JELLY_OUT + "-" + process.pid;
if (!("JELLY_OUT" in process.env)) {
    console.error('Error: Environment variable JELLY_OUT not set, aborting');
    process.exit(-1);
}

import {IID, Jalangi, SourceObject} from "../typings/jalangi";
import {mapArrayAdd} from "../misc/util";
import {isPathInTestPackage, isSourceSimplyWrapped} from "./sources";
import fs from "fs";
import path from "path";

try {
    // attempt to detect if we're running the jest entry point
    // if so, insert jest parameter that disables the use of worker processes for tests
    const jestDetector = /\/node_modules\/(?:jest(?:-cli)?\/bin\/jest\.js|jest-ci\/bin\.js)$/;
    if (cmd.indexOf("jest") !== -1 && jestDetector.test(fs.realpathSync(cmd)))
        process.argv.splice(7, 0, "--runInBand");
} catch(e) {}

log(`jelly: Running instrumented program: node ${process.argv.slice(6).join(" ")} (process ${process.pid})`);

enum FunType {
    App,
    Lib,
    Test,
}

interface FunInfo {
    type: FunType,
    // ignored functions will not be present in the output and no calls to/from
    // ignored functions are recorded. currently true for functions defined in an
    // eval context and functions in files that have been transformed at run-time
    ignored: boolean,
    // call edges to other functions
    calls?: Set<IID>,
    loc: SourceObject,
    // whether the function has been entered from app-level code
    observedAsApp: boolean,
}

declare const J$: Jalangi;

const fileIds = new Map<string, number>();
const files: Array<string> = [];
const ignoredFiles = new Set<string>(["structured-stack", "evalmachine.<anonymous>"]);
const call2fun = new Map<IID, Set<IID>>();
const callLocations = new Map<IID, string>();
const funLocStack = Array<IID>(); // top-most is source location of callee function
// top-most is true if in app code
// i.e. whether the top-most non-library function is not a test function
const inAppStack = Array<boolean>();
let enterScriptLocation: SourceObject | undefined = undefined; // if not undefined, next functionEnter enters a module
// maps returned functions from Function.prototype.bind(...) to the bound function
const binds = new WeakMap<Function, Function>();
// stores a list of pending callers for functions that haven't been entered yet
const pendingCalls = new WeakMap<Function, [FunInfo, IID][]>();
const funIids = new WeakMap<Function, IID>();
const iidToInfo = new Map<IID, FunInfo>();

// TODO: add edges for implicit calls? calls to/from built-ins? to/from Node.js std.lib? calls to/from eval/Function? async/await?
/**
 * Adds a call edge to a resolved callee.
 */
function addCallEdge(call: IID, callerInfo: FunInfo, callee: IID) {
    (callerInfo.calls ??= new Set()).add(callee);

    if (call) { // excluding call->function edges for implicit calls
        let cs = call2fun.get(call);
        if (!cs) {
            cs = new Set;
            try {
                callLocations.set(call, so2loc(J$.iidToSourceObject(call)));
                call2fun.set(call, cs);
            } catch (e) {
                log(`Source mapping error: ${e}, for ${JSON.stringify(J$.iidToSourceObject(call))}`);
            }
        }
        cs.add(callee);
    }
}

/**
 * Tries to resolve the callee function to an IID and adds a call edge.
 * If the IID cannot be retrieved, a pending call to be resolved later is registered instead.
 */
function registerCall(call: IID, callerInfo: FunInfo, callee: Function) {
    // resolve bound functions
    let bound: Function | undefined;
    while ((bound = binds.get(callee)) !== undefined)
        callee = bound;

    const calleeIid = funIids.get(callee);
    if (calleeIid === undefined)
        // we have not entered the function yet - register pending call
        mapArrayAdd(callee, [callerInfo, call], pendingCalls);
    else {
        // every iid in funIids must map to something in iidToInfo
        const calleeInfo = iidToInfo.get(calleeIid)!;
        if (calleeInfo.type !== FunType.Test && !calleeInfo.ignored)
            addCallEdge(call, callerInfo, calleeIid);
    }
}

/**
 * Converts NodeProf SourceObject to string representation.
 */
function so2loc(s: SourceObject): string {
    let fid = fileIds.get(s.name);
    s = getSourceObject(s); // converting source object via source mapping if present
    if (fid === undefined) {
        fid = files.length;
        files.push(s.name);
        fileIds.set(s.name, fid);
    }
    return `${fid}:${s.loc.start.line}:${s.loc.start.column}:${s.loc.end.line}:${s.loc.end.column + 1}`;
}

/**
 * Converts paths to source files to the appropriate function type.
 * Memoized.
 */
const pathToFunType: (path: string) => FunType = (() => {
    const cache = new Map<string, FunType>();
    return (path: string): FunType => {
        let typ = cache.get(path);
        if (typ !== undefined)
            return typ;

        typ = path === "<builtin>"? FunType.Lib :
            path.startsWith("/") || path.includes("node_modules/")?
            (isPathInTestPackage(path)? FunType.Test : FunType.Lib)
            : FunType.App;
        cache.set(path, typ);
        return typ;
    };
})();

/**
 * NodeProf instrumentation callbacks.
 */
J$.addAnalysis({ // TODO: super calls not detected (see tests/micro/classes.js)

    /**
     * Before function or constructor call.
     */
    invokeFunPre: function(iid: IID, f: Function, _base: unknown, _args: any[], _isConstructor: boolean, _isMethod: boolean, _functionIid: IID, _functionSid: IID) {
        const callerInApp = inAppStack.length > 0 && inAppStack[inAppStack.length - 1];
        if (callerInApp && typeof f === "function") {
            const callerIid = funLocStack[funLocStack.length - 1]!;
            const callerInfo = iidToInfo.get(callerIid)!;
            if (!callerInfo.ignored)
                registerCall(iid, callerInfo, f);
        }
    },

    /**
     * Entering function.
     */
    functionEnter: function(iid: IID, func: Function, _receiver: object, _args: any[]) {
        funIids.set(func, iid);

        let info = iidToInfo.get(iid);
        if (info === undefined) {
            const so = J$.iidToSourceObject(iid);

            info = {
                type: pathToFunType(so.name),
                ignored: ("eval" in so) || ignoredFiles.has(so.name),
                loc: enterScriptLocation ?? so,
                observedAsApp: false,
            };

            iidToInfo.set(iid, info);
        }

        // determine whether the caller and/or the callee are in app code or in test packages
        let calleeInApp;
        if (inAppStack.length === 0) // called from top-level
            calleeInApp = info.type === FunType.App && !("eval" in info.loc);
        else {
            const callerInApp = inAppStack[inAppStack.length - 1];
            if (callerInApp) // called from app code
                calleeInApp = info.type !== FunType.Test;
            else // called from test package
                calleeInApp = info.type === FunType.App;
        }
        inAppStack.push(calleeInApp);
        info.observedAsApp ||= calleeInApp;

        const pCalls = pendingCalls.get(func);
        if (pCalls !== undefined) {
            pendingCalls.delete(func);

            if (calleeInApp && !info.ignored)
                for (const [caller, callIid] of pCalls) // register pending call edges
                    addCallEdge(callIid, caller, iid);
        }

        // push function location and reset enterScriptLocation
        funLocStack.push(iid);
        enterScriptLocation = undefined;
    },

    /**
     * Exiting function.
     */
    functionExit: function(_iid: IID, _returnVal, _wrappedExceptionVal) {
        // console.log(`Exited ${_iid && J$.iidToLocation(_iid)}`);
        funLocStack.pop();
        inAppStack.pop();
    },

    /**
     * New source file loaded, apply workaround to find correct end source location.
     */
    newSource: function(sourceInfo: { name: string; internal: boolean, eval?: string }, source: string) {
        if ("eval" in sourceInfo)
            return; // eval/Function call, not actually a new source file

        // check whether the source we observe matches the file on disk
        try {
            const fp = sourceInfo.name.startsWith("file://")? sourceInfo.name.substring("file://".length) : sourceInfo.name,
                absfp = path.isAbsolute(fp)? fp : path.join(cwd, fp);
            const diskSource = fs.readFileSync(absfp, "utf-8");
            if (diskSource !== source && !isSourceSimplyWrapped(diskSource, source)) {
                log(`jelly: the source for ${sourceInfo.name} does not match the on-disk content, trying to find source mapping`);
                // if the source does not match, try to find the source map and use that to resolve the source location
                const m = decodeAndSetSourceMap(source, sourceInfo.name);
                if (!m) {
                    log(`jelly: the source mapping for ${sourceInfo.name} can't find - ignoring`);
                    ignoredFiles.add(sourceInfo.name);
                }
            }
        } catch (error: any) {
            if (error.code !== "ENOENT")
                throw error;
        }

        // find correct end source location
        let endLine = 1, last = 0;
        for (let i = 0; i < source.length; i++) {
            if (source[i] === '\n') {
                endLine++;
                last = i + 1;
            }
        }
        const endColumn = source.length - last;
        enterScriptLocation = {
            name: sourceInfo.name,
            loc: {
                start: { line: 1, column: 1 },
                end: { line: endLine, column: endColumn }
            }
        };
    },

    /**
     * Before call to 'eval'.
     */
    // evalPre(iid: IID, str: string) {
    //     // TODO: record extra information about eval/Function calls? see --callgraph-native-calls
    // },

    // evalPost(iid: IID, str: string) {
    //     // TODO?
    // },

    /**
     * Before call to 'Function'.
     */
    // evalFunctionPre(iid: IID, func: Function, receiver: Object, args: any) {
    //     // TODO?
    // },

    // evalFunctionPost(iid: IID, func: Function, receiver: Object, args: any, ret: any) {
    //     // TODO?
    // },

    /**
     * Before call to built-in function.
     */
    builtinEnter(name: string, f: Function, dis: any, args: any) {
        // (J$ as any).nativeLog(`BuiltinEnter ${name} ${typeof dis}`);

        const pCalls = pendingCalls.get(f);
        if (pCalls !== undefined) {
            // TODO: Populate funIids and iidToInfo with something to prevent pending calls?
            pendingCalls.delete(f);

            switch (name) {
                case "Function.prototype.call":
                case "Function.prototype.apply": {
                    if (typeof dis === "function") {
                        if (pCalls.length === 1) { // common case
                            const [callerInfo, iid] = pCalls[0];
                            registerCall(iid, callerInfo, dis);
                        } else
                            for (const [callerInfo, iid] of pCalls)
                                registerCall(iid, callerInfo, dis);
                    }
                }

                // TODO: record extra information about calls to other built-ins? see --no-callgraph-native and --no-callgraph-require
            }
        }
    },

    builtinExit(name: string, f: Function, dis: any, args: any, returnVal: any, exceptionVal: any) {
        // (J$ as any).nativeLog(`BuiltinExit ${name} ${returnVal} ${typeof returnVal} ${dis} ${typeof dis}`);
        if (name === "Function.prototype.bind" && typeof returnVal === "function")
            binds.set(returnVal, dis); // record information about binds
    },
    //
    // asyncFunctionEnter(iid: IID) {
    //     // TODO: record extra information about async calls? see --callgraph-native-calls
    // },
    //
    // asyncFunctionExit(iid: IID, returnVal: any, wrappedException) {
    //     // TODO?
    // },
    //
    // awaitPre(iid: IID, valAwaited: any) {
    //     // TODO: record extra information about awaits?
    // },
    //
    // awaitPost(iid: IID, valAwaited: any, result: any, rejected: boolean) {
    //     // TODO?
    // },

    /**
     * Before property read operation (which may trigger implicit call).
     */
    // getFieldPre(iid: IID, base: any, offset: any, isComputed: boolean, isOpAssign: boolean, isMethodCall: boolean): { base: any; offset: any; skip: boolean } | void {
    //     // TODO: detect implicit calls to getters? see --callgraph-implicit-calls
    // },

    // getField(iid: IID, base: any, offset: any, val: any, isComputed: boolean, isOpAssign: boolean, isMethodCall: boolean): { result: any } | void {
    //     // TODO?
    // },

    /**
     * Before property write operation (which may trigger implicit call).
     */
    // putFieldPre(iid: IID, base: any, offset: any, val: any, isComputed: boolean, isOpAssign: boolean): { base: any; offset: any; val: any; skip: boolean } | void {
    //     // TODO: detect implicit calls to setters? see --callgraph-implicit-calls
    // },

    // putField(iid: IID, base: any, offset: any, val: any, isComputed: boolean, isOpAssign: boolean): { result: any } | void {
    //     // TODO?
    // },

    /**
     * Before unary operator (which may trigger implicit call).
     */
    // unaryPre(iid: IID, op: string, left: any): { op: string; left: any; skip: boolean } | void {
    //     // TODO: detect implicit calls to valueOf? see --callgraph-implicit-calls
    // },

    // unary(iid: IID, op: string, left: any, result: any): { result: any } | void {
    //     // TODO?
    // },

    /**
     * Before binary operator (which may trigger implicit call).
     */
    // binaryPre(iid: IID, op: string, left: any, right: any, isOpAssign: boolean, isSwitchCaseComparison: boolean, isComputed: boolean): { op: string; left: any; right: any; skip: boolean } | void {
    //     // TODO: detect implicit calls to valueOf/toString? see --callgraph-implicit-calls
    // },

    // binary(iid: IID, op: string, left: any, right: any, result: any, isOpAssign: boolean, isSwitchCaseComparison: boolean, isComputed: boolean): { result: any } | void {
    //     // TODO?
    // }
}, // Exclude internal sources except actual files incorrectly marked as internal.
   // The incorrect marking has been observed for ECMAScript modules.
   (source: SourceObject) =>  {
       if (source.internal && !source.name.startsWith("file://"))
           return false;
       // exclude instrumentation of TypeScript to JavaScript compilation, sourcemap, and jest
       const excludedPacakges = ["node_modules/ts-node/",
           "node_modules/@cspotcode/source-map-support/",
           "node_modules/@jridgewell/resolve-uri/",
           "node_modules/@jridgewell/sourcemap-codec/",
           "node_modules/tslib/",
           "node_modules/typescript/",
           "node_modules/source-map",
           "node_modules/source-map-support",
           "node_modules/jest-cli/",
           "node_modules/@jest/",
           "node_modules/ts-jest/",
           "node_modules/jest-"
       ];
       for (const pattern of excludedPacakges) {
           if(source.name.includes(pattern))
               return false;
       }
       return true;
   }
);

/**
 * Program exit, write call graph to JSON file.
 * (Note, funLocStack is nonempty if exit happens because of process.exit.)
 */
process.on('exit', () => {
    const outputFunctions = [];
    for (const [iid, info] of iidToInfo) if (!info.ignored && info.observedAsApp)
        try {
            outputFunctions.push([iid, so2loc(info.loc)]);
        } catch (e) {
            log(`Source mapping error: ${e}, for ${JSON.stringify(info.loc)}`);
        }

    if (outputFunctions.length === 0) {
        log(`jelly: No relevant functions detected for process ${process.pid}, skipping file write`);
        return;
    }

    // log(`jelly: Writing ${outfile}`);

    function formatPath(fp: string): string {
        fp = fp.startsWith("file://")? fp.substring("file://".length) : path.resolve(cwd, fp);
        // ensure that paths are relative to the base directory
        return JSON.stringify(path.relative(JELLY_BASEDIR, fp));
    }

    const fd = fs.openSync(outfile, "w");
    fs.writeSync(fd, `{\n "entries": [${formatPath(process.argv[1])}],\n`);
    fs.writeSync(fd, ` "time": "${new Date().toUTCString()}",\n`);
    fs.writeSync(fd, ` "files": [`);
    let first = true;
    for (const file of files) {
        fs.writeSync(fd, `${first ? "" : ","}\n  ${formatPath(file)}`);
        first = false;
    }
    fs.writeSync(fd, `\n ],\n "functions": {`);
    first = true;
    for (const [iid, loc] of outputFunctions) {
        fs.writeSync(fd, `${first ? "" : ","}\n  "${iid}": ${JSON.stringify(loc)}`);
        first = false;
    }
    fs.writeSync(fd, `\n },\n "calls": {`);
    first = true;
    for (const [iid, loc] of callLocations) {
        fs.writeSync(fd, `${first ? "" : ","}\n  "${iid}": ${JSON.stringify(loc)}`);
        first = false;
    }
    fs.writeSync(fd, `\n },\n "fun2fun": [`);
    first = true;
    for (const [callerFun, info] of iidToInfo)
        for (const callee of info.calls ?? []) {
            fs.writeSync(fd, `${first ? "\n  " : ", "}[${callerFun}, ${callee}]`);
            first = false;
        }
    fs.writeSync(fd, `${first ? "" : "\n "}],\n "call2fun": [`);
    first = true;
    for (const [call, callees] of call2fun)
        for (const callee of callees) {
            fs.writeSync(fd, `${first ? "\n  " : ", "}[${call}, ${callee}]`);
            first = false;
        }
    fs.writeSync(fd, `${first ? "" : "\n "}]\n}\n`);
    fs.closeSync(fd);
});
