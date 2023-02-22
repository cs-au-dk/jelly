import Solver from "../../src/analysis/solver";
import {options, resetOptions} from "../../src/options";
import {analyzeFiles} from "../../src/analysis/analyzer";
import logger from "../../src/misc/logger";
import {expand} from "../../src/misc/files";
import {compare} from "./compare";
import {preparePackage, packagesDir} from "./install";

beforeEach(async () => {
    // @ts-ignore
    let prevOpts = await import("jelly-previous/src/options");
    prevOpts.resetOptions();
    resetOptions();
    logger.transports[0].level = options.loglevel = "info";
});

describe("tiny", () => {
    test("simple", async () => {
        // we need ts-ignore when import from jelly-previous, otherwise we get compile error.
        // @ts-ignore
        const PrevSolver = (await import("jelly-previous/src/analysis/solver")).default;
        // @ts-ignore
        const prevOptions = (await import("jelly-previous/src/options")).options;
        // @ts-ignore
        const prevAnalyzeFiles = (await import("jelly-previous/src/analysis/analyzer")).analyzeFiles;
        let packageName = "simple";
        options.basedir = prevOptions.basedir = `${__dirname}/simple`;
        const app = "application.js";
        options.callgraphRequire = options.callgraphImplicit = options.callgraphNative =
            prevOptions.callgraphRequire = prevOptions.callgraphImplicit = prevOptions.callgraphNative = true; // TODO: remove eventually (also below)
        // options.bottomUp = true;
        const solver = new Solver();
        await analyzeFiles([app], solver);
        const oldSolver = new PrevSolver();
        await prevAnalyzeFiles([app], oldSolver);
        compare(oldSolver, solver, packageName);
    });
});

describe("small", () => {
    let typedDB: Array<{ name: string, version: string }> = require("./small.json");
    test.each(typedDB)(`$name:$version`, async ({name, version}) => {
            // @ts-ignore
            const PrevSolver = (await import("jelly-previous/src/analysis/solver")).default;
            // @ts-ignore
            const prevOptions = (await import("jelly-previous/src/options")).options;
            // @ts-ignore
            const prevAnalyzeFiles = (await import("jelly-previous/src/analysis/analyzer")).analyzeFiles;
            preparePackage(name, version);
            options.basedir = prevOptions.basedir =
                `${packagesDir}/${name.replace("@", "").replace("/", "-")}/${version}`;
            const files = expand(options.basedir);
            options.callgraphRequire = options.callgraphImplicit = options.callgraphNative =
                prevOptions.callgraphRequire = prevOptions.callgraphImplicit = prevOptions.callgraphNative = true;
            // options.bottomUp = true;
            const solver = new Solver();
            await analyzeFiles(files, solver);
            const oldSolver = new PrevSolver();
            await prevAnalyzeFiles(files, oldSolver);
            compare(oldSolver, solver, name);
        }
    );
});

describe("large", () => {
    let typedDBfull: Array<{ name: string, version: string }> = require("./large.json");
    test.each(typedDBfull)(`$name:$version`, async ({name, version}) => {
            // @ts-ignore
            const PrevSolver = (await import("jelly-previous/src/analysis/solver")).default;
            // @ts-ignore
            const prevOptions = (await import("jelly-previous/src/options")).options;
            // @ts-ignore
            const prevAnalyzeFiles = (await import("jelly-previous/src/analysis/analyzer")).analyzeFiles;
            preparePackage(name, version);
            options.basedir = prevOptions.basedir =
                `${packagesDir}/${name.replace("@", "").replace("/", "-")}/${version}`;
            const files = expand(options.basedir);
            options.callgraphRequire = options.callgraphImplicit = options.callgraphNative =
                prevOptions.callgraphRequire = prevOptions.callgraphImplicit = prevOptions.callgraphNative = true;
            // options.bottomUp = true;
            const solver = new Solver();
            await analyzeFiles(files, solver);
            const oldSolver = new PrevSolver();
            await prevAnalyzeFiles(files, oldSolver);
            compare(oldSolver, solver, name);
        }
    );
});
