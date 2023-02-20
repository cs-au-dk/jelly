var x = {a: function() { console.log("1"); }};
var f = function() {return this.a;}.bind(x);
f()();

function foo(b) {return b;}
var g = foo.call(null, () => { console.log("2"); })
g()
