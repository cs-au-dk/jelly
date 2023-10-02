import {runTest} from "../../src/testing/runtest";

jest.setTimeout(20000);

describe("tests/helloworld", () => {
    runTest("tests/helloworld", "app.js", {
        options: {callgraphExternal: false},
        soundness: "tests/helloworld/app.json",
        functionInfos: 775,
        moduleInfos: 94,
        numberOfFunctionToFunctionEdges: 1336,
        oneCalleeCalls: 950,
        funFound: 124,
        funTotal: 138,
        callFound: 184,
        callTotal: 204,
        reachableFound: 122,
        reachableTotal: 189,
    });
});
