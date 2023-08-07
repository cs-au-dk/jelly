import {options, resetOptions} from "../../src/options";
import logger from "../../src/misc/logger";
import {runTest} from "../../src/testing/runtest";

beforeEach(() => {
    resetOptions();
    logger.transports[0].level = options.loglevel = "error";
});

test("tests/mochatest", async () => {
    options.callgraphExternal = false;
    await runTest("tests/mochatest", "test.js", {
        soundness: "tests/mochatest/test.json",
        functionInfos: 5,
        moduleInfos: 2,
        numberOfFunctionToFunctionEdges: 3,
        oneCalleeCalls: 3,
        funFound: 3,
        funTotal: 3,
        callFound: 3,
        callTotal: 3,
        reachableFound: 2,
        reachableTotal: 7
    });
});
