const x = new Function('return this;')().Promise


const myFunc = new Function('x', 'y', 'z', "x[y] = z");
const a = {}
const b = 'b'
const c = function () {}

myFunc(a,b,c)
a[b]();