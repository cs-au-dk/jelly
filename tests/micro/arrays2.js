var x = [
    () => {console.log("1")},
    () => {console.log("2")},
];
x.push(() => {console.log("3")});
// var a0 = x[0];
// a0();
// var t = 1;
// var a1 = x[t];
// a1();

var y = x.map(function(element, index, array) {
        element();
        array[2]();
        this.p();
        return () => {console.log("4")};
    },
    {p: function() {console.log("5")}});
var z = y[1];
z();