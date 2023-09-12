
function f() {}
function g() {}

const o1 = {f};
const o2 = Object(o1);
o2.g = g;

o1.f();
o1.g();
o2.f();
o2.g();

const o3 = Object("hello");
o3.f = f;
o3.f();
