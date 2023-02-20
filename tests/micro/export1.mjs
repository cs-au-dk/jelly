// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/export

export { default as function1,
    function2 } from './export2.mjs';

function cube(x) {
    return x * x * x;
}

const foo = Math.PI + Math.SQRT2;

var graph = {
    options: {
        color:'white',
        thickness:'2px'
    },
    draw: function() {
        console.log('From graph draw function');
    }
}

export { cube, foo, graph };

export default function cube2(x) {
    return x * x * x;
}
