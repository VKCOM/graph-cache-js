const Parser = require('./build/parser');
const createGraphFromFile = Parser.createGraphFromFile;

module.exports = function(opts) {
  return {
    parse: function(sign, file, filename) {
      return createGraphFromFile(filename, sign, opts, file);
    }
  };
};
