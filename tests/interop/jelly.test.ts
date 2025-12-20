import {runTest} from "../../src/testing/runtest";

describe("tests/interop", () => {

    describe("new", () => {

        runTest("tests/interop", "def.js", {
            numberOfCallToFunctionEdges: 2
        });

        runTest("tests/interop", "star.js", {
            numberOfCallToFunctionEdges: 5
        });

    });

    describe("old", () => {

        runTest("tests/interop", "def.js", {
            options: {interops: false},
            numberOfCallToFunctionEdges: 6
        });

        runTest("tests/interop", "star.js", {
            options: {interops: false},
            numberOfCallToFunctionEdges: 12
        });

    });
});