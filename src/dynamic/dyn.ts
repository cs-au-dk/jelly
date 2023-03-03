/*! DO NOT INSTRUMENT */

/**
 * Packages that are typically used for tests only and should be excluded in the collected call graphs.
 */
const TEST_PACKAGES = ["yarn", "mocha", "chai", "nyc", "sinon", "should", "@babel", "jest"]; // TODO: other test packages?

/**
 * Commands that do not need instrumentation, for example because the actual work is known to happen in child processes.
 */
const IGNORED_COMMANDS = ["npm", "npm-cli.js", "eslint", "grunt", "tsc", "tsd", "prettier", "rimraf", "xo"]; // TODO: other commands where instrumentation can be skipped?

// override 'node' executable by overwriting process.execPath and prepending $JELLY_BIN to $PATH
const jellybin = process.env.JELLY_BIN;
const node = `${jellybin}/node`;
if (!jellybin) {
    console.error('Error: Environment variable JELLY_BIN not set, aborting');
    process.exit(-1);
}
process.execPath = node;
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
        // console.log("jelly:", fun, arguments[0], arguments[1].join(" ")/*, opts*/); // XXX
        return real.call(this, arguments[0], arguments[1], opts);
    };
}

// skip instrumentation of selected commands where actual work is known to happen in child processes
const cmd = process.argv[4];
for (const s of IGNORED_COMMANDS)
    if (cmd.endsWith(`/${s}`)) {
        console.log(`jelly: Skipping instrumentation of ${cmd}`);
        // @ts-ignore
        return;
    }

const outfile = process.env.JELLY_OUT + "-" + process.pid;
if (!outfile) {
    console.error('Error: Environment variable JELLY_OUT not set, aborting');
    process.exit(-1);
}

console.log(`jelly: Running instrumented program: node ${process.argv.slice(4).join(" ")} (process ${process.pid})`);

import {IID, Jalangi, SourceObject} from "../typings/jalangi";
import fs from "fs";
import path from "path";

declare const J$: Jalangi;

const fileIds = new Map<string, number>();
const files: Array<string> = [];
const fun2fun = new Map<IID, Set<IID>>();
const call2fun = new Map<IID, Set<IID>>();
const functionLocations = new Map<IID, string>();
const callLocations = new Map<IID, string>();
const funLocStack = Array<IID>(); // top-most is source location of callee function
const inAppStack = Array<boolean>(); // top-most is true if in app code
let lastCallLoc: IID | null = null; // source location of most recent call site
let enterScriptLocation: SourceObject | undefined = undefined; // if not undefined, next functionEnter enters a module

// TODO: add edges for implicit calls? calls to/from built-ins? to/from Node.js std.lib? calls to/from eval/Function? async/await?
/**
 * Adds a call edge.
 */
