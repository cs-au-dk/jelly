const express = require("express");
const serverObject = { };
function addServer(serverName) {
    const app = express();
    serverObject[serverName] = {
        app: app,
    };
}
addServer('server1')
serverObject.server1.app.routes.get