const x = {};
const p = 'p';

x[p] = new Promise(function (resolve, reject) {})

const map = new Map();
map['foo'+'bar'] = new Function("return 'baz'");

x[map['foo'+'bar']()] = function () {}