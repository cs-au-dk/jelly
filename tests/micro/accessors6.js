function f1() {}

const obj = {
    baz: undefined,
}

obj.__defineGetter__('foo', function() { return this.baz; });
obj.__defineSetter__('bar', function(x) { this.baz = x; });

obj.bar = f1;

const t1 = obj.foo;
t1();
