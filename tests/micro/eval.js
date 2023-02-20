eval("console.log('HELLO')");

var x = new Function("console.log('WORLD')");
x();

require("./lib1")

function foo(x) {
    return x + 1;
}

console.log(eval("foo(2)"))
console.log(eval("(x => x + 1)(10)"))