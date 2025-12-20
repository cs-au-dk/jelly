function _interopRequireWildcard(obj) {
    if (obj && obj.__esModule) return obj;

    var newObj = {};
    if (obj != null) {
        for (var key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    return newObj;
}

const c = _interopRequireWildcard(require('./c.js'));
const d = _interopRequireWildcard(require('./d.js'));

c.foo();        // foo from c.js
c.bar();        // bar from c.js
c.default.foo(); // foo from c.js
d.foo();        // baz from d.js
d.default();    // default function from ES module (d.js)
