var mylib = require('./mylib');
var assert = require('assert');

describe("mylib", function() {
    it('plus should return a number', function() {
        assert.ok(typeof mylib.plus(4, 2) === 'number');
    });
    it('apply should apply', function() {
        assert.ok(mylib.apply(mylib.plus, 4, 2) === 6);
    });
});
