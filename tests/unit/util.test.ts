import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {CallGraph} from "../../src/typings/callgraph";
import {locationIn, mapCallsToFunctions, SourceLocationsToJSON} from "../../src/misc/util";
import logger from "../../src/misc/logger";
import {options} from "../../src/options";

beforeAll(() => {
    logger.transports[0].level = options.loglevel = "error";
});

describe("tests/unit/util/mapCallsToFunctions", () => {
    function read(path: string): any {
        return JSON.parse(fs.readFileSync(path, {encoding: "utf-8"}));
    }

    const micro = path.resolve(__dirname, "..", "micro");
    const callgraphs: [string, CallGraph][] = [];
    for (const file of fs.readdirSync(micro, {encoding: "utf-8"})) {
        if (!file.endsWith(".json"))
            continue;

        const obj = read(path.join(micro, file));
        if (["entries", "files", "functions", "calls", "fun2fun", "call2fun"].every(
            field => field in obj))
            callgraphs.push([`micro/${file}`, obj as CallGraph]);
    }

    callgraphs.push(
        [
            "helloworld/app.json",
            read(path.resolve(__dirname, "..", "helloworld", "app.json")) as CallGraph,
        ],
        [
            "mochatest/test.json",
            read(path.resolve(__dirname, "..", "mochatest", "test.json")) as CallGraph,
        ],
        [
            "minimized",
            {
                files: ["file.min.js"],
                functions: ["0:1:1:5:1", "0:2:363:2:411"],
                calls: ["0:2:411:2:418"],
                fun2fun: [],
                call2fun: [],
            },
        ],
    );

    test.each(callgraphs)("sanity check: %s", (_, cg: CallGraph) => {
        const mapping = mapCallsToFunctions(cg);

        expect(mapping.size).toBe((cg.calls instanceof Array ? cg.calls : Object.keys(cg.calls)).length);

        const parser = new SourceLocationsToJSON(cg.files);

        for (const [call, fun] of mapping) {
            expect(call in cg.calls).toBeTruthy();
            expect(fun in cg.functions).toBeTruthy();

            const pcall = parser.parseLocationJSON(cg.calls[call]),
                pfun = parser.parseLocationJSON(cg.functions[fun]);
            assert(pcall.loc && pfun.loc);
            expect(pcall.fileIndex).toBe(pfun.fileIndex);
            expect(locationIn(pcall.loc, pfun.loc)).toBeTruthy();
        }
    });
});
