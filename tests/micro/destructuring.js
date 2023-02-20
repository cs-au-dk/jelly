var x1 = {
    a: () => {console.log("1")},
    b: {
        c: () => {console.log("2")},
    },
    get bar() {
        return () => {console.log("3")};
    }
};
var {a: y1 = () => {console.log("1b")}, ["a"]: y2, a: y3, b: {c: y4}, bar: y5, d: y6 = () => {console.log("1c")}} = x1;
y1();
y2();
y3();
y4();
y5();
y6();

let c = {
    set foo(q) {
        console.log("4");
        q();
    }
};
({a: c.foo} = x1);

var x2 = [
    () => {console.log("5")},
    [
        () => {console.log("6")}
    ]
];
var [z1, [z2]] = x2;
z1();
z2();

let d = {};
[d.baz] = x2;
d.baz();

const [x, y] = new Set([() => {}, () => {}]);
x();
y();

// const {a,...others} = {a:1,b:2,c:3};
// const [a2,...others2] = [1,2,3];
