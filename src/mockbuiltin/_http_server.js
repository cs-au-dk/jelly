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

function setupConnectionsTracking(...args) {
  for (const arg of args) arg();
}

function storeHTTPOptions(...args) {
  for (const arg of args) arg();
}

function connectionListener(...args) {
  for (const arg of args) arg();
}

module.exports = {
  Server,
  ServerResponse,
  setupConnectionsTracking,
  storeHTTPOptions,
  _connectionListener: connectionListener,
};