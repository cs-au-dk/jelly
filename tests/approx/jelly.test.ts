import {runTest} from "../../src/testing/runtest";
import fs from "fs";

/** Load approximate files generated from "generate-approx.sh" and perform a full soundness test on the app. */
function approxLoad(app: string) {
    const noExtension = app.split(".")[0];
    runTest("tests/approx", app, {
        options: {approxLoad: `tests/approx/hints-${noExtension}.json`},
        soundness: `tests/approx/${noExtension}.json`
    })
}

describe("approx", () => {
    approxLoad("simple.js");
    approxLoad("natives.js");
    approxLoad("dynamic.js")
    approxLoad("library.js")
    approxLoad("srcLoc.js")
    approxLoad("staticRequire.js")
    approxLoad("computedProperties.js")
    approxLoad("this.js")
    approxLoad("function.js")
    approxLoad("newNative.js")
    // Cannot guarantee 100% reachability due to unsupported rest operator in static phase
    runTest("tests/approx", "deconstruction.js", {
        options: {approxLoad: "tests/approx/hints-deconstruction.json"},
        soundness: "tests/approx/deconstruction.json",
        funFound: 9,
        funTotal: 9,
        callFound: 9,
        callTotal: 9,
        reachableFound: 10, // Missing reachable function related to spread operator(?)
        reachableTotal: 11
    })
})

function assertHints(name: string, expected: { modules: number, functions: number, reads: number, writes: number, evals?: number}) {
    const noExtension = name.split(".")[0];
    test(name, () => {
        let json = fs.readFileSync(`tests/approx/hints-${noExtension}.json`, "utf-8")
        let parsed = JSON.parse(json);
        expect(parsed.modules.length).toBe(expected.modules)
        expect(parsed.functions.length).toBe(expected.functions)
        expect(parsed.reads.length).toBe(expected.reads)
        expect(parsed.writes.length).toBe(expected.writes)
        if (expected.evals)
            expect(parsed.evals.length).toBe(expected.evals)
    })
}

/** Ensures the correct amount of entries in the hint file. Use this suite when call graph generation is non-trivial
 * (e.g., if testing sandbox where the dynamic call graph analysis will behave differently from
 * approximate interpretation due to monkey patching of functions, or if testing forced executions). */
describe("amount of hints", () => {
    assertHints("sandbox.js", {
        modules: 1,
        functions: 7,
        reads: 0,
        writes: 2
    });

    assertHints("forced.js", {
      modules: 1,
      functions: 14,
      reads: 0,
      writes: 11
    });

    assertHints("stdlib.js", {
        modules: 1,
        functions: 3,
        reads: 1,
        writes: 2,
    });

    assertHints("library.js", {
        modules: 2,
        functions: 3,
        reads: 5,
        writes: 3
    });

    assertHints("proxy.js", {
        modules: 1,
        functions: 7,
        reads: 1,
        writes: 2
    });

    assertHints("deconstruction.js", {
        modules: 1,
        functions: 12,
        reads: 0,
        writes: 7
    });

    assertHints("packageStructure.js", {
        modules: 2,
        functions: 7,
        reads: 1,
        writes: 3
    });

    // Cannot generate dynamic CFG for esm due to complications with NodeProf.
    assertHints("esm.mjs", {
        modules: 3,
        functions: 9,
        reads: 3,
        writes: 6
    });

    assertHints("ts-file.ts", {
        modules: 1,
        functions: 12,
        reads: 1,
        writes: 6
    });

    assertHints("asyncGenerator.js", {
        modules: 1,
        functions: 6,
        reads: 0,
        writes: 7
    });

    assertHints("newNative.js", {
        modules: 2,
        functions: 2,
        reads: 1,
        writes: 3,
        evals: 1
    });

    assertHints("hoist.js", {
        modules: 1,
        functions: 2,
        reads: 0,
        writes: 1,
        evals: 0
    });
})