const { createGraphFromFile } = require('./lib/parser');

module.exports = function(opts) {
  return {
    parse(sign, file, filename) {
      const g = new Graph({ directed: true })
      return createGraphFromFile(filename, sign, g, opts).then(() => g);
    }
  }
}
