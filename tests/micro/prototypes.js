function C() {}

C.prototype = {
    foo: function () {}
}

var v = new C();
v.foo();
