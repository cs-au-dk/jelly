var x1;
x1 = require("foo");
x1 = require("bar");
x1 = {}
var y1 = x1.f.g;

var x2;
x2 = require("foo");
x2 = require("bar");
var y2 = x2.f.g;

var x3;
x3 = require("foo");
x3.f = require("bar").f;
var y3 = x3.f.g;

