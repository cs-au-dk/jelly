// runs Jelly on all packages listed as dependencies in a given package.json file

// usage example:
// NODE_OPTIONS=--max-old-space-size=4096 node lib/testing/runner.js ../jelly-benchmarks/data/top100/package.json tmp/top100-results.json 60 ignoreDependencies

import fs, {readFileSync} from "fs";
import {options} from "../options";
import {analyzeFiles} from "../analysis/analyzer";
import {dirname} from "path";
import {expand, writeStreamedStringify} from "../misc/files";
import logger, {setLogLevel} from "../misc/logger";
import AnalysisDiagnostics from "../analysis/diagnostics";
import {AnalysisStateReporter} from "../output/analysisstatereporter";
import Solver from "../analysis/solver";

const jsonFile = process.argv[2];
const outFile = process.argv[3];
const timeout = Number(process.argv[4]);
const ignoreDependencies = process.argv[5] === "ignoreDependencies";
if (!jsonFile || !outFile || !timeout) {
    console.error("Error: Missing argument");
    process.exit(-1);
}

(async function() {
    const f = JSON.parse(readFileSync(jsonFile, {encoding: "utf8"}));
    let count = 0;
    const packages = Object.keys(f.dependencies);
    const results: { [index: string]: AnalysisDiagnostics } = {};
    for (const d of packages) {
        setLogLevel("info");
        logger.info(`Analyzing package ${d} (${++count}/${packages.length})`);
        options.basedir = dirname(jsonFile);
        options.ignoreDependencies = ignoreDependencies;
        options.tty = false;
        options.warningsUnsupported = false;
        options.timeout = timeout;
        setLogLevel("warn");
        const solver = new Solver();
        await analyzeFiles(expand([`${options.basedir}/node_modules/${d}`]), solver);
        results[d] = solver.diagnostics;
        setLogLevel("verbose");
        new AnalysisStateReporter(solver.fragmentState).reportLargestTokenSets();
    }
    const fd = fs.openSync(outFile, "w");
    writeStreamedStringify(results, fd, undefined, 2);
    fs.closeSync(fd);
})();