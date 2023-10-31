
const obj = {
    baz: () => { console.log("baz"); },
    get foo() {
        console.log("foo");
        this.baz();
    },
};

const x = obj.foo;

function setter(v) {
    console.log("setter");
    this.baz();
}

Object.defineProperty(obj, "foo", {get: setter});

function doit(o, f) {
    Object.defineProperty(o, "bar", {set: setter});
    f(o);
}

function doit2(o) {
    o.bar = 123;
}

doit(obj, doit2);
