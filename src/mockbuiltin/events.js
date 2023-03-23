class EventEmitter {
  constructor(...args) {
    for (const arg of args) arg();
  }
  setMaxListeners(...args) {
    for (const arg of args) arg();
    return this;
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
}

function once(...args) {
  for (const arg of args) arg();
}

function on(...args) {
  for (const arg of args) arg();
}

function getEventListeners(...args) {
  for (const arg of args) arg();
}

module.exports = {
  EventEmitter,
  once,
  on,
  getEventListeners,
};
