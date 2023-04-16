import {options, resetOptions} from "../../src/options";
import logger from "../../src/misc/logger";
import {runTest} from "../../src/testing/runtest";

beforeEach(() => {
    resetOptions();
    logger.transports[0].level = options.loglevel = "error";
});

test("tests/micro/classes", async () => {
    await runTest("tests/micro", "classes.js", {
        soundness: "tests/micro/classes.json",
        functionInfos: 39,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 34,
        oneCalleeCalls: 32,
        funFound: 32,
        funTotal: 33,
        callFound: 36,
        callTotal: 36
    });
});

test("tests/micro/accessors", async () => {
    await runTest("tests/micro", "accessors.js", {
        soundness: "tests/micro/accessors.json",
        functionInfos: 3,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 3,
        oneCalleeCalls: 3,
        funFound: 3,
        funTotal: 3,
        callFound: 1,
        callTotal: 1
    });
});

test("tests/micro/accessors2", async () => {
    await runTest("tests/micro", "accessors2.js", {
        functionInfos: 4,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 4,
        oneCalleeCalls: 4
    });
});

test("tests/micro/eval", async () => {
    await runTest("tests/micro", "eval.js", {
        soundness: "tests/micro/eval.json",
        functionInfos: 3,
        moduleInfos: 2,
        numberOfFunctionToFunctionEdges: 0,
        oneCalleeCalls: 0,
        funFound: 1,
        funTotal: 1,
        callFound: 1,
        callTotal: 1
    });
});

test("tests/micro/client1", async () => {
    await runTest("tests/micro", "client1.js", {
        soundness: "tests/micro/client1.json",
        functionInfos: 3,
        moduleInfos: 2,
        numberOfFunctionToFunctionEdges: 3,
        oneCalleeCalls: 3,
        funFound: 4,
        funTotal: 4,
        callFound: 4,
        callTotal: 4
    });
});

test("tests/micro/client1b", async () => {
    options.ignoreDependencies = true;
    await runTest("tests/micro", "client1b.js", {
        patterns: ["tests/micro/patterns.json"],
        functionInfos: 1,
        moduleInfos: 1,
        matches: {total: 6}
    });
});

test("tests/micro/client2", async () => {
    await runTest("tests/micro", "client2.js", {
        soundness: "tests/micro/client2.json",
        functionInfos: 3,
        moduleInfos: 2,
        numberOfFunctionToFunctionEdges: 2,
        oneCalleeCalls: 2,
        funFound: 2,
        funTotal: 2,
        callFound: 2,
        callTotal: 2
    });
});

test("tests/micro/client3", async () => {
    await runTest("tests/micro", "client3.js", {
        soundness: "tests/micro/client3.json",
        functionInfos: 1,
        moduleInfos: 2,
        numberOfFunctionToFunctionEdges: 1,
        oneCalleeCalls: 1,
        funFound: 1,
        funTotal: 1,
        callFound: 1,
        callTotal: 1
    });
});

test("tests/micro/client4", async () => {
    await runTest("tests/micro", "client4.js", {
        soundness: "tests/micro/client4.json",
        functionInfos: 4,
        moduleInfos: 3,
        numberOfFunctionToFunctionEdges: 3,
        oneCalleeCalls: 4,
        funFound: 3,
        funTotal: 3,
        callFound: 4,
        callTotal: 4
    });
});

test("tests/micro/client5", async () => {
    await runTest("tests/micro", "client5.js", {
        soundness: "tests/micro/client5.json",
        functionInfos: 3,
        moduleInfos: 3,
        numberOfFunctionToFunctionEdges: 3,
        oneCalleeCalls: 2,
        funFound: 3,
        funTotal: 3,
        callFound: 4,
        callTotal: 4
    });
});

test("tests/micro/client6", async () => {
    await runTest("tests/micro", "client6.js", {
        soundness: "tests/micro/client6.json",
        functionInfos: 0,
        moduleInfos: 2,
        numberOfFunctionToFunctionEdges: 0,
        oneCalleeCalls: 0,
        funFound: 0,
        funTotal: 0,
        callFound: 0,
        callTotal: 0
    });
});

