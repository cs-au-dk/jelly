import {runTest} from "../../src/testing/runtest";

jest.setTimeout(20000);

describe("tests/helloworld", () => {
    runTest("tests/helloworld", "app.js", {
        soundness: "tests/helloworld/app.json",
        functionInfos: 775,
        moduleInfos: 94,
        numberOfFunctionToFunctionEdges: 899,
        oneCalleeCalls: 950,
        funFound: 114,
        funTotal: 138,
        callFound: 163,
        callTotal: 204,
        reachableFound: 140,
        reachableTotal: 189,
    });
});

describe("tests/helloworld-approx", () => {
    runTest("tests/helloworld", "app.js", {
        options: {approx: true},
        soundness: "tests/helloworld/app.json",
        functionInfos: 775,
        moduleInfos: 94,
        numberOfFunctionToFunctionEdges: 998,
        oneCalleeCalls: 1012,
        funFound: 136,
        funTotal: 138,
        callFound: 201,
        callTotal: 204,
        reachableFound: 185,
        reachableTotal: 189,
    });
});
