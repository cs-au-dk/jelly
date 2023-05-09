function checkInvalidHeaderChar(...args) {
  for (const arg of args) arg();
}
function checkIsHttpToken(...args) {
  for (const arg of args) arg();
}
function freeParser(...args) {
  for (const arg of args) arg();
}
function isLenient(...args) {
  for (const arg of args) arg();
}
function prepareError(...args) {
  for (const arg of args) arg();
}

class HTTPParser {
  close(...args) {
    for (const arg of args) arg();
  }
  free(...args) {
    for (const arg of args) arg();
  }
  remove(...args) {
    for (const arg of args) arg();
  }
  execute(...args) {
    for (const arg of args) arg();
  }
  finish(...args) {
    for (const arg of args) arg();
  }
  initialize(...args) {
    for (const arg of args) arg();
  }
  pause(...args) {
    for (const arg of args) arg();
  }
  resume(...args) {
    for (const arg of args) arg();
  }
  consume(...args) {
    for (const arg of args) arg();
  }
  unconsume(...args) {
    for (const arg of args) arg();
  }
  getCurrentBuffer(...args) {
    for (const arg of args) arg();
  }
  duration(...args) {
    for (const arg of args) arg();
  }
  headersCompleted(...args) {
    for (const arg of args) arg();
  }
}

module.exports = {
  _checkInvalidHeaderChar: checkInvalidHeaderChar,
  _checkIsHttpToken: checkIsHttpToken,
  freeParser,
  isLenient,
  prepareError,
  HTTPParser,
};
