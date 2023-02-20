var r1 = RegExp("ab+c");
r1.test("ab")

var r2 = /a*b*/;
var a = r2.exec("aaabbb");
a.find((v) => {console.log("!");return true});

