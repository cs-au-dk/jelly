(function() {

    exports = module.exports = {}

    exports.Foo = function (x, y, z) {
        foo(x, y, z)
        return x;
    }

    function foo(x, y, z) {
        x[y] = z
        if (typeof z === "function")
            x[y]();
    }
})()