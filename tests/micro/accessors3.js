
const obj = {
    baz: () => { console.log("baz"); },
    set foo(v) {
        console.log("foo");
        this.baz();
    },
};

function getter() {
    console.log("getter");
    this.baz();
}

obj.foo = 123;

Object.defineProperty(obj, "foo", {set: getter});

Object.defineProperty(obj, "bar", {get: getter});

const x = obj.bar;
