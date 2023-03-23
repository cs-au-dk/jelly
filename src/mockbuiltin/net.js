const { EventEmitter } = require("./events");

class Socket {
  constructor(...args) {
    for (const arg of args) arg();
  }
  _unrefTimer(...args) {
    for (const arg of args) arg();
  }
  _final(...args) {
    for (const arg of args) arg();
  }
  setTimeout(...args) {
    for (const arg of args) arg();
    return this;
  }
  _onTimeout(...args) {
    for (const arg of args) arg();
  }
  setNoDelay(...args) {
    for (const arg of args) arg();
    return this;
  }
  setKeepAlive(...args) {
    for (const arg of args) arg();
    return this;
  }
  address(...args) {
    for (const arg of args) arg();
  }
  _read(...args) {
    for (const arg of args) arg();
  }
  end(...args) {
    for (const arg of args) arg();
    return this;
  }
  resetAndDestroy(...args) {
    for (const arg of args) arg();
  }
  pause(...args) {
    for (const arg of args) arg();
  }
  resume(...args) {
    for (const arg of args) arg();
  }
  read(...args) {
    for (const arg of args) arg();
  }
  destroySoon(...args) {
    for (const arg of args) arg();
  }
  _destroy(...args) {
    for (const arg of args) arg();
  }
  _reset(...args) {
    for (const arg of args) arg();
  }
  _getpeername(...args) {
    for (const arg of args) arg();
  }
  _getsockname(...args) {
    for (const arg of args) arg();
  }
  _writeGeneric(...args) {
    for (const arg of args) arg();
  }
  _writev(...args) {
    for (const arg of args) arg();
  }
  _write(...args) {
    for (const arg of args) arg();
  }
  connect(...args) {
    for (const arg of args) arg();
  }
  ref(...args) {
    for (const arg of args) arg();
    return this;
  }
  unref(...args) {
    for (const arg of args) arg();
    return this;
  }
}

class Server extends EventEmitter {
  constructor(...args) {
    for (const arg of args) arg();
  }
  _listen2(...args) {
    for (const arg of args) arg();
  }
  listen(...args) {
    for (const arg of args) arg();
    return this;
  }
  address(...args) {
    for (const arg of args) arg();
  }
  getConnections(...args) {
    for (const arg of args) arg();
    return this;
  }
  close(...args) {
    for (const arg of args) arg();
  }
  _emitCloseIfDrained(...args) {
    for (const arg of args) arg();
  }
  _setupWorker(...args) {
    for (const arg of args) arg();
  }
  ref(...args) {
    for (const arg of args) arg();
    return this;
  }
  unref(...args) {
    for (const arg of args) arg();
    return this;
  }
}

class BlockList {
  constructor(...args) {
    for (const arg of args) arg();
  }
  addAddress(...args) {
    for (const arg of args) arg();
  }
  addRange(...args) {
    for (const arg of args) arg();
  }
  addSubnet(...args) {
    for (const arg of args) arg();
  }
  check(...args) {
    for (const arg of args) arg();
  }
}

class SocketAddress {
  constructor(...args) {
    for (const arg of args) arg();
  }
}

function _createServerHandle(...args) {
  for (const arg of args) arg();
}
function _normalizeArgs(...args) {
  for (const arg of args) arg();
}
function _setSimultaneousAccepts(...args) {
  for (const arg of args) arg();
}
function connect(...args) {
  for (const arg of args) arg();
}
function createConnection(...args) {
  for (const arg of args) arg();
  return new Socket();
}
function createServer(...args) {
  for (const arg of args) arg();
  return new Server();
}
function isIP(...args) {
  for (const arg of args) arg();
}
function isIPv4(...args) {
  for (const arg of args) arg();
}
function isIPv6(...args) {
  for (const arg of args) arg();
}

module.exports = {
  _createServerHandle,
  _normalizeArgs,
  _setSimultaneousAccepts,
  BlockList,
  SocketAddress,
  connect,
  createConnection,
  createServer,
  isIP,
  isIPv4,
  isIPv6,
  Server,
  Socket,
  Stream: Socket, // Legacy naming
};
