class Stream {
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
