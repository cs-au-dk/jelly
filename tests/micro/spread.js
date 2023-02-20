function f(a1, a2, a3) {
    a1();
    a2();
    a3();
}
const xs = [
    () => {console.log("1")},
    () => {console.log("2")}

];
f(...xs, () => {console.log("3")}) // spread in arguments (values from iterable)

const q = { p1: () => {console.log("10")}, ...xs, p2: () => {console.log("11")} }; // spread in object (properties of object)
q.p1();
q.p2();
q[0]();
q[1]();

const w = [() => {console.log("20")}, ...xs, () => {console.log("21")}]; // spread in array (values from iterable)
w[0]();
w[1]();
w[2]();
w[3]();

const q2 = {...q}; // spread in object (properties of object)
q2.p1();
q2.p2();
q2[0]();
q2[1]();

const w2 = [...w.values()]; // spread in array (values from iterable)
w2[0]();
w2[1]();
w2[2]();
w2[3]();
