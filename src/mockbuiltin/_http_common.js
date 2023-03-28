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

module.exports = {
  _checkInvalidHeaderChar: checkInvalidHeaderChar,
  _checkIsHttpToken: checkIsHttpToken,
  freeParser,
  isLenient,
  prepareError,
};
