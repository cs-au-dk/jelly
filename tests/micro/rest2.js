function f(...args) {
    args[0]();
}
function g() {
    console.log("here");
}
f(g);
