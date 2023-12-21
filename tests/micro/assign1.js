
const o1 = Object.assign({}, {
    foo() { console.log("foo1"); },
}, {
    bar: undefined,
});

o1.foo();
o1.bar?.();

const o2 = Object.assign({}, {
    foo() { console.log("foo2"); },
}, {
    bar() { console.log("bar"); },
});

o2.foo();
o2.bar();
