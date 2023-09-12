import {options, resetOptions} from "../../src/options";
import logger from "../../src/misc/logger";
import {runTest} from "../../src/testing/runtest";

beforeEach(() => {
    resetOptions();
    logger.transports[0].level = options.loglevel = "error";
});

test("tests/helloworld/app", async () => {
    options.callgraphExternal = false;
    await runTest("tests/helloworld", "app.js", {
        soundness: "tests/helloworld/app.json",
        functionInfos: 775,
        moduleInfos: 94,
        numberOfFunctionToFunctionEdges: 1355,
        oneCalleeCalls: 974,
        funFound: 124,
        funTotal: 138,
        callFound: 184,
        callTotal: 204,
        reachableFound: 138,
        reachableTotal: 189,
    });
}, 20000);
