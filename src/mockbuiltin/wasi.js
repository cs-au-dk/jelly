class WASI {
  constructor(...args) {
    for (const arg of args) arg();
  }

  start(...args) {
    for (const arg of args) arg();
  }

  initialize(...args) {
    for (const arg of args) arg();
  }

  getImportObject(...args) {
    for (const arg of args) arg();
  }
}

module.exports = { WASI };
