eval("console.log(42)");

var x = new Map();
x.set(1, function() {console.log("1")});
var y = x.get(1);
y();

var z = new Function("console.log(87)");
z();

var a = new Array();
a.push(function() {console.log("2")});
var b = a.pop();
b()

var c = Array.from([() => {console.log(3)}]);
c[0]();

