

function ping() {
    throw "pong";
}

try {
    ping();
} catch(pong) {
    (function(){})();
}
