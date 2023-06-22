// Move f1 to 2nd line to make it discernible from synthetic module function
function f1(x) {
    console.log("0");
    if (!x)
        return;
    arguments[0]();
    arguments[1]();
    arguments[0] = () => {console.log("3")};
    x(); // TODO: assignments to arguments
    arguments.callee(); // TODO: arguments.callee
}
f1(() => {console.log("1")}, () => {console.log("2")});

function f2() {
    const f = () => arguments[0]; // arrow functions don't have their own 'arguments'
    f()();
}
f2(() => {console.log("4")});
