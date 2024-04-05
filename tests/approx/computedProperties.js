/** Computed property names at object/class creation should be interpreted as dynamic property writes. */

/** Object creation. */
// Field
let x = {["fo" + "o"]: function foo() {}}
x.foo();

// Getter
let y = {get ["message"]() {return "hello"}}
console.log(y.message)

// Setter
let z = {set ["message"](x) {console.log(x)}}
z.message = "world!"

// Method
const tautology = true === true;
let m = {
    [tautology ? "tautology" : "impossible"](b) {
    }
}
m.tautology()


/** Class creation. */
class A {
    _x;

    ["computedProperty"] = function () {console.log("e")}

    constructor(x) {
        this._x = x;
    }

    static ["static"+"F"] = function () {console.log("a")};// Static field
    static ["static"+"G"]() {console.log("e")}
    ["method"]() {console.log("b")}; // Method

    get ["field"] () {return this._x} // Getter
    set ["field"](x) {this._x = x} // Setter

    ["name" + ""]() {} // Id 'name' should not access property descriptor of Class.name
}

const a = new A(function foo() {console.log("c")});
A.staticF();
a.method();
let f = a.field;
f();
a.field = function () {console.log("d")}
a.field();
a.computedProperty()
A.staticG();
a.name();

/** Nested structures. */
const arr = ["p1", "p2"];
const top = {
    mid: {
        [arr[0]]: function () {console.log("1")},
        [arr[1]]() {
            console.log("2")
        }
    },
    ["bot"]: {
        ["some" + "thing"]: {
            [arr[0]+arr[1]]: function () {console.log("3")}
        }
    },
    special: {
        get "foo"() {console.log("4")},
        set ["bar"](x) {console.log("5")}
    }
}
top.mid.p1();
top.mid.p2();
top.bot.something.p1p2();
top.special.foo;
top.special.bar = ""