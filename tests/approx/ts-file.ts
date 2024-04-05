import fs from "fs";
import {isatty} from "tty";
import * as url from "url";

/** Ensure typescript sandbox remains intact and imports are possible. */
class FileReader {

    readFile(path: string): string {
        let fd = fs.openSync(path, 'r');
        let content = fs.readFileSync(fd);
        return content.toString("utf8")
    }

    tty(path: string) {
        return isatty(fs.openSync(path, "r"))
    }

}

const path = "./tests/approx/"
const reader: FileReader = new FileReader();
let content = reader.readFile(path + "ts-file.ts");
fs.writeFileSync(path + "tmp.ts", content)
reader.tty(path)

url.resolve("from/", "to/file.txt")


class A {

    private _f: B

    constructor(f_: B) {
        this._f = f_;
    }

    defineProp(p: string, v: any): void {
        // @ts-ignore
        this[p] = v;
    }

    get f() {
        return this._f;
    }

    set f(x: B) {
        this._f = x;
    }
}

class C {
    constructor() {
    }
}

class B extends C {
    constructor() {
        super();
    }

}


const p = 'p';
const x1 = new A(new B());
x1.defineProp(p, new B())

x1.f = new B();
// @ts-ignore
x1["f"]()


// @ts-ignore
async function qwe() {
    const x: any = {}
    x[p] = function () {}
    const s = "assert/strict"
    const a: any = await import(s)
    a.ok(true)
    // TODO: This is not seen. The await statement does not work properly, and approximate finishes before it is executed.
    x[p+p] = function () {}
}