const { Writable } = require("stream");

function checkPrime(...args) {
  for (const arg of args) arg();
}

function checkPrimeSync(...args) {
  for (const arg of args) arg();
}

function createCipheriv(...args) {
  for (const arg of args) arg();
}

function createDecipheriv(...args) {
  for (const arg of args) arg();
}

function createDiffieHellman(...args) {
  for (const arg of args) arg();
}

function createDiffieHellmanGroup(...args) {
  for (const arg of args) arg();
}

function createECDH(...args) {
  for (const arg of args) arg();
}

function createHash(...args) {
  for (const arg of args) arg();
}

function createHmac(...args) {
  for (const arg of args) arg();
}

function createPrivateKey(...args) {
  for (const arg of args) arg();
}

function createPublicKey(...args) {
  for (const arg of args) arg();
}

function createSecretKey(...args) {
  for (const arg of args) arg();
}

function createSign(...args) {
  for (const arg of args) arg();
}

function createVerify(...args) {
  for (const arg of args) arg();
}

function diffieHellman(...args) {
  for (const arg of args) arg();
}

function generatePrime(...args) {
  for (const arg of args) arg();
}

function generatePrimeSync(...args) {
  for (const arg of args) arg();
}

function getCiphers(...args) {
  for (const arg of args) arg();
}

function getCipherInfo(...args) {
  for (const arg of args) arg();
}

function getCurves(...args) {
  for (const arg of args) arg();
}

function getDiffieHellman(...args) {
  for (const arg of args) arg();
}

function getHashes(...args) {
  for (const arg of args) arg();
}

function hkdf(...args) {
  for (const arg of args) arg();
}

function hkdfSync(...args) {
  for (const arg of args) arg();
}

function pbkdf2(...args) {
  for (const arg of args) arg();
}

function pbkdf2Sync(...args) {
  for (const arg of args) arg();
}

function generateKeyPair(...args) {
  for (const arg of args) arg();
}

function generateKeyPairSync(...args) {
  for (const arg of args) arg();
}

function generateKey(...args) {
  for (const arg of args) arg();
}

function generateKeySync(...args) {
  for (const arg of args) arg();
}

function privateDecrypt(...args) {
  for (const arg of args) arg();
}

function privateEncrypt(...args) {
  for (const arg of args) arg();
}

function publicDecrypt(...args) {
  for (const arg of args) arg();
}

function publicEncrypt(...args) {
  for (const arg of args) arg();
}

function randomBytes(...args) {
  for (const arg of args) arg();
}

function randomFill(...args) {
  for (const arg of args) arg();
}

function randomFillSync(...args) {
  for (const arg of args) arg();
}

function randomInt(...args) {
  for (const arg of args) arg();
}

function randomUUID(...args) {
  for (const arg of args) arg();
}

function scrypt(...args) {
  for (const arg of args) arg();
}

function scryptSync(...args) {
  for (const arg of args) arg();
}

function sign(...args) {
  for (const arg of args) arg();
}

function setEngine(...args) {
  for (const arg of args) arg();
}

function timingSafeEqual(...args) {
  for (const arg of args) arg();
}

function getFips(...args) {
  for (const arg of args) arg();
}

function setFips(...args) {
  for (const arg of args) arg();
}

function verify(...args) {
  for (const arg of args) arg();
}

function secureHeapUsed(...args) {
  for (const arg of args) arg();
}

function createCipher(...args) {
  for (const arg of args) arg();
  return new Cipher();
}

function createDecipher(...args) {
  for (const arg of args) arg();
  return new Decipher();
}

function getRandomValues(...args) {
  for (const arg of args) arg();
}

function prng(...args) {
  for (const arg of args) arg();
}

function pseudoRandomBytes(...args) {
  for (const arg of args) arg();
}

function rng(...args) {
  for (const arg of args) arg();
}

class LazyTransform {
  constructor(...args) {
    for (const arg of args) arg();
  }

  update(...args) {
    for (const arg of args) arg();
  }

  final(...args) {
    for (const arg of args) arg();
  }

  setAAD(...args) {
    for (const arg of args) arg();
  }

  getAuthTag(...args) {
    for (const arg of args) arg();
  }

  setAutoPadding(...args) {
    for (const arg of args) arg();
  }

  _transform(...args) {
    for (const arg of args) arg();
  }

  _flush(...args) {
    for (const arg of args) arg();
  }
}

class Certificate {
  constructor(...args) {
    for (const arg of args) arg();
  }

  exportChallenge(...args) {
    for (const arg of args) arg();
  }

