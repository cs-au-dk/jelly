/** Expressions with parentheses as parents were notoriously difficult to handle for NodeProf. */
// Returns an object with a property with a function value
const creator = (() => {
    return ({val: (() => {})})
})

var x   = ( creator());
const p = "p";
const q = "val";
(x[q] ());
x[p] = (({}));

/** Arrow functions with a non-block expression as body were incorrectly handled by NodeProf. */
const vals = [{val: (function() {})}]
function Foo() {
    return vals.map(f => ({newVal: f.val}))
}

var newVal = "newVal";
const zero = 0;
((Foo()[zero][newVal]()))

let wrapped = ((() => ({q: () => ({})})))
let z = wrapped();
z.q()

/** Objects with dynamically computed names likewise. */
function Bar() {
    return {
        ["MyFunction"]() {console.log("Valid syntax!")},
        "MyOtherFunction"() {console.log("Just as valid!")}
    }
}

let y = Bar();
let myFunc = "MyFunction";
y[myFunc]();
y["MyOther"+"Function"]()