test("tests/micro/client8", async () => {
    options.ignoreDependencies = true;
    await runTest("tests/micro", "client8.js", {
        patterns: ["tests/micro/patterns8.json"],
        functionInfos: 0,
        moduleInfos: 1,
        matches: {total: 1}
    });
});

test("tests/micro/arrays", async () => {
    await runTest("tests/micro", "arrays.js", {
        soundness: "tests/micro/arrays.json",
        functionInfos: 4,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 4,
        oneCalleeCalls: 1,
        funFound: 3,
        funTotal: 3,
        callFound: 3,
        callTotal: 3
    });
});

test("tests/micro/arrays2", async () => {
    await runTest("tests/micro", "arrays2.js", {
        soundness: "tests/micro/arrays2.json",
        functionInfos: 6,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 6,
        oneCalleeCalls: 4,
        funFound: 5,
        funTotal: 5,
        callFound: 6,
        callTotal: 6
    });
});

test("tests/micro/iterators", async () => {
    await runTest("tests/micro", "iterators.js", {
        soundness: "tests/micro/iterators.json",
        functionInfos: 25,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 41,
        oneCalleeCalls: 13,
        funFound: 22,
        funTotal: 22,
        callFound: 43,
        callTotal: 43
    });
});

test("tests/micro/more1", async () => {
    await runTest("tests/micro", "more1.js", {
        soundness: "tests/micro/more1.json",
        functionInfos: 19,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 15,
        oneCalleeCalls: 2,
        funFound: 14,
        funTotal: 20,
        callFound: 20,
        callTotal: 29
    });
});

test("tests/micro/generators", async () => {
    await runTest("tests/micro", "generators.js", {
        soundness: "tests/micro/generators.json",
        functionInfos: 23,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 26,
        oneCalleeCalls: 14,
        funFound: 15,
        funTotal: 15,
        callFound: 15,
        callTotal: 15
    });
});

test("tests/micro/arguments", async () => {
    await runTest("tests/micro", "arguments.js", {
        soundness: "tests/micro/arguments.json",
        functionInfos: 7,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 7,
        oneCalleeCalls: 6,
        funFound: 7,
        funTotal: 8,
        callFound: 6,
        callTotal: 8
    });
});

test("tests/micro/destructuring", async () => {
    await runTest("tests/micro", "destructuring.js", {
        soundness: "tests/micro/destructuring.json",
        functionInfos: 11,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 10,
        oneCalleeCalls: 11,
        funFound: 7,
        funTotal: 9,
        callFound: 10,
        callTotal: 12
    });
});

test("tests/micro/ts", async () => {
    options.ignoreDependencies = true;
    await runTest("tests/micro", "ts.ts", {
        patterns: ["tests/micro/ts-patterns.json"],
        matches: {total: 1}
    });
});

test("tests/micro/globals", async () => {
    await runTest("tests/micro/globals", ["sample/app.js", "lib1/lib.js"], {
        functionInfos: 2,
        moduleInfos: 2,
        numberOfFunctionToFunctionEdges: 2,
        oneCalleeCalls: 2
    });
});

test("tests/micro/oneshot", async () => {
    await runTest("tests/micro", "oneshot.js", {
        soundness: "tests/micro/oneshot.json",
        functionInfos: 2,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 1,
        oneCalleeCalls: 1,
        funFound: 1,
        funTotal: 1,
        callFound: 1,
        callTotal: 1
    });
});

test("tests/micro/low", async () => {
    options.ignoreDependencies = true;
    await runTest("tests/micro", "low.ts", {
        patterns: ["tests/micro/lowpatterns.json"],
        functionInfos: 0,
        moduleInfos: 1,
        matches: {total: 3, low: 1}
    })
});

test("tests/micro/fun", async () => {
    await runTest("tests/micro", "fun.js", {
        soundness: "tests/micro/fun.json",
        functionInfos: 4,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 1,
        oneCalleeCalls: 1,
        funFound: 1,
        funTotal: 3,
        callFound: 1,
        callTotal: 3
    });
});

