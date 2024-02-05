var x = {a: function() { console.log("1"); }};
var f = function() {return this.a;}.bind(x);
f()();

function foo(b) {return this(b);}
(foo.call((a) => a, () => { console.log("2"); }))();

function bar(c) {return this(c);}
function baz() {
    return bar.apply((d) => d, arguments);
}
var q = baz(() => { console.log("3"); });
q();
function baz2(...args) {
    return bar.apply((d) => d, args);
}
var q2 = baz2(() => { console.log("4"); });
q2();
function baz3(a) {
    return bar.apply((d) => d, [a]);
}
var q3 = baz3(() => { console.log("5"); });
q3();
(baz3(() => { console.log("5"); })());
function baz4(f) {
    const a = [];
    a.push(f);
    return bar.apply((d) => d, a);
}
var q4 = baz4(() => { console.log("6"); });
q4();
