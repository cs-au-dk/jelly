class A {
    m() {
        var amthis = this; // amthis === x
        console.log("Am", amthis);
    }
    static s() {
        var asthis = this; // asthis === B
        console.log("As", asthis);
    }
}

class B extends A {
    m() {
        super.m();
        var bmthis = this; // bmthis === x
        console.log("Bm", bmthis);
        super.foo = () => {}; // behaves like this.foo = ...
    }
    static s() {
        super.s();
        var bsthis = this; // bsthis === B
        console.log("Bs", bsthis);
    }
}

var x = new B();
x.m();
B.s();
console.log(x.hasOwnProperty("foo"));