test("tests/micro/obj", async () => {
    await runTest("tests/micro", "obj.js", {
        soundness: "tests/micro/obj.json",
        functionInfos: 1,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 1,
        oneCalleeCalls: 1,
        funFound: 1,
        funTotal: 1,
        callFound: 1,
        callTotal: 1
    });
});

test("tests/micro/mix", async () => {
    await runTest("tests/micro", "mix.js", {
        soundness: "tests/micro/mix.json",
        functionInfos: 3,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 3,
        oneCalleeCalls: 3,
        funFound: 3,
        funTotal: 3,
        callFound: 3,
        callTotal: 3
    });
});

test("tests/micro/templateliterals", async () => {
    await runTest("tests/micro", "templateliterals.js", {
        soundness: "tests/micro/templateliterals.json",
        functionInfos: 5,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 5,
        oneCalleeCalls: 5,
        funFound: 4,
        funTotal: 4,
        callFound: 3,
        callTotal: 4
    });
});

test("tests/micro/rest", async () => {
    await runTest("tests/micro", "rest.js", {
        soundness: "tests/micro/rest.json",
        functionInfos: 21,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 21,
        oneCalleeCalls: 18,
        funFound: 17,
        funTotal: 19,
        callFound: 21,
        callTotal: 23
    });
});

test("tests/micro/rest2", async () => {
    await runTest("tests/micro", "rest2.js", {
        soundness: "tests/micro/rest2.json",
        functionInfos: 2,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 2,
        oneCalleeCalls: 2,
        funFound: 2,
        funTotal: 2,
        callFound: 2,
        callTotal: 2
    });
});

test("tests/micro/rxjs", async () => {
    options.ignoreUnresolved = true;
    await runTest("tests/micro", "rxjs1.js", {
        patterns: ["tests/micro/rxjs.json"],
        functionInfos: 1,
        moduleInfos: 2,
        matches: {total: 1}
    });
});

test("tests/micro/import1", async () => {
    await runTest("tests/micro", "import1.mjs", {
        functionInfos: 5,
        moduleInfos: 3,
        numberOfFunctionToFunctionEdges: 5,
        oneCalleeCalls: 5
    });
});

test("tests/micro/import3", async () => {
    await runTest("tests/micro", "import3.mjs", {
        functionInfos: 2,
        moduleInfos: 4,
        numberOfFunctionToFunctionEdges: 2,
        oneCalleeCalls: 2
    });
});

test("tests/micro/import7", async () => {
    options.ignoreDependencies = true;
    await runTest("tests/micro", "import7.mjs", {
        patterns: ["tests/micro/patterns7.json"],
        functionInfos: 0,
        moduleInfos: 2,
        matches: {total: 2}
    });
});

test("tests/micro/import9", async () => {
    await runTest("tests/micro", "import9.mjs", {
        functionInfos: 2,
        moduleInfos: 2,
        numberOfFunctionToFunctionEdges: 2,
        oneCalleeCalls: 2
    });
});

test("tests/micro/import10", async () => {
    await runTest("tests/micro", "import10.mjs", {
        functionInfos: 1,
        moduleInfos: 3,
        numberOfFunctionToFunctionEdges: 1,
        oneCalleeCalls: 1
    });
});

test("tests/micro/import11", async () => {
    options.ignoreDependencies = true;
    await runTest("tests/micro", "import11.mjs", {
        patterns: ["tests/micro/patterns11.json"],
        functionInfos: 0,
        moduleInfos: 1,
        matches: {total: 2}
    });
});

test("tests/micro/this", async () => {
    await runTest("tests/micro", "this.js", {
        functionInfos: 5,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 4,
        oneCalleeCalls: 4
    });
});


test("tests/micro/prototypes", async () => {
    await runTest("tests/micro", "prototypes.js", {
        functionInfos: 2,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 1,
        oneCalleeCalls: 1
    });
});

test("tests/micro/prototypes2", async () => {
    await runTest("tests/micro", "prototypes2.js", {
        soundness: "tests/micro/prototypes2.json",
        functionInfos: 1,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 1,
        oneCalleeCalls: 1
    });
});

test("tests/micro/match1", async () => {
    options.ignoreDependencies = true;
    await runTest("tests/micro", "match1.js", {
        patterns: ["tests/micro/match1-patterns.json"],
        matches: {total: 1}
    });
});

