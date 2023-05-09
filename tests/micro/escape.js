const BlueBird = require('bluebird');
const _ = require('lodash');
const t = _.template;
BlueBird.promisify(t);
BlueBird.bar = t;
module.exports = t;
module.exports.baz = t;
