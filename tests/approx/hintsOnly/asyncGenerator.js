const x = {}

/** Support for async function in forced execution. */
async function foo() {
  const p = 'p';
  x[p] = function () {}
}


/** Support for generator functions both in traditional and forced execution. */
function* bar() {
    const p = 'p';
    x[p] = {}
}

function* baz() {
    const p = 'p'
    x[p] = {}
    yield x;
    x[p+p] = {}
    yield x;
}

const gen = baz();
gen.next()
gen.next()

/** Support for async generator functions. */
async function* qwe() {
    const p = 'p'
    x[p] = {}
}
async function* qwe2() {
    const p = 'p'
    x[p] = {}
    yield x;
    x[p+p] = {}
    yield x;
}

const gen2 = qwe2();
gen2.next().then();
gen2.next().then()

