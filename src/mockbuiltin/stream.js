class WritableState {
  constructor(...args) {
    for (const arg of args) arg();
  }
  getBuffer(...args) {
    for (const arg of args) arg();
  }
}

class Writable extends Stream {
  WritableState = WritableState;
  constructor(...args) {
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
  _write(...args) {
    for (const arg of args) arg();
  }
  _writev(...args) {
    for (const arg of args) arg();
  }
  _destroy(...args) {
    for (const arg of args) arg();
  }
  _final(...args) {
    for (const arg of args) arg();
  }
}

class Stream {
  Writable = Writable;
  constructor(...args) {
    for (const arg of args) arg();
  }
  pipe(...args) {
    for (const arg of args) arg();
    return this;
  }
  isDisturbed(...args) {
    for (const arg of args) arg();
  }
  isErrored(...args) {
    for (const arg of args) arg();
  }
  isReadable(...args) {
    for (const arg of args) arg();
  }
  pipeline(...args) {
    for (const arg of args) arg();
  }
  addAbortSignal(...args) {
    for (const arg of args) arg();
  }
  finished(...args) {
    for (const arg of args) arg();
  }
  destroy(...args) {
    for (const arg of args) arg();
    return this;
  }
  compose(...args) {
    for (const arg of args) arg();
  }
  _isUint8Array(...args) {
    for (const arg of args) arg();
  }
  _uint8ArrayToBuffer(...args) {
    for (const arg of args) arg();
  }
}

module.exports = Stream;
