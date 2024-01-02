
const lib = require("library");

lib.callback(function() {
    this.f = () => console.log("foo");
});

lib.callback(function() {
    this.f();
});
