
function f() {
    console.log("f")
}
const r=[f];
Promise.all(r).then(q => q.forEach(m => m()))
