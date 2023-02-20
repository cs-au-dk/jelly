function f1() {}

const obj = {
    baz: undefined,
    get foo() {
        return this.baz;
    },
    set bar(x) {
        this.baz = x;
    }
}

obj.bar = f1;

const t1 = obj.foo;
t1();

