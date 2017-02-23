const Graph = require('graphlib').Graph;
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const { simple } = require('acorn/dist/walk');

// TODO: resolving files with webpack options
function loadFile(file, cnt) {
  if (cnt !== false) {
    return Promise.resolve(cnt);
  }
  return new Promise((resolve, reject) => {
    fs.readFile(file, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result.toString());
      }
    });
  });
}

function buildTree(content, ast, g, sign, opts, filePath) {
  const state = [];
  simple(ast, {
    ImportDeclaration(node, state) {
      // TODO: lookup version of package in package.json if this is a thrird-party dependency
      const newName = path.resolve(path.dirname(filePath), node.source.value) + ".js";
      state.push(createGraphFromFile(newName, sign, g, opts))
    }
  }, false, state);
  return Promise.all(state).then((imports) => {
    g.setNode(filePath, sign(content));
    imports.forEach((imp) => {
      g.setEdge(imp, filePath);
    });
    return filePath;
  });
}

function createGraphFromFile(jsFile, sign, g, opts, content = false) {
  return loadFile(jsFile, content).then((content) => {
    return buildTree(content, acorn.parse(content, { ecmaVersion: 7, sourceType: 'module' }), g, sign, opts, jsFile);
  });
}

module.exports = {
  createGraphFromFile
};
