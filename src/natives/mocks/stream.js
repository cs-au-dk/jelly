class WritableState {
  constructor(...args) {
    for (const arg of args) arg();
  }
  getBuffer(...args) {
    for (const arg of args) arg();
  }
}

class Writable {
  WritableState = WritableState;
  constructor(...args) {
    for (const arg of args) arg();
  }
  update(...args) {
    for (const arg of args) arg();
  }
  sign(...args) {
    for (const arg of args) arg();
  }
  pipe(...args) {
    for (const arg of args) arg();
  }
  open(...args) {
    for (const arg of args) arg();
  }
  write(...args) {
    for (const arg of args) arg();
  }
  end(...args) {
    for (const arg of args) arg();
  }
  cork(...args) {
    for (const arg of args) arg();
  }
  uncork(...args) {
    for (const arg of args) arg();
  }
  setDefaultEncoding(...args) {
    for (const arg of args) arg();
  }
  destroy(...args) {
    for (const arg of args) arg();
  }
  destroySoon(...args) {
    for (const arg of args) arg();
  }
  _construct(...args) {
    for (const arg of args) arg();
  }
  _write(...args) {
    for (const arg of args) arg();
  }
  _writev(...args) {
    for (const arg of args) arg();
  }
  _undestroy(...args) {
    for (const arg of args) arg();
  }
  _destroy(...args) {
    for (const arg of args) arg();
  }
  _final(...args) {
    for (const arg of args) arg();
  }
}

class Readable {
  constructor(...args) {
    for (const arg of args) arg();
  }
  open(...args) {
    for (const arg of args) arg();
  }
  destroy(...args) {
    for (const arg of args) arg();
  }
  on(...args) {
    for (const arg of args) arg();
  }
  compose(...args) {
    for (const arg of args) arg();
  }
  _construct(...args) {
    for (const arg of args) arg();
  }
  _read(...args) {
    for (const arg of args) arg();
  }
  _destroy(...args) {
    for (const arg of args) arg();
  }
  close(...args) {
    for (const arg of args) arg();
  }
  _undestroy(...args) {
    for (const arg of args) arg();
  }
  push(...args) {
    for (const arg of args) arg();
  }
  unshift(...args) {
    for (const arg of args) arg();
  }
  isPaused(...args) {
    for (const arg of args) arg();
  }
  read(...args) {
    for (const arg of args) arg();
  }
  setEncoding(...args) {
    for (const arg of args) arg();
  }
  pause(...args) {
    for (const arg of args) arg();
  }
  pipe(...args) {
    for (const arg of args) arg();
  }
  unpipe(...args) {
    for (const arg of args) arg();
  }
  addListener(...args) {
    for (const arg of args) arg();
  }
  removeListener(...args) {
    for (const arg of args) arg();
  }
  resume(...args) {
    for (const arg of args) arg();
  }
  off(...args) {
    for (const arg of args) arg();
  }
  removeAllListeners(...args) {
    for (const arg of args) arg();
  }
  wrap(...args) {
    for (const arg of args) arg();
  }
  iterator(...args) {
    for (const arg of args) arg();
  }
}

class Duplex extends Readable {
  constructor(...args) {
    for (const arg of args) arg();
  }
  // Writable methods
  write(...args) {
    for (const arg of args) arg();
  }
  end(...args) {
    for (const arg of args) arg();
  }
  cork(...args) {
    for (const arg of args) arg();
  }
  uncork(...args) {
    for (const arg of args) arg();
  }
  setDefaultEncoding(...args) {
    for (const arg of args) arg();
  }
  destroy(...args) {
    for (const arg of args) arg();
  }
  destroySoon(...args) {
    for (const arg of args) arg();
  }
  _construct(...args) {
    for (const arg of args) arg();
  }
  _write(...args) {
    for (const arg of args) arg();
  }
  _writev(...args) {
    for (const arg of args) arg();
  }
  _undestroy(...args) {
    for (const arg of args) arg();
  }
  _destroy(...args) {
    for (const arg of args) arg();
  }
  _final(...args) {
    for (const arg of args) arg();
  }
}

class Transform extends Duplex {
  constructor(...args) {
    for (const arg of args) arg();
  }
  _transform(...args) {
    for (const arg of args) arg();
  }
  _flush(...args) {
    for (const arg of args) arg();
  }
}

class PassThrough extends Transform {
  constructor(...args) {
    for (const arg of args) arg();
  }
}

class Stream {
  static Writable = Writable;
  static Readable = Readable;
  static Duplex = Duplex;
  static Transform = Transform;
  static PassThrough = PassThrough;
  static Stream = Stream;

  constructor(...args) {
    for (const arg of args) arg();
  }
  pipe(...args) {
    for (const arg of args) arg();
    return this;
  }
  static isDisturbed(...args) {
    for (const arg of args) arg();
  }
  static isErrored(...args) {
    for (const arg of args) arg();
  }
  static isReadable(...args) {
    for (const arg of args) arg();
  }
  static pipeline(...args) {
    for (const arg of args) arg();
  }
  static addAbortSignal(...args) {
    for (const arg of args) arg();
  }
  static finished(...args) {
    for (const arg of args) arg();
  }
  static destroy(...args) {
    for (const arg of args) arg();
    return this;
  }
  static compose(...args) {
    for (const arg of args) arg();
  }
  static _isUint8Array(...args) {
    for (const arg of args) arg();
  }
  static _uint8ArrayToBuffer(...args) {
    for (const arg of args) arg();
  }
}

Writable.prototype = Stream;
Readable.prototype = Stream;

module.exports = Stream;
