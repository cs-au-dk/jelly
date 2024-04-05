var assert = require('assert')
var obj = require('../index')

describe("test suite", function () {
    it("test", function() {
        /** This test will produce hints if executed. */
        const x = {}
        const y = "p"
        const z = {}

        let res = obj.Foo(x, y, z);
        assert.equal(res, x)
        assert.equal(res.p, z)
    })

    it("function call", function () {
        const x = {}
        const y = "p1"
        const z = function () {}
        let res = obj.Foo(x,y,z)

        res.p1();

    })
})