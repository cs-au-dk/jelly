var lib = require("foolib");

var foo = "foo";
var bar = "bar";

var x = {};
x[foo] = () => {console.log("!")};
var t = x[foo];
t();

lib[bar](x);