function F1() {
    this.q1 = () => {console.log("q1")};
}
F1.s1 = () => {console.log("s1")};
function F2() {
    this.q2 = () => {console.log("q2")};
}
F2.s2 = () => {console.log("s2")};
F2.prototype = new F1;
const x2 = new F2();
x2.q1();
x2.q2();
F1.s1();
F2.s2();

class D {
    constructor(a) {
        this.a1 = a;
    }
    b = () => {console.log("b")};
    c() {
        console.log("c")
    }
    static d() {
        console.log("d")
    }
}
const q1 = new D(
    function() {
        console.log("a1");
        this.a2 = () => {console.log("a2")};
    }
);
q1.a1();
q1.a2();
q1.b();
q1.c();
D.d();

class E {
    constructor(c) {
        this.cc = c;
    }
    e = this;
    static es = this;
    static {
        this.s1 = () => console.log("s1");
    }
    m1() {
        console.log("m1");
    }
    static n1() {
        console.log("n1");
    }
}
class G extends E {
    constructor(a, b) {
        super(a);
        this.bb = b;
    }
    g = this;
    static gs = this;
    static {
        this.s2 = () => console.log("s2");
    }
    m2() {
        console.log("m2");
    }
    static n2() {
        console.log("n2");
    }
}
let w1 = new G(
    () => {console.log("c1")},
    () => {console.log("b2")}
)
w1.cc();
w1.bb();
w1.e.cc();
w1.g.bb();
w1.m1();
w1.m2();
E.s1();
G.s1();
G.s2();
E.n1();
G.n2();
G.n1();
E.es.n1();
G.es.n1();
G.gs.n2();

class E2 {
    static {
        this.s1 = () => console.log("s1");
    }
}
let w2 = new E2
E2.s1();
class G2 extends E2 {
    static {
        this.s2 = () => console.log("s2");
    }
}
let w3 = new G2
E2.s1();
G2.s1();
G2.s2();

console.log("top-level this:", this, this === globalThis); // TODO: 'this' at top-level is bound to a fresh object (?)
this.kk = () => {console.log("kk")};

let k1 = {
    __proto__: {w: () => {console.log("__proto__")}},
    a1: () => {console.log("a1")},
    a2() {console.log("a2")},
    a3: this,
    a4() {
        return this;
    }
}
k1.a1();
k1.a2();
k1.a3.kk();
k1.a4().a2();
k1.w();

class E10 {
    static es = this;
    fs = this;
    m1() {console.log("m1")}
    static m2() {console.log("m2")}
}
const x10 = new E10
x10.fs.m1()
E10.es.m2();
