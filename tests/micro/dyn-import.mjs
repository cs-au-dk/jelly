const { default: function1, function2 } = await import("./export2.mjs");
function1(10);
function2(10);
console.log("hi");
