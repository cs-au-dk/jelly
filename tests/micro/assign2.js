
const o = Object.assign({
    set foo(x) {
        console.log("set foo", x);
        this._foo = x;
    },
}, {
    get foo() {
        console.log("get foo 1");
        return this;
    },
}, Object.create({
    // properties on prototype are not transferred
    bar() { console.log("bar"); },
}, {
    foo: {
        get: function() {
            console.log("get foo 2");
            return this;
        },
        enumerable: true,
    },
}));

o.bar?.();
o._foo.bar();
