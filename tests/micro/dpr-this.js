
function Foo() { }

Foo.prototype.add = function(key, value) {
    this[key] = value;
};

Foo.prototype.get = function(key) {
    return this[key];
};

var foo = new Foo();
foo.add("bar", () => console.log("bar"));

const f = foo.get("bar");
f();
