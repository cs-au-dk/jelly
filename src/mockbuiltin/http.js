const net = require('./net');

class Server extends net.Server {
  constructor(...args) {
    for (const arg of args) arg();
  }
  close(...args) {
    for (const arg of args) arg();
  }
  closeAllConnections(...args) {
    for (const arg of args) arg();
  }
  closeIdleConnections(...args) {
    for (const arg of args) arg();
  }
  setTimeout(...args) {
    for (const arg of args) arg();
    return this;
  }
}

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

class ServerResponse {
  constructor(...args) {
    for (const arg of args) arg();
  }
  _finish(...args) {
    for (const arg of args) arg();
  }
  assignSocket(...args) {
    for (const arg of args) arg();
  }
  detachSocket(...args) {
    for (const arg of args) arg();
  }
  writeContinue(...args) {
    for (const arg of args) arg();
  }
  writeProcessing(...args) {
    for (const arg of args) arg();
  }
  writeEarlyHints(...args) {
    for (const arg of args) arg();
  }
  _implicitHeader(...args) {
    for (const arg of args) arg();
  }
  writeHead(...args) {
    for (const arg of args) arg();
    return this;
  }
  writeHeader(...args) {
    for (const arg of args) arg();
    return this;
  }
}

class ClientRequest {
  _onPendingData(...args) {
    for (const arg of args) arg();
  }
  constructor(...args) {
    for (const arg of args) arg();
  }
  _finish(...args) {
    for (const arg of args) arg();
  }
  _implicitHeader(...args) {
    for (const arg of args) arg();
  }
  abort(...args) {
    for (const arg of args) arg();
  }
  destroy(...args) {
    for (const arg of args) arg();
  }
  onSocket(...args) {
    for (const arg of args) arg();
  }
  _deferToConnect(...args) {
    for (const arg of args) arg();
  }
  setTimeout(...args) {
    for (const arg of args) arg();
    return this;
  }
  setNoDelay(...args) {
    for (const arg of args) arg();
  }
  setSocketKeepAlive(...args) {
    for (const arg of args) arg();
  }
  clearTimeout(...args) {
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
  setMaxListeners(...args) {
    for (const arg of args) arg();
  }
  getMaxListeners(...args) {
    for (const arg of args) arg();
  }
  emit(...args) {
    for (const arg of args) arg();
  }
  addListener(...args) {
    for (const arg of args) arg();
    return this;
  }
  on(...args) {
    for (const arg of args) arg();
    return this;
  }
  prependListener(...args) {
    for (const arg of args) arg();
    return this;
  }
  once(...args) {
    for (const arg of args) arg();
    return this;
  }
  prependOnceListener(...args) {
    for (const arg of args) arg();
    return this;
  }
  removeListener(...args) {
    for (const arg of args) arg();
    return this;
  }
  off(...args) {
    for (const arg of args) arg();
    return this;
  }
  removeAllListeners(...args) {
    for (const arg of args) arg();
  }
  listeners(...args) {
    for (const arg of args) arg();
  }
  rawListeners(...args) {
    for (const arg of args) arg();
  }
  listenerCount(...args) {
    for (const arg of args) arg();
  }
  eventNames(...args) {
    for (const arg of args) arg();
  }
  __defineGetter__(...args) {
    for (const arg of args) arg();
  }
  __defineSetter__(...args) {
    for (const arg of args) arg();
  }
  hasOwnProperty(...args) {
    for (const arg of args) arg();
  }
  __lookupGetter__(...args) {
    for (const arg of args) arg();
  }
  __lookupSetter__(...args) {
    for (const arg of args) arg();
  }
  isPrototypeOf(...args) {
    for (const arg of args) arg();
  }
  propertyIsEnumerable(...args) {
    for (const arg of args) arg();
  }
  toString(...args) {
    for (const arg of args) arg();
  }
  valueOf(...args) {
    for (const arg of args) arg();
  }
  toLocaleString(...args) {
    for (const arg of args) arg();
  }
}

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

class Agent {
  constructor(...args) {
    for (const arg of args) arg();
  }
  createConnection(...args) {
    for (const arg of args) arg();
  }
  getName(...args) {
    for (const arg of args) arg();
  }
  addRequest(...args) {
    for (const arg of args) arg();
  }
  createSocket(...args) {
    for (const arg of args) arg();
  }
  removeSocket(...args) {
    for (const arg of args) arg();
  }
  keepSocketAlive(...args) {
    for (const arg of args) arg();
  }
  reuseSocket(...args) {
    for (const arg of args) arg();
  }
  destroy(...args) {
    for (const arg of args) arg();
    return this;
  }
}

function createServer(...args) {
  for (const arg of args) arg();
  return new Server(args);
}

function request(...args) {
  for (const arg of args) arg();
  return new ClientRequest();
}

function get(...args) {
  for (const arg of args) arg();
  return new ClientRequest();
}

function validateHeaderName(...args) {
  for (const arg of args) arg();
}

function validateHeaderValue(...args) {
  for (const arg of args) arg();
}

function setMaxIdleHTTPParsers(...args) {
  for (const arg of args) arg();
}

function _connectionListener(...args) {
  for (const arg of args) arg();
}

module.exports = {
  _connectionListener,
  Agent,
  ClientRequest,
  IncomingMessage,
  OutgoingMessage,
  Server,
  ServerResponse,

  createServer,
  validateHeaderName,
  validateHeaderValue,
  get,
  request,
  setMaxIdleHTTPParsers,

  globalAgent: new Agent(),
};
