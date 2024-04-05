/** Ensure process cannot be exited through the process API */

const Module = require("node:module");
process.exit(1)
process.reallyExit(1)
process.kill(123)

/** Exec should be strictly forbidden! */
var exec = require("child_process").exec;

exec(`killall node`, function (err, stdout, stderr) {
})

/** Avoid capturing the process by opening stdin. */
process.openStdin()

/** Callback to async functions are invoked immediately. */
setTimeout((x, y, z) => {
    console.log(x + y + z)
}, 5000, "Hello", " from", " setTimeout!")

setInterval(() => {
    console.log("Hello from setInterval!")
}, 1000)

queueMicrotask(() => {
    console.log("queueMicrotask called immediately!")
})

process.nextTick((x) => {console.log(x)}, "From process.nextTick")


// Ensure that execution reaches this point
var x = {}
const p = "p"
x[p] = function () {}
x.p();

// Ensure module.constructor is patched and this doesn't crash
module.constructor.createRequire('foo_bar_baz')()
x[p] = function () {}