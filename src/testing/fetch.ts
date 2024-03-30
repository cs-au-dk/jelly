// fetches repos for call graph experiments

import fs from "fs";
import {execSync} from "child_process";
import {sep} from "path";

const reposFile = process.argv[2];
const installDir = process.argv[3];
if (!reposFile || !installDir) {
    console.error("Error: Missing argument");
    process.exit(-1);
}

fs.mkdirSync(installDir, { recursive: true });
console.log(`Reading ${reposFile}`);
const j = JSON.parse(fs.readFileSync(reposFile, "utf8")) as Array<{github_repo: string, branch: string}>;
let i = 0;
for (const entry of j) {
    try {
        if (!entry.github_repo || !entry.branch) {
            console.error(`github_repo or branch not found in ${reposFile}`);
            process.exit(-1);
        }
        console.log(`Installing (${++i}/${j.length}) ${entry.github_repo} in ${installDir}`);
        execSync(`git clone --depth 1 --branch ${entry.branch} https://github.com/${entry.github_repo} ${entry.github_repo} -q`,
            { cwd: installDir, encoding: "utf8", stdio: "inherit" });
        execSync(`npm install --ignore-scripts`,
            { cwd: `${installDir}${sep}${entry.github_repo}`, encoding: "utf8", stdio: "inherit" });
    } catch (e) {
        console.error(e);
    }
}
