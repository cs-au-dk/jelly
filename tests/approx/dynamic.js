/** Writes between two known objects prior to eval statement should still produce useful hints. */

const x1 = {};
const x2 = function foo() {console.log("@@@")}

eval(`
    const p = "p";
    x1[p] = x2;
`)
x1.p();

var x3 = {prop: undefined}
var x4 = function bar() {console.log("!!!")}
eval(`x3.prop = x4`)
x3.prop();


/** A dynamic property read produces hints even if the value came from an eval. */
var x5 = {};
const v = "val";
const x6 = function bar() {console.log("Hi!")}
eval(`x5 = {val: x6}`)
x5[v]();

/** Dynamic requires should be recorded and used. */
const str = "foo" + "lib";
require(str);