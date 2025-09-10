import cjsLib from './lib.js';

export function callEsm(name) {
    return cjsLib.greet(name) + ' (./esm.mjs)';
}