function addCallEdge(call: IID | null, callerFun: IID, calleeFun: IID) {
    let fs = fun2fun.get(callerFun);
    if (!fs) {
        fs = new Set;
        fun2fun.set(callerFun, fs);
    }
    fs.add(calleeFun);
    if (call) { // excluding call->function edges for implicit calls
        let cs = call2fun.get(call);
        if (!cs) {
            cs = new Set;
            call2fun.set(call, cs);
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
J$.analysis = { // TODO: super calls not detected (see tests/micro/classes.js)

    /**
     * Before function or constructor call.
     */
    invokeFunPre: function(iid: IID, _f: Function, _base: Object, _args: any[], _isConstructor: boolean, _isMethod: boolean, _functionIid: IID, _functionSid: IID) {
        lastCallLoc = iid;
    },

    /**
     * Entering function.
     */
    functionEnter: function(iid: IID, _func: Function, _receiver: object, _args: any[]) {
        const so = J$.iidToSourceObject(iid);
        const calleeEval = "eval" in so;
        // determine whether the caller and/or the callee are in app code or in test packages
        let callerInApp, calleeInApp;
        if (inAppStack.length === 0) { // called from top-level
            calleeInApp = !so.name.includes("node_modules/") && !so.name.startsWith("/") && !calleeEval;
            callerInApp = false;
        } else {
            callerInApp = inAppStack.length > 0 && inAppStack[inAppStack.length - 1];
            if (callerInApp) {// called from app code
                calleeInApp = !so.name.startsWith("/");
                if (calleeInApp)
                    for (const w of TEST_PACKAGES)
                        if (so.name.includes(`node_modules/${w}/`)) {
                            calleeInApp = false;
                            break;
                        }
            } else // called from test package
                calleeInApp = !so.name.includes("node_modules/")
        }
        inAppStack.push(calleeInApp);
        // register call edge and call location if caller and callee are both in app code and it's an explicit call
        if (callerInApp && calleeInApp && funLocStack.length > 0 && lastCallLoc && !calleeEval) {
            const cso = J$.iidToSourceObject(lastCallLoc);
            const callerEval = "eval" in cso;
            if (!callerEval) {
                addCallEdge(lastCallLoc, funLocStack[funLocStack.length - 1], iid);
                if (!callLocations.has(lastCallLoc))
                    callLocations.set(lastCallLoc, so2loc(cso));
            }
        }
        // register function location if callee is in app code
        if (calleeInApp && !calleeEval && !functionLocations.has(iid))
            functionLocations.set(iid, so2loc(enterScriptLocation ?? so));
        // push function location and reset enterScriptLocation
        funLocStack.push(iid);
        enterScriptLocation = undefined;
        lastCallLoc = null;
    },

    /**
     * Exiting function.
     */
    functionExit: function(_iid: IID, _returnVal, _wrappedExceptionVal) {
        funLocStack.pop();
        lastCallLoc = null;
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
    evalPre(iid: IID, str: string) {
        lastCallLoc = null;
        // TODO: record extra information about eval/Function calls? see --callgraph-native-calls
    },

    // evalPost(iid: IID, str: string) {
    //     // TODO?
    // },

    /**
     * Before call to 'Function'.
     */
    evalFunctionPre(iid: IID, func: Function, receiver: Object, args: any) {
        lastCallLoc = null;
        // TODO?
    },

    // evalFunctionPost(iid: IID, func: Function, receiver: Object, args: any, ret: any) {
    //     // TODO?
    // },

    /**
     * Before call to built-in function.
     */
    builtinEnter(name: string, f: Function, dis: any, args: any) {
        lastCallLoc = null;
        // TODO: record extra information about calls to built-ins? see --callgraph-native-calls and --callgraph-require-calls
    },

    // builtinExit(name: string, returnVal: any) {
    //     // TODO?
    // },
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
    getFieldPre(iid: IID, base: any, offset: any, isComputed: boolean, isOpAssign: boolean, isMethodCall: boolean): { base: any; offset: any; skip: boolean } | void {
        lastCallLoc = null;
        // TODO: detect implicit calls to getters? see --callgraph-implicit-calls
    },

    // getField(iid: IID, base: any, offset: any, val: any, isComputed: boolean, isOpAssign: boolean, isMethodCall: boolean): { result: any } | void {
    //     // TODO?
    // },

    /**
     * Before property write operation (which may trigger implicit call).
     */
    putFieldPre(iid: IID, base: any, offset: any, val: any, isComputed: boolean, isOpAssign: boolean): { base: any; offset: any; val: any; skip: boolean } | void {
        lastCallLoc = null;
        // TODO: detect implicit calls to setters? see --callgraph-implicit-calls
    },

    // putField(iid: IID, base: any, offset: any, val: any, isComputed: boolean, isOpAssign: boolean): { result: any } | void {
    //     // TODO?
    // },

    /**
     * Before unary operator (which may trigger implicit call).
     */
    unaryPre(iid: IID, op: string, left: any): { op: string; left: any; skip: boolean } | void {
        lastCallLoc = null;
        // TODO: detect implicit calls to valueOf? see --callgraph-implicit-calls
    },

    // unary(iid: IID, op: string, left: any, result: any): { result: any } | void {
    //     // TODO?
    // },

    /**
     * Before binary operator (which may trigger implicit call).
     */
    binaryPre(iid: IID, op: string, left: any, right: any, isOpAssign: boolean, isSwitchCaseComparison: boolean, isComputed: boolean): { op: string; left: any; right: any; skip: boolean } | void {
        lastCallLoc = null;
        // TODO: detect implicit calls to valueOf/toString? see --callgraph-implicit-calls
    },

    // binary(iid: IID, op: string, left: any, right: any, result: any, isOpAssign: boolean, isSwitchCaseComparison: boolean, isComputed: boolean): { result: any } | void {
    //     // TODO?
    // }
};

/**
 * Program exit, write call graph to JSON file.
 * (Note, funLocStack is nonempty if exit happens because of process.exit.)
 */
process.on('exit', function() {
    if (files.length === 0) {
        console.log(`jelly: No relevant files detected for process ${process.pid}, skipping file write`);
        return;
    }
    // console.log(`jelly: Writing ${outfile}`);
    const fd = fs.openSync(outfile, "w");
    fs.writeSync(fd, `{\n "entries": [${JSON.stringify(path.relative(process.cwd(), process.argv[1]))}],\n`);
    fs.writeSync(fd, ` "time": "${new Date().toUTCString()}",\n`);
    fs.writeSync(fd, ` "files": [`);
    let first = true;
    for (const file of files) {
        fs.writeSync(fd, `${first ? "" : ","}\n  ${JSON.stringify(file)}`);
        first = false;
    }
    fs.writeSync(fd, `\n ],\n "functions": {`);
    first = true;
    for (const [iid, loc] of functionLocations) {
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
    for (const [callerFun, callees] of fun2fun)
        for (const callee of callees) {
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
