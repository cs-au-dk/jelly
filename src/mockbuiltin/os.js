function arch(...args) {
  for (const arg of args) arg();
}

function cpus(...args) {
  for (const arg of args) arg();
}

function endianness(...args) {
  for (const arg of args) arg();
}

function freemem(...args) {
  for (const arg of args) arg();
}

function getPriority(...args) {
  for (const arg of args) arg();
}

function homedir(...args) {
  for (const arg of args) arg();
}

function hostname(...args) {
  for (const arg of args) arg();
}

function loadavg(...args) {
  for (const arg of args) arg();
}

function networkInterfaces(...args) {
  for (const arg of args) arg();
}

function platform(...args) {
  for (const arg of args) arg();
}

function release(...args) {
  for (const arg of args) arg();
}

function setPriority(...args) {
  for (const arg of args) arg();
}

function tmpdir(...args) {
  for (const arg of args) arg();
}

function totalmem(...args) {
  for (const arg of args) arg();
}

function type(...args) {
  for (const arg of args) arg();
}

function userInfo(...args) {
  for (const arg of args) arg();
}

function uptime(...args) {
  for (const arg of args) arg();
}

function version(...args) {
  for (const arg of args) arg();
}

function machine(...args) {
  for (const arg of args) arg();
}

module.exports = {
  arch,
  availableParallelism,
  cpus,
  endianness,
  freemem,
  getPriority,
  homedir,
  hostname,
  loadavg,
  networkInterfaces,
  platform,
  release,
  setPriority,
  tmpdir,
  totalmem,
  type,
  userInfo,
  uptime,
  version,
  machine,
};