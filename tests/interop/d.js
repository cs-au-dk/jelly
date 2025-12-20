module.exports = {
    default: function () {
        console.log("default function from ES module (d.js)");
    },
    foo: function() { console.log("foo from d.js"); },
    bar: function() { console.log("bar from d.js"); },
    __esModule: true,
};
