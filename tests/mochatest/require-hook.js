require("pirates").addHook(
    (code, filename) => filename.endsWith("test.js")? `/* require-hook comment for: ${filename} */\n` + code : code
);
