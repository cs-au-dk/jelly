
function Foo() {}

Foo.prototype = {
    foo() {
        console.log("foo1");
    },
};

const a = new Foo();
const b = Object.create(Object.getPrototypeOf(a));
b.foo();

Object.setPrototypeOf(b, {
    foo() {
        console.log("foo2");
    },
});

b.foo();


class Bar {
    static bar() {
        console.log("bar");
    };
};


const c = {__proto__: Bar};
c.bar();