test("tests/micro/match2", async () => {
    options.ignoreDependencies = true;
    await runTest("tests/micro", "match2.js", {
        patterns: ["tests/micro/match2-patterns.json"],
        matches: {total: 1}
    });
});

test("tests/micro/match3", async () => {
    options.ignoreDependencies = true;
    await runTest("tests/micro", "match3.js",  {
        patterns: ["tests/micro/match3-patterns.json"],
        matches: {total: 1}
    });
});

test("tests/micro/match4", async () => {
    options.ignoreDependencies = true;
    await runTest("tests/micro", "match4.js",  {
        patterns: ["tests/micro/match4-patterns.json"],
        matches: {total: 1}
    });
});

test("tests/micro/match5", async () => {
    options.ignoreDependencies = true;
    await runTest("tests/micro", "match5.js",  {
        patterns: ["tests/micro/match5-patterns.json"],
        matches: {total: 4}
    });
});

test("tests/micro/match6", async () => {
    options.ignoreDependencies = true;
    await runTest("tests/micro", "match6.js",  {
        patterns: ["tests/micro/match6-patterns.json"],
        matches: {total: 1}
    });
});

test("tests/micro/match7", async () => {
    options.ignoreDependencies = true;
    await runTest("tests/micro", "match7.js",  {
        patterns: ["tests/micro/match7-patterns.json"],
        matches: {total: 4, low: 0}
    });
});

test("tests/micro/match8", async () => {
    options.ignoreDependencies = true;
    await runTest("tests/micro", "match8.ts",  {
        patterns: ["tests/micro/match8-patterns.json"],
        matches: {total: 1, low: 0}
    });
});

test("tests/micro/match9", async () => {
    options.ignoreDependencies = true;
    await runTest("tests/micro", "match9.ts",  {
        patterns: ["tests/micro/match9-patterns.json"],
        matches: {total: 1, low: 0}
    });
});

test("tests/micro/match10", async () => {
    options.ignoreDependencies = true;
    await runTest("tests/micro", "match10.ts",  {
        patterns: ["tests/micro/match10-patterns.json"],
        matches: {total: 1, low: 1}
    });
});

test("tests/micro/match11", async () => {
    options.ignoreDependencies = true;
    await runTest("tests/micro", "match11.ts",  {
        patterns: ["tests/micro/match11-patterns.json"],
        matches: {total: 2, low: 1} // TODO: high confidence match with filter is maybe?
    });
});

test("tests/micro/match12", async () => {
    options.ignoreDependencies = true;
    await runTest("tests/micro", "match12.ts",  {
        patterns: ["tests/micro/match12-patterns.json"],
        matches: {total: 1, low: 0} // FIXME: bad source location due to Babel transformation
    });
});

test("tests/micro/promises", async () => {
    options.callgraphNative = false;
    await runTest("tests/micro", "promises.js", {
        soundness: "tests/micro/promises.json",
        functionInfos: 40,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 25,
        oneCalleeCalls: 14,
        funFound: 24,
        funTotal: 28,
        callFound: 24,
        callTotal: 28
    });
});

test("tests/micro/promiseall", async () => {
    options.callgraphNative = false;
    await runTest("tests/micro", "promiseall.js", {
        soundness: "tests/micro/promiseall.json",
        functionInfos: 3,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 1,
        oneCalleeCalls: 1,
        funFound: 1,
        funTotal: 1,
        callFound: 1,
        callTotal: 1
    });
});

test("tests/micro/asyncawait", async () => {
    options.callgraphNative = false;
    await runTest("tests/micro", "asyncawait.js", {
        soundness: "tests/micro/asyncawait.json",
        functionInfos: 19,
        moduleInfos: 1,
        numberOfFunctionToFunctionEdges: 19,
        oneCalleeCalls: 10,
        funFound: 9,
        funTotal: 9,
        callFound: 9,
        callTotal: 9
    });
});

test("tests/micro/jsx", async () => {
    options.ignoreUnresolved = true;
    await runTest("tests/micro", "jsx.js", {
        apiUsageAccessPathPatternsAtNodes: 6
    });
});
