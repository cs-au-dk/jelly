import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as process from "node:process";
import { execFileSync } from "node:child_process";

import { CallGraph } from "../../src/typings/callgraph";
import { merge } from "../../src/output/merge";

describe("tests/dynamic", () => {
  describe("wrapper", () => {
    let tmpDir: string;
    beforeAll(async () => {
      // Set up a mocked GRAAL_HOME that fools bin/node
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jelly-test-dynamic-"));
      const binPath = path.join(tmpDir, "bin");
      await fs.mkdir(binPath);
      await fs.writeFile(
        path.join(binPath, "node"),
        '#!/usr/bin/env bash\necho "$@"\n',
        { mode: 0o777 }
      );

      const nodeprofPath = path.join(tmpDir, "tools", "nodeprof");
      await fs.mkdir(nodeprofPath, { recursive: true });
      await (await fs.open(path.join(nodeprofPath, "jalangi.js"), "a")).close();
    });

    afterAll(async () => {
      await fs.rm(tmpDir, { recursive: true });
    });

    test.each(["help", "version", "v8-options", "experimental-modules"])(
      "wrapper handles --%p",
      (parameter: string) => {
        const output = execFileSync("bin/node", [`--${parameter}`, "positional"], {
          encoding: "utf8",
          env: {
            ...process.env,
            GRAAL_HOME: tmpDir,
          },
        });

        expect(output).toMatch(new RegExp(`^--${parameter}\\b.*--nodeprof.*--analysis.*\\bpositional$`, "m"));
      });

    test("wrapper disables nodeprof on --eval", () => {
        const output = execFileSync("bin/node", ["--experimental-modules", "--eval", "console.log(123)", "positional"], {
          encoding: "utf8",
          env: {
            ...process.env,
            GRAAL_HOME: tmpDir,
          },
        });

        expect(output).toBe("--experimental-modules --eval console.log(123) positional\n");
    });
  });

  describe("merge call graphs", () => {
    test("simple", () => {
      const cgA: CallGraph = {
        entries: [],
        time: "foobar",
        files: ["a.js"],
        functions: ["0:1:1:2:1"],
        calls: ["0:1:5:1:10"],
        fun2fun: [],
        call2fun: [],
        ignore: [],
      };

      const cgB: CallGraph = {
        entries: [],
        files: ["b.js"],
        functions: ["0:1:1:2:1"],
        calls: ["0:1:5:1:10"],
        fun2fun: [],
        call2fun: [],
        ignore: ["0:1:1:2:1"],
      };

      expect(merge([cgA, cgB])).toStrictEqual({
        entries: [],
        time: "foobar",
        files: ["a.js", "b.js"],
        functions: ["0:1:1:2:1", "1:1:1:2:1"],
        calls: ["0:1:5:1:10", "1:1:5:1:10"],
        fun2fun: [],
        call2fun: [],
        ignore: ["1:1:1:2:1"],
      });
    });

    test("deduplication", () => {
      const cgA: CallGraph = {
          entries: [],
          files: ["a.js"],
          functions: ["0:1:1:2:1"],
          calls: ["0:1:5:1:10"],
          fun2fun: [[0, 0]],
          call2fun: [[0, 0]],
          ignore: [],
      };

      expect(merge([cgA, cgA])).toStrictEqual(cgA);
    });
  });
});
