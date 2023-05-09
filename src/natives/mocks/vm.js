class Script {
  constructor(...args) {
    for (const arg of args) arg();
  }

  runInContext(...args) {
    for (const arg of args) arg();
  }

  runInNewContext(...args) {
    for (const arg of args) arg();
  }

  runInThisContext(...args) {
    for (const arg of args) arg();
  }
}

function createContext(...args) {
  for (const arg of args) arg();
}

function createScript(...args) {
  for (const arg of args) arg();
  return new Script();
}

function runInContext(...args) {
  for (const arg of args) arg();
}

function runInNewContext(...args) {
  for (const arg of args) arg();
}

function runInThisContext(...args) {
  for (const arg of args) arg();
}

function isContext(...args) {
  for (const arg of args) arg();
}

function compileFunction(...args) {
  for (const arg of args) arg();
}

function measureMemory(...args) {
  for (const arg of args) arg();
}

module.exports = {
  Script,
  createContext,
  createScript,
  runInContext,
  runInNewContext,
  runInThisContext,
  isContext,
  compileFunction,
  measureMemory,
};
