const express = require('express');

const app = express();

app.get('/', function(req, res) {
    res.send("Hello world!");
    console.log("Response sent");
    server.close();
});

const PORT = 3000;
const server = app.listen(PORT);
console.log(`Listening on port ${PORT}`);
