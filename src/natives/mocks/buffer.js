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
    return new Buffer();
  }

  swap32(...args) {
    for (const arg of args) arg();
    return new Buffer();
  }

  swap64(...args) {
    for (const arg of args) arg();
    return new Buffer();
  }

  toLocaleString(...args) {
    for (const arg of args) arg();
  }

  // add prototype methods
  readBigUInt64LE() { }
  readBigUInt64BE() { }
  readBigUint64LE() { }
  readBigUint64BE() { }
  readBigInt64LE() { }
  readBigInt64BE() { }
  writeBigUInt64LE() { }
  writeBigUInt64BE() { }
  writeBigUint64LE() { }
  writeBigUint64BE() { }
  writeBigInt64LE() { }
  writeBigInt64BE() { }
  readUIntLE() { }
  readUInt32LE() { }
  readUInt16LE() { }
  readUInt8() { }
  readUIntBE() { }
  readUInt32BE() { }
  readUInt16BE() { }
  readUintLE() { }
  readUint32LE() { }
  readUint16LE() { }
  readUint8() { }
  readUintBE() { }
  readUint32BE() { }
  readUint16BE() { }
  readIntLE() { }
  readInt32LE() { }
  readInt16LE() { }
  readInt8() { }
  readIntBE() { }
  readInt32BE() { }
  readInt16BE() { }
  writeUIntLE() { }
  writeUInt32LE() { }
  writeUInt16LE() { }
  writeUInt8() { }
  writeUIntBE() { }
  writeUInt32BE() { }
  writeUInt16BE() { }
  writeUintLE() { }
  writeUint32LE() { }
  writeUint16LE() { }
  writeUint8() { }
  writeUintBE() { }
  writeUint32BE() { }
  writeUint16BE() { }
  writeIntLE() { }
  writeInt32LE() { }
  writeInt16LE() { }
  writeInt8() { }
  writeIntBE() { }
  writeInt32BE() { }
  writeInt16BE() { }
  readFloatLE() { }
  readFloatBE() { }
  readDoubleLE() { }
  readDoubleBE() { }
  writeFloatLE() { }
  writeFloatBE() { }
  writeDoubleLE() { }
  writeDoubleBE() { }
  asciiSlice() { }
  base64Slice() { }
  base64urlSlice() { }
  latin1Slice() { }
  hexSlice() { }
  ucs2Slice() { }
  utf8Slice() { }
  asciiWrite() { }
  base64Write() { }
  base64urlWrite() { }
  latin1Write() { }
  hexWrite() { }
  ucs2Write() { }
  utf8Write() { }
}

class SlowBuffer {
  constructor(...args) {
    for (const arg of args) arg();
  }
}


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

class File extends Blob {
  constructor(...args) {
    for (const arg of args) arg();
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