
class OutgoingMessage {
  constructor(...args) {
    for (const arg of args) arg();
  }
  _renderHeaders(...args) {
    for (const arg of args) arg();
  }
  cork(...args) {
    for (const arg of args) arg();
  }
  uncork(...args) {
    for (const arg of args) arg();
  }
  setTimeout(...args) {
    for (const arg of args) arg();
    return this;
  }
  destroy(...args) {
    for (const arg of args) arg();
    return this;
  }
  _send(...args) {
    for (const arg of args) arg();
  }
  _writeRaw(...args) {
    for (const arg of args) arg();
  }
  _storeHeader(...args) {
    for (const arg of args) arg();
  }
  setHeader(...args) {
    for (const arg of args) arg();
    return this;
  }
  appendHeader(...args) {
    for (const arg of args) arg();
    return this;
  }
  getHeader(...args) {
    for (const arg of args) arg();
  }
  getHeaderNames(...args) {
    for (const arg of args) arg();
  }
  getRawHeaderNames(...args) {
    for (const arg of args) arg();
  }
  getHeaders(...args) {
    for (const arg of args) arg();
  }
  hasHeader(...args) {
    for (const arg of args) arg();
  }
  removeHeader(...args) {
    for (const arg of args) arg();
  }
  _implicitHeader(...args) {
    for (const arg of args) arg();
  }
  write(...args) {
    for (const arg of args) arg();
  }
  addTrailers(...args) {
    for (const arg of args) arg();
  }
  end(...args) {
    for (const arg of args) arg();
    return this;
  }
  _finish(...args) {
    for (const arg of args) arg();
  }
  _flush(...args) {
    for (const arg of args) arg();
  }
  _flushOutput(...args) {
    for (const arg of args) arg();
  }
  flushHeaders(...args) {
    for (const arg of args) arg();
  }
  pipe(...args) {
    for (const arg of args) arg();
  }
}


function parseUniqueHeadersOption(...args) {
  for (const arg of args) arg();
}

function validateHeaderName(...args) {
  for (const arg of args) arg();
}

function validateHeaderValue(...args) {
  for (const arg of args) arg();
}

module.exports = {
  parseUniqueHeadersOption,
  validateHeaderName,
  validateHeaderValue,
  OutgoingMessage
};