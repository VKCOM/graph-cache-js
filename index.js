const { createGraphFromFile } = require('./lib/parser');

module.exports = function(opts) {
  return {
    parse(sign, file, filename) {
      return createGraphFromFile(filename, sign, opts, file);
    }
  }
}
