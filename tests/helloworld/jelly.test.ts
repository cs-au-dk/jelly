import {runTest} from "../../src/testing/runtest";

jest.setTimeout(20000);

describe("tests/helloworld", () => {
    runTest("tests/helloworld", "app.js", {
        options: {callgraphExternal: false},
        soundness: "tests/helloworld/app.json",
        functionInfos: 775,
        moduleInfos: 94,
        numberOfFunctionToFunctionEdges: 1398,
        oneCalleeCalls: 907,
        funFound: 129,
        funTotal: 138,
        callFound: 194,
        callTotal: 204,
        reachableFound: 122,
        reachableTotal: 189,
    });
});
