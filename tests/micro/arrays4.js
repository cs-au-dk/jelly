// exposes bug in native callback handler
function doit(f) {
    [() => {}].forEach(f);
    f = undefined;
}

doit(f => f());
doit(f => f());
