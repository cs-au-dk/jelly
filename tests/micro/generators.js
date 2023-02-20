function* gen() { // return the function's Iterator object
    yield () => {console.log("1")}; // write result value to the Iterator object
    yield* gen2();
    yield* [() => {console.log("3")}, () => {console.log("4")}]; // like for-in...
}

function* gen2() {
    yield () => {console.log("2")};
}

const x = gen();
const v1 = x.next();
v1.value();
for (const v of x)
    v();

var q = [() => {console.log("5")}];
const y = q.values();
const v2 = y.next();
v2.value();

function* gen3() {
    return () => {console.log("6")}; // write result value to the Iterator object
}
const z = gen3();
const v3 = z.next();
v3.value();

function* gen4() {
    const q = yield; // yield gives value from .next
    q();
}
const t = gen4();
t.next();
t.next(() => {console.log("7")});

function* gen5() {
    yield () => {console.log("8")};
    return () => {console.log("9")};
}
const u = gen5();
u.next().value();
u.next().value();

const obj = {
    *gen6 () {
        yield () => {console.log("10")};
    }
}
const e = obj.gen6()
e.next().value();

class Foo {
    *gen7() {
        yield () => {console.log("11")};
    }
}
const f = new Foo();
const g = f.gen7();
g.next().value();

function* gen8() {
    yield* [() => {console.log("12")}, () => {console.log("13")}];
    return () => {console.log("14")};
}
function* gen9() {
    const t = yield* gen8(); // yield* gives returned value
    t();
    return t;
}
const i1 = gen9();
i1.next().value();
i1.next().value();
i1.next().value();

// TODO:
// x.return(() => {});
// x.throw(() => {});
