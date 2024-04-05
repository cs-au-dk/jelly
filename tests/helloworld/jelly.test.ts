import {runTest} from "../../src/testing/runtest";

jest.setTimeout(20000);

describe("tests/helloworld", () => {
    runTest("tests/helloworld", "app.js", {
        options: {callgraphExternal: false, proto: true},
        soundness: "tests/helloworld/app.json",
        functionInfos: 775,
        moduleInfos: 94,
        numberOfFunctionToFunctionEdges: 861,
        oneCalleeCalls: 930,
        funFound: 115,
        funTotal: 138,
        callFound: 165,
        callTotal: 204,
        reachableFound: 138,
        reachableTotal: 189,
    });
});

describe("tests/helloworld-approx", () => {
    runTest("tests/helloworld", "app.js", {
        options: {callgraphExternal: false, proto: true, approx: true},
        soundness: "tests/helloworld/app.json",
        functionInfos: 775,
        moduleInfos: 94,
        numberOfFunctionToFunctionEdges: 941,
        oneCalleeCalls: 988,
        funFound: 136,
        funTotal: 138,
        callFound: 201,
        callTotal: 204,
        reachableFound: 168,
        reachableTotal: 189,
    });
});
