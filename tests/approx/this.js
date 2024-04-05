/** Using this inside a function must track the allocation site of 'this' as the allocation site of the function. */
function Foo() {
    const name = "bar"
    this[name] = function () {}
}

const x = new Foo()
x.bar();

/** Likewise for usage of 'this' in classes. */
class A {
    property = "p"

    constructor(x) {
        this[this.property] = x
    }

    ["method"]() {
        this["f" + "oo"] = function () {}
    }
}

const a = new A(function () {
});
a.p();
a.method()
a.foo()


/** Overwriting the return value in a constructor produces allocation site of the returned value. */
function Bar() {
    const x = function baz() {}
    return x;
}

const b = new Bar();
b()

class B {
    constructor() {
        return function () {}
    }
}

new B()();

class C {
    constr = function constr() {
        let x = function () {}
        x["p" + "1"] = function () {}
        return x;
    }
}

const c = new C().constr();
c()
c.p1()

/** Calls to super is not necessarily the expression in a body. */
class D extends C {
    constructor() {
        const b = true;
        if (b) {
            super();
        }
        this["p" + "1"] = function () {}
    }
}

new D().p1();