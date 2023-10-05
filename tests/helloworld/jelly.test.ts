import {runTest} from "../../src/testing/runtest";

jest.setTimeout(20000);

describe("tests/helloworld", () => {
    runTest("tests/helloworld", "app.js", {
        options: {callgraphExternal: false},
        soundness: "tests/helloworld/app.json",
        functionInfos: 775,
        moduleInfos: 94,
        numberOfFunctionToFunctionEdges: 1357,
        oneCalleeCalls: 976,
        funFound: 124,
        funTotal: 138,
        callFound: 184,
        callTotal: 204,
        reachableFound: 138,
        reachableTotal: 189,
    });
});
