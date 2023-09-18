
const old = require.extensions[".js"];
require.extensions[".js"] = function (m, filename) {
    console.log("Loading " + filename);
    old(m, filename);
};

require("./lib1.js")
