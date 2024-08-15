class C {
    [f()]() { // this call belongs to C
        console.log("Hello World! from " + f()); // this call to f belongs to the method
    }

    bar(x = g()) { // this call belongs to C
        console.log("Hello " + g() + " from bar"); // this call to g belongs to the method
    }
}

function f() {
    return "foo";
}

function g() {
    return "World!";
}

var x = new C;
x.foo();
x.bar();
