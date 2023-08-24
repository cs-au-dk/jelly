const { execPath } = require("process");
const { spawnSync } = require("child_process");

spawnSync(execPath, ["index.js"], {
    cwd: "sub",
});
