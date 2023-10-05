import fs from "fs";
import path from "path";
import assert from "assert";
import {runTest} from "../../src/testing/runtest";
import {expand} from "../../src/misc/files";
import {options} from "../../src/options";

describe("tests/npm-packages", () => {
    describe.each(Object.entries(JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf-8")).dependencies))(
        "%s/%s", (name: string) => {
            const pkgdir = path.join(__dirname, "node_modules", name);
            assert(fs.existsSync(pkgdir));

            options.basedir = "tests/npm-packages"; // for expand
            runTest("tests/npm-packages", expand(pkgdir), { });
        });
});
