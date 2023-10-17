// exposes bug in native callback handler
function doit(callSort, cb) {
    const weirdArray = [() => {}, () => {}];
    if (callSort)
        weirdArray.forEach = weirdArray.sort;
    weirdArray.forEach(cb);
    cb = undefined;
}

doit(false, f => f());
doit(true, (a, b) => {
    a();
    b();
});
