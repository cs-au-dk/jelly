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

module.exports = {
  Agent,
  globalAgent: new Agent(),
}