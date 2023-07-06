/*! DO NOT INSTRUMENT */

/**
 * Packages that are typically used for tests only and should be excluded in the collected call graphs.
 */
const TEST_PACKAGES = [
    "ava", "yarn", "mocha", "chai", "nyc",
    "sinon", "should", "@babel", "jest", "tap", "tape",
]; // TODO: other test packages?

/**
 * Commands that do not need instrumentation, for example because the actual work is known to happen in child processes.
 */
const IGNORED_COMMANDS = [
    "npm", "npm-cli.js",
    "grunt", "rollup", "browserify", "webpack", "terser",
    "rimraf",
    "eslint", "tslint", "jslint", "prettier", "xo", "standard",
    "tsc", "tsd",
    // TODO: other commands where instrumentation can be skipped?
];

// only write messages to stdout if it is a TTY
const log = process.stdout.isTTY? console.log.bind(console) : () => {};

// override 'node' executable by overwriting process.execPath and prepending $JELLY_BIN to $PATH
const jellybin = process.env.JELLY_BIN;
if (!jellybin) {
    console.error('Error: Environment variable JELLY_BIN not set, aborting');
    process.exit(-1);
}
const node = `${jellybin}/node`;
const child_process = require('child_process');
for (const fun of ["spawn", "spawnSync"]) {
    const real = child_process[fun];
    child_process[fun] = function() {
        const env = arguments[2]?.env || process.env;
        const opts =
            { ...arguments[2],
                    env: {...env,
                        PATH: `${jellybin}${env.PATH ? `:${env.PATH}` : ""}`,
                        NODE: node,
                        npm_node_execpath: node
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
if (!outfile) {
    console.error('Error: Environment variable JELLY_OUT not set, aborting');
    process.exit(-1);
}

import {IID, Jalangi, SourceObject} from "../typings/jalangi";
import fs from "fs";
import path from "path";

try {
    // attempt to detect if we're running the jest entry point
    // if so, insert jest parameter that disables the use of worker processes for tests
    if(cmd.indexOf("jest") != -1 && /\/node_modules\/jest(-cli)?\/bin\/jest\.js$/.test(fs.realpathSync(cmd)))
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
    eval: boolean,
    calls?: Set<IID>,
    loc: SourceObject,
}

declare const J$: Jalangi;

const cwd = process.cwd();  // capture before application can change directory
const fileIds = new Map<string, number>();
const files: Array<string> = [];
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
 * Adds a call edge.
 */
function addCallEdge(call: IID | null, callerFun: FunInfo, calleeFun: IID) {
    (callerFun.calls ??= new Set()).add(calleeFun);

    if (call) { // excluding call->function edges for implicit calls
        let cs = call2fun.get(call);
        if (!cs) {
            cs = new Set;
            call2fun.set(call, cs);
            callLocations.set(call, so2loc(J$.iidToSourceObject(call)));
        }
        cs.add(calleeFun);
    }
}

/**
 * Converts NodeProf SourceObject to string representation.
 */
function so2loc(s: SourceObject): string {
    let fid = fileIds.get(s.name);
    if (fid === undefined) {
        fid = files.length;
        files.push(s.name);
        fileIds.set(s.name, fid);
    }
    return `${fid}:${s.loc.start.line}:${s.loc.start.column}:${s.loc.end.line}:${s.loc.end.column + 1}`;
}

/**
 * NodeProf instrumentation callbacks.
 */
J$.addAnalysis({ // TODO: super calls not detected (see tests/micro/classes.js)

    /**
     * Before function or constructor call.
     */
    invokeFunPre: function(iid: IID, f: Function, _base: Object, _args: any[], _isConstructor: boolean, _isMethod: boolean, _functionIid: IID, _functionSid: IID) {
        // console.log(`invokeFunPre ${f.name} from ${iid && J$.iidToLocation(iid)}`);

        const callerInApp = inAppStack.length > 0 && inAppStack[inAppStack.length - 1];
        if (callerInApp && typeof f === "function") {
            const callerIid = funLocStack[funLocStack.length - 1]!
            const callerInfo = iidToInfo.get(callerIid)!;
            if (!callerInfo.eval) {
                // resolve bound functions
                let bound: Function | undefined;
                while((bound = binds.get(f)) !== undefined)
                    f = bound;

                const calleeIid = funIids.get(f);
                if (calleeIid === undefined) {
                    // we have not entered the function yet - register pending call
                    let m = pendingCalls.get(f);
                    if (m === undefined)
                        pendingCalls.set(f, m = []);

                    m.push([callerInfo, iid]);
                } else {
                    // every iid in funIids must map to something in iidToInfo
                    const calleeInfo = iidToInfo.get(calleeIid)!;
                    if (calleeInfo.type !== FunType.Test && !calleeInfo.eval)
                        addCallEdge(iid, callerInfo, calleeIid);
                }
            }
        }
    },

    /**
     * Entering function.
     */
    functionEnter: function(iid: IID, func: Function, _receiver: object, _args: any[]) {
        // console.log(`Entered ${func.name} ${J$.iidToLocation(iid)}`);
        funIids.set(func, iid);

        let info = iidToInfo.get(iid);
        if (info === undefined) {
            const so = J$.iidToSourceObject(iid);

            info = {
                type: TEST_PACKAGES.some((w) => so.name.includes(`node_modules/${w}/`))?
                    FunType.Test :
                    so.name.startsWith("/") || so.name.includes("node_modules/")?
                    FunType.Lib : FunType.App,
                eval: "eval" in so,
                loc: enterScriptLocation ?? so,
            };

            iidToInfo.set(iid, info);
        }

        // determine whether the caller and/or the callee are in app code or in test packages
        let callerInApp, calleeInApp;
        if (inAppStack.length === 0) { // called from top-level
            calleeInApp = info.type === FunType.App && !info.eval;
            callerInApp = false;
        } else {
            callerInApp = inAppStack[inAppStack.length - 1];
            if (callerInApp) // called from app code
                calleeInApp = info.type !== FunType.Test;
            else // called from test package
                calleeInApp = info.type === FunType.App;
        }
        inAppStack.push(calleeInApp);

        const pCalls = pendingCalls.get(func);
        if (pCalls !== undefined) {
            pendingCalls.delete(func);

            if (calleeInApp && !info.eval)
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
        // (J$ as any).nativeLog(`BuiltinEnter ${name} ${dis} ${typeof dis}`);
        pendingCalls.delete(f); // remove pending calls
        // TODO: Populate funIids and iidToInfo with something to prevent pending calls?
        // TODO: record extra information about calls to built-ins? see --callgraph-native-calls and --callgraph-require-calls
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
   (source: SourceObject) => !source.internal || source.name.startsWith("file://"));

/**
 * Program exit, write call graph to JSON file.
 * (Note, funLocStack is nonempty if exit happens because of process.exit.)
 */
process.on('exit', function() {
    if (files.length === 0) {
        log(`jelly: No relevant files detected for process ${process.pid}, skipping file write`);
        return;
    }

    // log(`jelly: Writing ${outfile}`);

    // the function locations that are required are for those functions
    // that have calls or are called
    const requiredFunctions = new Set([...iidToInfo.entries()]
                                      .flatMap(([i, f]) => f.calls === undefined? [] :
                                               [i].concat([...f.calls])));

    const fd = fs.openSync(outfile, "w");
    fs.writeSync(fd, `{\n "entries": [${JSON.stringify(path.relative(cwd, process.argv[1]))}],\n`);
    fs.writeSync(fd, ` "time": "${new Date().toUTCString()}",\n`);
    fs.writeSync(fd, ` "functions": {`);
    let first = true;
    for (const [iid, info] of iidToInfo) if (requiredFunctions.has(iid)) {
        fs.writeSync(fd, `${first ? "" : ","}\n  "${iid}": ${JSON.stringify(so2loc(info.loc))}`);
        first = false;
    }
    fs.writeSync(fd, `\n },\n "files": [`);
    // files go after functions as so2loc populates files
    first = true;
    for (const file of files) {
        // relativize absolute paths with file:// prefix
        const fp = file.startsWith("file://")? path.relative(cwd, file.substring("file://".length)) : file;
        fs.writeSync(fd, `${first ? "" : ","}\n  ${JSON.stringify(fp)}`);
        first = false;
    }
    fs.writeSync(fd, `\n ],\n "calls": {`);
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
