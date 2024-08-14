class C {
    [f()]() { // this call belongs to the top-level module code
        console.log("Hello World! from " + f()); // this call to f belongs to the 'foo' method
    }

    bar(x = g()) { // this call belongs to the 'bar' method
        console.log("Hello " + g() + " from bar"); // this call to g belongs to the 'bar' method
    }

    baz = h() // this call belongs to the C constructor

    static qux = i() // this call belongs to the top-level module code
}

function f() {
    return "foo";
}

function g() {
    return "World!";
}

function h() {}

function i() {}

var x = new C;
x.foo();
x.bar();
