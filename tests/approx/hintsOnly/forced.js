function initialize() { // Simple forced execution
    const methods = ["get", "set"]
    let x = {}
    for (const m of methods)
        x[m] = function () {console.log(m)}

    x.get();
    x.set();
    return x;
}

function requiresProxyArgs(x, y) { // Proxy arguments must be provided to ensure minimal loss of hints.
    x.action();
    y.other.action();
    x.might.have().a.very().long().chain.of.accesses().and.calls()
    let a = {}
    a["p"+"rop"] = function () {}
    a.prop();
}

function coercions(arg1, arg2) { // Coercions of arguments must be supported
    const x = {}

    const asNumbers = arg1+(arg2 - arg2*arg2 / Math.pow(2, arg2))
    x["p" + "1"] = function () {}
    x.p1()

    const asStringConcat = arg1+arg2;
    asStringConcat.slice(1, 2)
    x["p" + "2"] = function () {}
    x.p2()

    const coercion = arg1 + x;
    const coercion2 = [] + arg1 + (x / arg2)

    x["p" + "3"] = function () {}
    x.p3();
}
// Forced execution of constructors must occur as well.
class A {
    constructor() {
        const x = {}
        x["p" + "rop"] = {}
    }
}

function Foo() {}
const properties = ["a", "b"]
properties.forEach(p => {
    Foo.prototype[p] = function(x) {
        const a = {}
        a["p"] = {}
    }
})

// Forced execution uses observed property writes to bound 'this'. If this was not the case, 'this' would be a proxy
// and thereby produce no hints.
let t = {}
t.p = function foo() {
    const f = "f"
    console.log(this)
    this[f] = () => {
        console.log(this)
    }
}