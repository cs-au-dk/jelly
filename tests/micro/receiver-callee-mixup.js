
const o1 = {
    f() { this.g(); },
    g() { console.log("foo"); },
};

const o2 = {
    f() { this.g(); },
    g() { console.log("bar"); },
};

(o1 || o2).f();
(o2 || o1).f();
