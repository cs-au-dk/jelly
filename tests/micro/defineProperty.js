function f1() {}

function defProp() {
    const obj = {baz: undefined};
    Object.defineProperty(obj, "f", { value: f1 });
    Object.defineProperty(obj, "foo", {
        get() {
            return this.baz;
        },
    });
    Object.defineProperty(obj, "bar", {
        set(x) {
            this.baz = x;
        },
    });

    obj.f();

    obj.bar = f1;

    const t1 = obj.foo;
    t1();
}

function defProps() {
    const obj = {baz: undefined};
    Object.defineProperties(obj, {
        f: { value: f1 },
        foo: {
            get() {
                return this.baz;
            },
        },
        bar: {
            set(x) {
                this.baz = x;
            },
        }
    });

    obj.f();

    obj.bar = f1;

    const t1 = obj.foo;
    t1();
}

function create() {
    const obj = Object.create(null, {
        f: { value: f1 },
        foo: {
            get() {
                return this.baz;
            },
        },
        bar: {
            set(x) {
                this.baz = x;
            },
        }
    });

    obj.f();

    obj.bar = f1;

    const t1 = obj.foo;
    t1();
}

defProp();
defProps();
create();
