class IncomingMessage {
  constructor(...args) {
    for (const arg of args) arg();
  }
  setTimeout(...args) {
    for (const arg of args) arg();
    return this;
  }
  _read(...args) {
    for (const arg of args) arg();
  }
  _destroy(...args) {
    for (const arg of args) arg();
  }
  _addHeaderLines(...args) {
    for (const arg of args) arg();
  }
  _addHeaderLine(...args) {
    for (const arg of args) arg();
  }
  _addHeaderLineDistinct(...args) {
    for (const arg of args) arg();
  }
  _dump(...args) {
    for (const arg of args) arg();
  }
}

function readStart(...args) {
  for (const arg of args) arg();
}

function readStop(...args) {
  for (const arg of args) arg();
}

module.exports = {
  IncomingMessage,
  readStart,
  readStop
};
