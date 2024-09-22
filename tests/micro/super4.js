class A {
    constructor() {}
    m() {}
    static s() {}
}

function postMixin() {
    return class PostMixin extends A {
        constructor() {
            super();
        }
        m() {
            super.m();
        }
        w = super.m();
        eee = this;
        static fff = this;
        static s() {
            super.s();
        }
        static {
            super.s();
        }
        static q = super.s();
    }
}

var a = postMixin();
var x = new a();
x.m();
a.s();
console.log(x.eee === x);
console.log(a.fff === a);
