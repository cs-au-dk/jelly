// generate mock API code for standard libs.
function generateHttp() {
  const Stream = require('stream');
  const obj = new Stream();
  const apis = new Set();
  // const proto = Object.getPrototypeOf(Stream);
  const proto = Stream;
  // const proto = net.createServer();
  // console.log();
  const methodNames = Object.getOwnPropertyNames(proto).filter(
    (prop) => {
      return typeof proto[prop] === 'function' && !/^[A-Z]/.test(prop);
    }
  );
  // console.log('😭', methodNames);
  for (const methodName of methodNames) {
    apis.add(methodName);
  }
  const returnThisList = [
    'pipe',
    'on',
    'once',
    'prependListener',
    'prependOnceListener',
    'setTimeout',
    'setHeader',
    'appendHeader',
    'listen',
    'getConnections',
    'ref',
    'unref',
    'setMaxListeners',
    'addListener',
    'removeListener',
    'writeHead',
    'end',
    'destroy',
    'writeHeader',
    'setNoDelay',
    'setKeepAlive',
  ];
  for (const api of apis) {
    const returnThis = returnThisList.includes(api);
    console.log(generateMethod(api, returnThis));
  }
}

function generateFunction(name, returnThis) {
  return `function ${name}(...args) {
  for (const arg of args) arg();
}`;
}

function generateMethod(name, returnThis) {
  return `${name}(...args) {
  for (const arg of args) arg();
  ${returnThis ? 'return this;' : ''}
}`;
}
// generateHttp();

function generatePromiseFn(name) {
  return `async function ${name}(...args) {
  for (const arg of args) arg();
  return new Promise();
}`;
}

function genFs() {
  const obj = require('fs/promises');
  const methodNames = Object.getOwnPropertyNames(obj).filter(
    (prop) => {
      return typeof obj[prop] === 'function';
    }
  );
  for (const methodName of methodNames) {
    console.log(generatePromiseFn(methodName));
    console.log('');
    // console.log(methodName)
  }
}

function genChildProcess() {
  const obj = require('child_process');

  const methodNames = Object.getOwnPropertyNames(obj).filter(
    (prop) => {
      return typeof obj[prop] === 'function';
    }
  );
  for (const methodName of methodNames) {
    console.log(generateFunction(methodName));
    console.log('');
    // console.log(methodName)
  }
}

// genChildProcess();

function genBuffer() {
  const obj = require('buffer');

  console.log(new obj.Blob())
  const methodNames = Object.getOwnPropertyNames(obj.Blob).filter(
    (prop) => {
      return typeof obj[prop] === 'function';
    }
  );

  for (const methodName of methodNames) {
    console.log(generateMethod(methodName));
    console.log('');
    // console.log(methodName)
  }
}
// genBuffer();


function genOs() {
  const obj = require('os');
  const methodNames = Object.getOwnPropertyNames(obj).filter(
    (prop) => {
      return typeof obj[prop] === 'function';
    }
  );

  for (const methodName of methodNames) {
    console.log(generateFunction(methodName));
    console.log('');
    // console.log(methodName)
  }
}

// genOs();

function genVM() {
  const obj = require('vm');
  const methodNames = Object.getOwnPropertyNames(obj.Script).filter(
    (prop) => {
      return typeof obj[prop] === 'function';
    }
  );

  for (const methodName of methodNames) {
    console.log(generateFunction(methodName));
    console.log('');
    // console.log(methodName)
  }
}

// genVM();

function genCrypto() {
  const obj = require('crypto');

  console.log(obj.KeyObject);
  const methodNames = Object.getOwnPropertyNames(obj.KeyObject).filter(
    (prop) => {
      return typeof obj[prop] === 'function' && !/^[A-Z]/.test(prop);
    }
  );

  for (const methodName of methodNames) {
    // console.log(generateFunction(methodName));
    // console.log('');
    // console.log(methodName)
  }
}

// genCrypto();

function genStream() {
  const obj = require('stream');

  console.log(obj.Readable.prototype);
  const methodNames = Object.getOwnPropertyNames(obj.Readable.prototype).filter(
    (prop) => {
      return typeof obj[prop] === 'function' && !/^[A-Z]/.test(prop);
    }
  );

  for (const methodName of methodNames) {
    console.log(generateMethod(methodName));
    console.log('');
    // console.log(methodName)
  }
}

genStream();

