// /** Treating Object.create as an object literal creation. */
const p = "p";
var y = {
    f: function () {
    }
}
var x1 = Object.create(null);

x1[p] = y;
x1.p.f();

/** Treating Object.assign(target, sources) as a sequence of dynamic property writes for all properties defined on sources. */
const a = {
    foo: function () {
    }
}
const b = {
    bar: function () {
    },
    baz: function () {
    }
}

const c = {
    get qwe () {},
    set qweSet(x) {}
}

const x2 = {}
Object.assign(x2, a, b, c)
x2.foo();
x2.bar();
x2.baz();
x2.qwe;
x2.qweSet = {}

/** Treat Object.definePropert(y | ies) as a sequence of dynamic write operations as well. */

const x3 = {
    val: function () {
    },
    otherVal: {
        s: false, t: function () {
        }
    }
}

var x4 = {}
const v = "val"
const desc = Object.getOwnPropertyDescriptor(x3, v);
Object.defineProperty(x4, p, desc);
x4.p();

Object.defineProperties(x4, Object.getOwnPropertyDescriptors(x3));
x4.val();
x4.otherVal.t();

/** Treating Function.prototype.bind as an allocation of a new function. */

function Foo() {}
const bound = Foo.bind()
const obj = {}
obj["bo"+"und"] = bound;
obj.bound();

/** Tracking arrays from native functions. */
// Natives on Array
const arr1 = Array.from([function a1() {}, function a2() {}])
var x5 = {}
x5["arr" + "1"] = arr1;
x5.arr1[0]()
x5.arr1[1]()

const arr2 = Array.of(() => {}, () => {})
x5["arr"+"2"] = arr2
x5.arr2[0]()
x5.arr2[1]()

// Natives on Array.prototype
var t1 = [function a3(){}];
var t2 = [function a4(){}];
const arr3 = t2.concat(t1);
x5["arr"+"3"] = arr3
x5.arr3[0]()
x5.arr3[1]()

var t3 = [t1, t2]
const arr4 = t3.flat();
x5["arr"+"4"] = t3.flat()
x5.arr4[0]()
x5.arr4[1]()

t1 = [{p1: function () {}}, {p2: "foo"}]
const arr5 = t1.filter(entry => "p1" in entry)
x5["arr"+"5"] = arr5
x5.arr5[0].p1();

t1 = [function () {}, "foo", "bar"]
const arr6 = t1.slice(0, 1);
x5["arr"+"6"] = arr6;
x5.arr6[0]();

