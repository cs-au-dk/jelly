
const o = {}, descr = { value: function() {} };
Object.defineProperties(o, {
    f: descr,
    g: descr,
});

o.f();
o.g();
