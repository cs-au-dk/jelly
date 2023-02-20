function f1() {}
f1();

const f2 = function() { return f1; };
f2();

let f3 = () => {};
f3();

function f4(x) {
    return x(f1);
}

f4(f4);

var t1 = { };
t1.f5 = () => {};
t1.f6 = t1.f5;
t1.f6();

class C1 {
    constructor() {
        f1();
    }
    f7(y) {
        return y();
    }
    f8 = () => {return f1;}
}

let t2 = new C1;

t2.f7(f2);
let t222 = t2.f8();

class C2 {
    f8() {}
}
let t3 = new C2;
t3.f8();

let C3 = class {
    constructor() {

    }
    f9() {}
};
let t4 = new C3;
t4.f9();

class C4 {
    constructor(x) {
        x();
    }
}

class C5 extends C4 {
    constructor(y) {
        super(y);
    }
}

const t5 = new C5(f1);

var F1 = function() {}
let t6 = new F1;

class C6 {
    static staticProperty = (f1(), function() {});
    static staticMethod() {
        return f1();
    }
    static {
        f1();
    }
    static {
        f1();
    }
}

C6.staticProperty();
C6.staticMethod();

class C {
    toString() { return "foo" };
}

let t7 = new C() + "bar"; // implicit call toString

const obj = {
    get property1() {},
    set property2(value) {},
    property3( parameters ) {},
    *generator4( parameters ) {},
    async property5( parameters ) {},
    async* generator6( parameters ) {},

    get ["property7"]() {},
    set ["property8"](value) {},
    ["property9"]( parameters ) {},
    *["generator10"]( parameters ) {},
    async ["property11"]( parameters ) {},
    async* ["generator12"]( parameters ) {},
};

function F10(x) {
    this.f11 = x;
}

let t8 = new F10(f1);
t8.f11();

let x12 = {
    f13() {},
    f14: () => {}
}
x12.f13();
x12.f13();

let C10 = class {
    f9() {}
};
let t40 = new C10;
t40.f9();

class C11 {
    f16() {}
}
class C12 extends C11 {
}
let t41 = new C12;
t41.f16();



function A(x) {
    this.f44 = x;
}

A.prototype.s1 = function () {
    return f2();
}
A.prototype.s2 = function () {
    return f2();
}

class D extends A {
    constructor(y) {
        super(y);
    }
    s1() {
        return f2();
    }
}

let d = new D(f2);
let t42 = d.s1();
let t43 = d.s2();
let t45 = d.f44();
