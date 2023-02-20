// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/export

import cube2, { cube, foo, graph, function1, function2 } from './export1.mjs';

graph.options = {
    color:'blue',
    thickness:'3px'
};

graph.draw();
console.log(cube(3));
console.log(foo);

console.log(cube2(3));

console.log(function1(2));
console.log(function2(2));

console.log(import.meta);

// see also https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import

