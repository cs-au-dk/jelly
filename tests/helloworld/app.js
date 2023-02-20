const express = require('express');

const app = express();

app.get('/', function(req, res) {
    res.send("Hello world!");
    console.log("Response sent");
});

const PORT = 3000;
app.listen(PORT);
console.log(`Listening on port ${PORT}`);