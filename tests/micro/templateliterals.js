function fun(strings, p1, p2) {
    p1();
    p2();
    return () => {console.log("3")};
}
const x = fun`foo${ () => {console.log("1")} }bar${ () => {console.log("2")} }baz`;
x();
