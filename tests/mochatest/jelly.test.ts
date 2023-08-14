import {options, resetOptions} from "../../src/options";
import logger from "../../src/misc/logger";
import {runTest} from "../../src/testing/runtest";

describe("tests/mochatest", () => {
    beforeEach(() => {
        resetOptions();
        logger.transports[0].level = options.loglevel = "error";
    });

    test("normal", async () => {
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

    test("with-require-hook", async () => {
        options.callgraphExternal = false;
        await runTest("tests/mochatest", ["test.js", "require-hook.js"], {
            soundness: "tests/mochatest/test-with-hook.json",
            functionInfos: 14,
            moduleInfos: 4,
            numberOfFunctionToFunctionEdges: 9,
            oneCalleeCalls: 10,
            funFound: 5,
            funTotal: 5,
            callFound: 6,
            callTotal: 6,
            reachableFound: 6,
            reachableTotal: 12
        });
    });
});