  exportPublicKey(...args) {
    for (const arg of args) arg();
  }

  verifySpkac(...args) {
    for (const arg of args) arg();
  }
}

class Cipher extends LazyTransform { }

class Decipher extends LazyTransform { }

class X509Certificate {
  constructor(...args) {
    for (const arg of args) arg();
  }

  toString(...args) {
    for (const arg of args) arg();
  }

  toJSON(...args) {
    for (const arg of args) arg();
  }

  checkHost(...args) {
    for (const arg of args) arg();
  }

  checkEmail(...args) {
    for (const arg of args) arg();
  }

  checkIP(...args) {
    for (const arg of args) arg();
  }

  checkIssued(...args) {
    for (const arg of args) arg();
  }

  checkPrivateKey(...args) {
    for (const arg of args) arg();
  }

  verify(...args) {
    for (const arg of args) arg();
  }

  toLegacyObject(...args) {
    for (const arg of args) arg();
  }
}

class Sign extends Writable { }

class Verify extends Writable {
  constructor(...args) {
    for (const arg of args) arg();
  }

  verify(...args) {
    for (const arg of args) arg();
  }
}

class Cipheriv extends LazyTransform {}

class Decipheriv extends LazyTransform { }

class DiffieHellman { 
  constructor(...args) {
    for (const arg of args) arg();
  }

  generateKeys(...args) {
    for (const arg of args) arg();
  }

  computeSecret(...args) {
    for (const arg of args) arg();
  }

  getPrime(...args) {
    for (const arg of args) arg();
  }

  getGenerator(...args) {
    for (const arg of args) arg();
  }

  getPublicKey(...args) {
    for (const arg of args) arg();
  }
  
  getPrivateKey(...args) {
    for (const arg of args) arg();
  }

  setPublicKey(...args) {
    for (const arg of args) arg();
  }

  setPrivateKey(...args) {
    for (const arg of args) arg();
  } 
}

class DiffieHellmanGroup { 
  constructor(...args) {
    for (const arg of args) arg();
  }

  generateKeys(...args) {
    for (const arg of args) arg();
  }

  computeSecret(...args) {
    for (const arg of args) arg();
  }

  getPrime(...args) {
    for (const arg of args) arg();
  } 

  getGenerator(...args) {
    for (const arg of args) arg();
  }

  getPublicKey(...args) {
    for (const arg of args) arg();
  } 

  getPrivateKey(...args) {
    for (const arg of args) arg();
  }
}

class ECDH extends DiffieHellman {
  constructor(...args) {
    for (const arg of args) arg();
  }

  convertKey(...args) {
    for (const arg of args) arg();
  }
}

class Hmac extends LazyTransform{
  constructor(...args) {
    for (const arg of args) arg();
  }

  update(...args) {
    for (const arg of args) arg();
  }

  digest(...args) {
    for (const arg of args) arg();
  }
}

class Hash extends LazyTransform {
  constructor(...args) {
    for (const arg of args) arg();
  }

  update(...args) {
    for (const arg of args) arg();
  }

  digest(...args) {
    for (const arg of args) arg();
  }

  copy(...args) {
    for (const arg of args) arg();
  }
}

class KeyObject { }

module.exports = {
  // Methods
  checkPrime,
  checkPrimeSync,
  createCipheriv,
  createDecipheriv,
  createDiffieHellman,
  createDiffieHellmanGroup,
  createECDH,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  createSecretKey,
  createSign,
  createVerify,
  diffieHellman,
  generatePrime,
  generatePrimeSync,
  getCiphers,
  getCipherInfo,
  getCurves,
  getDiffieHellman,
  getHashes,
  hkdf,
  hkdfSync,
  pbkdf2,
  pbkdf2Sync,
  generateKeyPair,
  generateKeyPairSync,
  generateKey,
  generateKeySync,
  privateDecrypt,
  privateEncrypt,
  publicDecrypt,
  publicEncrypt,
  randomBytes,
  randomFill,
  randomFillSync,
  randomInt,
  randomUUID,
  scrypt,
  scryptSync,
  sign,
  setEngine,
  timingSafeEqual,
  getFips,
  setFips,
  verify,
  prng,
  pseudoRandomBytes,
  rng,
  createCipher,
  createDecipher,
  getRandomValues,

  // Classes
  Certificate,
  Cipher,
  Cipheriv,
  Decipher,
  Decipheriv,
  DiffieHellman,
  DiffieHellmanGroup,
  ECDH,
  Hash,
  Hmac,
  KeyObject,
  Sign,
  Verify,
  X509Certificate,
  secureHeapUsed,
};