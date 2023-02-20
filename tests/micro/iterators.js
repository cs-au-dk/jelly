// Array

const array = [
    () => {},
    () => {}
];
array.push(() => {});
for (const f of array)
    f();
for (const f of array.values())
    f();

array.forEach((v, k, ss) => {
    v();
    ss.includes(v);
}, {});
const t9 = array.pop();
t9();
const t13 = array.at(0);
t13();
array.fill(() => {}, 5, 10);

array.every((val, idx, arr) => {}, {});
array.some((val, idx, arr) => {}, {});
const t10 = array.find((val, idx, arr) => {}, {});
array.findIndex((val, idx, arr) => {}, {});
const a10 = array.filter((val, idx, arr) => {}, {});
a10.push();
const a11 = array.map((val, idx, arr) => {}, {});
a11.push();
const t11 = array.reduce((previousValue, currentValue, currentIndex, arr) => {
    currentValue();
    arr.includes();
    return previousValue;
}, {});
console.log(t11);
const t12 = array.reduceRight((previousValue, currentValue, currentIndex, arr) => {
    currentValue();
    arr.includes();
    return previousValue;
}, {});
console.log(t12);
const a12 = array.sort((a, b) => {});
a12.includes();
const a14 = array.concat(() => {}, () => {});
a14.includes();
const a15 = array.flatMap((value, index, array) => {}, {});
a15.includes();
const a16 = array.slice(5, 7);
a16.includes();
const a17 = array.splice(3, 2);
a17.includes();
// TODO: array.keys();
// TODO: array.copyWithin();
// TODO: array.flat();
// TODO: Array.from();
// TODO: Array.of();

// Set

const set = new Set;
set.add(() => {});
set.add(() => {});
for (const f of set)
    f();
for (const f of set.values())
    f();
for (const [v1, v2] of set.entries()) {
    v1();
    v2();
}
set.forEach((v, k, ss) => {
    v();
    k();
    ss.has(k);
}, {});

// Map

const map = new Map;
map.set(() => {}, () => {});
map.set(() => {}, () => {});
for (const [k,v] of map) {
    k();
    v();
}
for (const [k,v] of map.entries()) {
    k();
    v();
}
for (const k of map.keys())
    k();
for (const v of map.values())
    v();
map.forEach((v, k, ss) => {
    v();
    k();
    ss.has(k);
}, {});
