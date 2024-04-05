/** Spread/Rest and object destruction patterns in known code must survive transformation. */
const p = "p"

function Destruct() {
    const x = {x1: function() {}, ["x2"]: {["x3"]: function(){}, x4: function() {}}}
    const prop = "f"
    x[prop] = function () {}
    return x;
}

/** Object deconstruction from a known object. */
const {x1, f, x2} = Destruct();
x1()
x2.x3()
x2.x4()
f();

/** Ensure Rest and Spread operators work after code transformation. */

function Rest(x, ...y) {
    const res = x + y.reduce(function (acc, x) {
        acc += x;
        return acc;
    }, 0)
    console.log(res)
    var a = {}
    a[p] = function () {}
    a.p();
}

Rest(1, 2, 3, 4, 5,)

function Spread(x, y, z) {
    console.log(x+y+z)
    var a = {}
    a[p] = function () {}
    a.p();
}
const numbers = [1, 2, 3]
Spread(...numbers)


/** Destructing assignment for proxies. */
function ProxyDestruct({x, y}) {
    x.compareWith(y);
    // Ensure this hint is produced
    const a = {}
    a[p] = {}
}

/** Rest for proxies */
function ProxyRest(x, ...y) {
    x.processEach(y);
    const a = {}
    a[p] = {}
}