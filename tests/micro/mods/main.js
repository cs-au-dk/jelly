(async () => {
    const { callEsm } = await import('./esm.mjs');
    const result = await callEsm('World1');
    console.log(result);
})();

(async () => {
    const { callEsm } = await import('pkg-esm');
    const result = callEsm('World2');
    console.log(result);
})();

(async () => {
    const { callEsm } = require('./esm.mjs');
    const result = callEsm('World3');
    console.log(result);
})();

(async () => {
    const { callEsm } = require('pkg-esm');
    const result = callEsm('World4');
    console.log(result);
})();
