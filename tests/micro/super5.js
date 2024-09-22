class A {
    constructor() {
        this.qqq = () => {console.log("qqq")};
    }
    m() {
        this.www = () => {console.log("www")};
    }
}

function b() {
    return class B extends A {
        constructor() {
            super();
            (() => {
                super.m();
            })();
        }
    }
}

var a = b();
var c = new a();
c.qqq();
c.www();
