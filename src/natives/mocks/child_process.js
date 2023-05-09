function _forkChild(...args) {
  for (const arg of args) arg();
}

function exec(...args) {
  for (const arg of args) arg();
}

function execFile(...args) {
  for (const arg of args) arg();
}

function execFileSync(...args) {
  for (const arg of args) arg();
}

function execSync(...args) {
  for (const arg of args) arg();
}

function fork(...args) {
  for (const arg of args) arg();
}

function spawn(...args) {
  for (const arg of args) arg();
}

function spawnSync(...args) {
  for (const arg of args) arg();
}

const EventEmitter = require('events');
class ChildProcess extends EventEmitter {
  constructor(...args) {
    for (const arg of args) arg();
  }

  spawn(...args) {
    for (const arg of args) arg();
  }

  kill(...args) {
    for (const arg of args) arg();
  }

  ref(...args) {
    for (const arg of args) arg();
  }

  unref(...args) {
    for (const arg of args) arg();
  }
}

module.exports = {
  _forkChild,
  ChildProcess,
  exec,
  execFile,
  execFileSync,
  execSync,
  fork,
  spawn,
  spawnSync,
};
