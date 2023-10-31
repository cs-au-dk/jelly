import {runTest} from "../../src/testing/runtest";

jest.setTimeout(20000);

describe("tests/helloworld", () => {
    runTest("tests/helloworld", "app.js", {
        options: {callgraphExternal: false, proto: true},
        soundness: "tests/helloworld/app.json",
        functionInfos: 775,
        moduleInfos: 94,
        numberOfFunctionToFunctionEdges: 1449,
        oneCalleeCalls: 915,
        funFound: 130,
        funTotal: 138,
        callFound: 196,
        callTotal: 204,
        reachableFound: 122,
        reachableTotal: 189,
    });
});
