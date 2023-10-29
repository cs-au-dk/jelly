class A {
    constructor(x) {
        x();
    }
    m() {
        console.log("A.m");
    }
    static s() {
        console.log("A.s");
    }
    static f = () => {
        console.log("A.f");
    }
}

class B extends A {
    constructor() {
        super(() => {
            console.log("c");
        });
        console.log(B.__proto__ === A);
        super.m();
        console.log(super.m === B.prototype.__proto__.m);
    }
    m() {
        console.log("B.m");
        super.m();
        console.log(super.m === B.prototype.__proto__.m);
    }
    static s() {
        console.log("B.s");
        super.s();
        console.log(super.s === this.__proto__.s);
    }
    static g = super.f;
    static {
        super.f();
        console.log(super.f === this.__proto__.f);
    }
}

var x = new B();
x.m();
B.s();
B.g();

var q1 = {
    m1() {
        console.log("q1.m1");
    }
}
var q2 = {
    m2() {
        console.log("q2.m2");
        super.m1();
        console.log(super.m1 === this.__proto__.m1);
    }
}
Object.setPrototypeOf(q2, q1);
q2.m2();
var q3 = {
    m3() {
        console.log("q3.m3");
        super.m1();
        console.log(super.m1 === this.__proto__.m1);
    }
}
q3.__proto__ = q1;
q3.m3();
