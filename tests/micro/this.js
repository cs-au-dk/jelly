var x = {
    p: function() {
        return this.q;
    },
    q: function() {
      console.log("1");
    }
}
var t = x.p()
t();

function f() {}
f.g = function() {
    console.log("2");
}
f.h = function() {
    this.g();
}
f.h();

const o = {
    foo() {
        return () => this.bar();
    },
    bar() {
        console.log("3");
    },
};
const l = o.foo();
l();
