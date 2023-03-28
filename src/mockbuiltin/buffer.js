class Buffer {
  constructor(...args) {
    for (const arg of args) arg();
  }

  static from(...args) {
    for (const arg of args) arg();
    return new Buffer();
  }

  static alloc(...args) {
    for (const arg of args) arg();
    return new Buffer();
  }

  static allocUnsafe(...args) {
    for (const arg of args) arg();
    return new Buffer();
  }

  static allocUnsafeSlow(...args) {
    for (const arg of args) arg();
    return new Buffer();
  }

  static isBuffer(...args) {
    for (const arg of args) arg();
  }

  static isEncoding(...args) {
    for (const arg of args) arg();
  }

  static concat(...args) {
    for (const arg of args) arg();
    return new Buffer();
  }

  static byteLength(...args) {
    for (const arg of args) arg();
  }

  static copyBytesFrom(...args) {
    for (const arg of args) arg();
    return new Buffer();
  }

  static of(...args) {
    for (const arg of args) arg();
    return new Buffer();
  }

  copy(...args) {
    for (const arg of args) arg();
    return new Buffer();
  }

  write(...args) {
    for (const arg of args) arg();
  }

  toJSON(...args) {
    for (const arg of args) arg();
  }

  toString(...args) {
    for (const arg of args) arg();
  }

  slice(...args) {
    for (const arg of args) arg();
    return new Buffer();
  }

  equals(...args) {
    for (const arg of args) arg();
  }

  inspect(...args) {
    for (const arg of args) arg();
  }

  compare(...args) {
    for (const arg of args) arg();
  }

  indexOf(...args) {
    for (const arg of args) arg();
  }

  lastIndexOf(...args) {
    for (const arg of args) arg();
  }

  includes(...args) {
    for (const arg of args) arg();
  }

  fill(...args) {
    for (const arg of args) arg();
    return new Buffer();
  }

  subarray(...args) {
    for (const arg of args) arg();
    return new Buffer();
  }

  swap16(...args) {
    for (const arg of args) arg();
    return this;
  }

  swap32(...args) {
    for (const arg of args) arg();
    return this;
  }

  swap64(...args) {
    for (const arg of args) arg();
    return this;
  }

  toLocaleString(...args) {
    for (const arg of args) arg();
  }
}

class SlowBuffer {
  constructor(...args) {
    for (const arg of args) arg();
  }
}

class File extends Blob {}

class Blob {
  constructor(...args) {
    for (const arg of args) arg();
  }

  slice(...args) {
    for (const arg of args) arg();
    return new Blob();
  }

  arrayBuffer(...args) {
    for (const arg of args) arg();
    return new Promise();
  }

  text(...args) {
    for (const arg of args) arg();
    return new Promise();
  }

  stream(...args) {
    for (const arg of args) arg();
    return new Promise();
  }
}


function transcode(...args) {
  for (const arg of args) arg();
}

function btoa(...args) {
  for (const arg of args) arg();
}

function atob(...args) {
  for (const arg of args) arg();
}

function resolveObjectURL(...args) {
  for (const arg of args) arg();
}

module.exports = {
  Buffer,
  Blob,
  File,
  SlowBuffer,
  transcode,

  btoa,
  atob,
  resolveObjectURL,
};