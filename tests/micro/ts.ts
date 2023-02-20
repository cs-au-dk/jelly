import {foo, Foo} from "lib";

const a: Foo = new Foo;
const b = "bar";
const c = () => {};
const d = "baz" as string;
const e = 42;
const f: number = 117;
foo(a, b, b, c, d, e, e, f);
