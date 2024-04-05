
/** Simple dynamic read/write on object literals. */
var x1 = {};
var x2 = {f: function () {}}

const prop = "qwe";
const f = "f";

x1[prop] = x2;      // Dynamic write
var temp = x2[f];   // Dynamic read
temp();
x2[f]()             // Dynamic read with call expression as parent (fixed bug)
x1.qwe.f();

/** Simple dynamic read/write on functions */

function Foo() {}
var x3 = () => {}
//
// Write/Read for Arrow and Normal function
x3[prop] = Foo;
Foo[prop] = x3;
Foo[prop]()
x3[prop]();

const prop2 = "p2"

/** "new" constructs */
class A {}

let x4 = new Foo();
const x5 = new A();
x4[prop2] = x3;
x4.p2();
x5[prop2] = x4;
x5[prop2][prop2]();

/** Object literal and Class creation with dynamic properties */
var x6 = {
    p1: function () {}, // Statically known property name
    [prop2]: function () {}, // Dynamically computed ObjectProperty
    ["p" + "3"]: function () {} // Dynamically computed ObjectProperty with string value
}

class C {
     ["my" + "Function"] () {} // Dynamic method declaration - impossible to track using NodeProf.
}

x6.p2();
x6.p3();
new C().myFunction();


/** Getter/Setter declarations. */
class D {
    get  ["ba" + "z"]() {} // Computed with non-string literal expression
    set ["q" + "w" + "e" + "Set"](x) {} // Dynamic setter
}
var x7 = new D;
// Function call to corresponding setter function
x7.baz;
x7.qweSet = x6;


/** Operations involving objects from classes or new-constructs */
class E {}
class F extends E {
    constructor() {
        super();
    }
}

var x8 = new Foo();
var x9 = new F;
x8[prop] = x9;
x9[prop] = x2[f]
x9.qwe()

/** Calls to super within methods. */
class A1 {
    getProperty() {
        return "p";
    }
}
class B1 extends A1 {
    setProperty(val) {
        this[super.getProperty()] = val;
    }
}

const b = new B1();
const val = function foo() {}
b.setProperty(val)
b.p();

/** Optionals - ensure non-crashing behaviour. */
const x = {}
x.nonExistent?.()
x.alsoNonExistent?.property;
x["p" + "1"] = function() {}
x.p1();