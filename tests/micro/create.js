const proto1 = Object.create(null, {
    g: { value: () => console.log("in g") },
});

const proto2 = Object.create(proto1, {
    f: { value: () => console.log("in f") },
});

const o = Object.create(proto2);
o.f();
o.g();
