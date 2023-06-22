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
        numberOfFunctionToFunctionEdges: 1397,
        oneCalleeCalls: 906,
        funFound: 181,
        funTotal: 200,
        callFound: 247,
        callTotal: 267
    });
}, 20000);
