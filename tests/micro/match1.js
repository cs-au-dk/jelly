const express = require('express');
function BitterServer(opts) {
    this.app = express();
    this.app.get(/^\/(\d{4})\/(\d{2})\/(\d+)(-\d+)?\/(.*)$/, (function(_this) {
        return function(req) {
            req.params[0];
        }})(this));
}
