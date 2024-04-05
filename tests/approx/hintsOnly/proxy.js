/** Testing the behaviour of the proxy object. */

const p = "p"

/** Requested property descriptors of proxy objects must be well-formed. */
function propertyDescriptor(obj, prop) {
    var descriptor = Object.getOwnPropertyDescriptor(obj, prop)
    const x = descriptor.value.could.be().anything();
    let y = {}
    y[p] = () => {}
}

function inOnProxy(x, y) {
    for (var key in y)
        x[key] = y

    const a = {}
    a[p] = () => {}
}
/** Disallow infinite recursion. */
function infiniteRecursion (x) {
    if (!x.hasNext) return;
    infiniteRecursion(x.next)
}

/** When coercion of property access happens, the symbol coercion must result in proper values. */
function symbolCoercion(x, y) {
    const number = +y;
    if (isNaN(number))
        throw Error()
    const str = `${x}`
    if (typeof str !== "string")
        throw Error()

    const a = {val: {}}
    return a["val"]
}

/** Ensure termination of forced execution. */
function foo(x) {
    if (x !== null)
        foo(x)
}
