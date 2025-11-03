a = () => {}; // declared automatically in the global scope
var b = a;
b();
global.a(); // global is a property of globalThis which is the global scope
globalThis.global.globalThis.a();

global.setTimeout(function() {})
setTimeout(function() {})

undefined = () => {}; // non-writable
undefined();