const lib1 = require('./lib1.js');
const filter = lib1.filter;
console.log(filter(x => x % 2 === 0)([1, 2, 3]));
lib1.obj.foo = 87;
