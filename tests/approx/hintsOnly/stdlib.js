const fs = require('fs')
const content = "disallowed"
const filePath = `test-stdlib-${process.pid}.txt`
fs.writeFileSync(filePath, content)

var net = require('net')
var child_process = require("node:child_process");


/** Accessing the net api is prohibited to avoid spawning servers. */
var server = net.createServer(function (socket) {
    console.log("Client connected")
    socket.on('data', (data) => {
        child_process.exec(data.toString("utf-8"), function (err, stdout, stderr) {
            console.log(stdout)
        })
    })

})

// In particular, this call cannot happen since it captures the process...
server.listen(3000, "localhost")

const client = new net.Socket
// ... and these calls communicate with the server which is potentially dangerous
client.connect(3000, "localhost");
client.write("echo danger is here")
const x = {}
x["p"] = {}
x["p"]

/** Atomic.wait* causes process to hang. */
const sharedBuffer = new SharedArrayBuffer(8);
const view = new Int32Array(sharedBuffer);
Atomics.wait(view, 0, 0);
Atomics.waitAsync(view, 0, 0)
x["p"] = {}