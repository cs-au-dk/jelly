
const lib = require("library");

lib.array.map(i => console.log(i));

lib.callback(a =>
    a.map(i => console.log(i)));
