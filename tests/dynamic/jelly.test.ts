import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as process from "node:process";
import { execFileSync } from "node:child_process";

describe("dynamic analysis", () => {
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
