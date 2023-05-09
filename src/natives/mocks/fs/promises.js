async function access(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function copyFile(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function cp(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function open(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function opendir(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function rename(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function truncate(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function rm(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function rmdir(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function mkdir(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function readdir(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function readlink(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function symlink(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function lstat(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function stat(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function link(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function unlink(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function chmod(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function lchmod(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function lchown(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function chown(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function utimes(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function lutimes(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function realpath(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function mkdtemp(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function writeFile(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function appendFile(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function readFile(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function watch(...args) {
  for (const arg of args) arg();
  return new Promise();
}

async function statfs(...args) {
  for (const arg of args) arg();
  return new Promise();
}

module.exports = {
  access,
  copyFile,
  cp,
  open,
  opendir,
  rename,
  truncate,
  rm,
  rmdir,
  mkdir,
  readdir,
  readlink,
  symlink,
  lstat,
  stat,
  statfs,
  link,
  unlink,
  chmod,
  lchmod,
  lchown,
  chown,
  utimes,
  lutimes,
  realpath,
  mkdtemp,
  writeFile,
  appendFile,
  readFile,
  watch,
}