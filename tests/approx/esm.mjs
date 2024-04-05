import {setProperty} from "./node_modules/esm/lib.mjs"
import fs from 'fs'

import * as foo from 'foolib'

const x = {}
const y = "p"
const z = {}
setProperty(x, y, z)

// fs is monkey patched.
const fd = fs.openSync("qwe", "w")
fs.writeSync(fd, "foobar")
fs.closeSync(fd);


const a = {foo: function () {}}
foo.default.bar(a)

import {asyncFoo} from "./node_modules/esm/lib.mjs"
async function someName() {
    await asyncFoo();
    const x = {}
    x["fromSomeName"] = function () {}
    return x;
}

someName().then(r => r.fromSomeName());

export function otherName(x, y) {
    x.y.z.a.b.c().e().f();
    y[x.y()];
    const a = {}
    a["p"+"1"] = {}
}