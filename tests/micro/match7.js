var foo = require("foo");
foo.bar;
foo.a.b.c.bar;

var baz = require("baz");
baz.bar;

var qux = require("qux");
qux.bar;

foo.a = qux.q.w.e.r;
