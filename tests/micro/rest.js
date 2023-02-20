var arr = [
    () => {console.log("1")},
    () => {console.log("2")},
    () => {console.log("3")},
    () => {console.log("4")}
];
arr[Math.floor(Math.random())] = () => {console.log("5")};

var [a0, a1, ...arest] = arr;
a0();
a1();
var a2 = arest[0];
var a3 = arest[1];
var a4 = arest[2];
a2();
a3();
if (a4)
    a4();

var [c0, ...[c1, ...crest]] = arr;
c0();
c1();
var c2 = crest[0];
var c3 = crest[1];
var c4 = crest[2];
c2();
c3();
if (c4)
    c4();

function f1(b0, b1, ...rest) {
    b0();
    b1();
    rest[0]();
    rest[1]();
    if (rest[2])
        rest[2]();
}
f1(
    () => {console.log("11")},
    () => {console.log("12")},
    () => {console.log("13")},
    () => {console.log("14")}
)

function f2(d0, ...[d1, ...drest]) {
    d0();
    d1();
    drest[0]();
    drest[1]();
    if (drest[2])
        drest[2]();
}
f2(
    () => {console.log("21")},
    () => {console.log("22")},
    () => {console.log("23")},
    () => {console.log("24")}
)

var obj = {
    e1: () => {console.log("31")},
    e2: () => {console.log("32")},
    e3: () => {console.log("33")},
    e4: () => {console.log("34")}
};
obj["e" + (obj ? 1 : 2)] = () => {console.log("35")};

var {e1, e2: ee2, ...erest} = obj;
e1();
ee2();
erest.e3();

function f3({e1: eee1, ...eerest}) {
    eee1();
    eerest.e4();
}
f3(obj);
