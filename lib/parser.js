const Graph = require('graphlib').Graph;
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const { simple } = require('acorn/dist/walk');
const memoize = require('lodash.memoize');

// TODO: resolving files with webpack options
function loadFile(file, cnt = false) {
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

function cantResolveError(name) {
  return new Error(`Can\'t resolve file ${name}`);
}

function resolveNpmDep(packageFile, json, depFile) {
  const root = depFile.split(path.sep)[0];
  const packageFileResolve = path.resolve(packageFile);

  const exist = Object.keys(json.dependencies)
    .filter((el) => el === root).length;

  if (exist) {
    return path.join(path.dirname(packageFileResolve), 'node_modules', root, 'package.json');
  } else {
    return false;
  }
}

function resolveName(opts, loadPackageFile, curFile, depFile) {
  if (depFile[0] === '.') {
    return Promise.resolve(path.resolve(path.dirname(curFile), depFile) + ".js");
  }

  if (opts.packageJSON) {
    return loadPackageFile(opts.packageJSON)
      .then((json) => {
        const filePath = resolveNpmDep(opts.packageJSON, json, depFile);
        if (!filePath) {
          throw cantResolveError(depFile);
        }
        return filePath;
      });
  }

  return Promise.reject(cantResolveError(depFile));
}

function buildTree(resolveName, content, ast, g, filePath) {
  const state = [];
  simple(ast, {
    ImportDeclaration(node, state) {
      state.push(resolveName(filePath, node.source.value).then((newName) => {
        // we already handled this file as dep
        if (g.hasEdge(newName, filePath)) {
          return false;
        }

        if (!g.hasEdge(filePath, newName)) {
          g.setEdge(newName, filePath);
          return newName;
        }

        // this is a cyclic dep
        g.setEdge(newName, filePath);
        return false;
      }));
    }
  }, false, state);
  return Promise.all(state)
    .then((deps) => deps.filter(el => !!el));
}

function parseFile(opts, fileContent) {
  return acorn.parse(fileContent, { ecmaVersion: 7, sourceType: 'module' });
}

function resolveModule(opts, parser, jsFile, content = false) {
  return loadFile(jsFile, content).then((content) => {
    return [content, parser(content)];
  })
}

function createGraphFromFileHelper(sign, resolveFile, buildTree, g, jsFile, content = false) {
  // we don't want to parse those files, this is a leaf
  if (path.basename(jsFile) === 'package.json') {
    return Promise.resolve(g);
  }

  return resolveFile(jsFile, content).then(([content, ast]) => {
    g.setNode(jsFile, sign(content));
    return buildTree(content, ast, g, jsFile).then((deps) => {
      return Promise.all(deps.map((dep) => {
        return createGraphFromFileHelper(sign, resolveFile, buildTree, g, dep);
      }));
    }).then(() => g);
  });
}

function loadJSON(file) {
  return loadFile(file).then((cnt) => JSON.parse(cnt));
}

function createGraphFromFile(filename, sign, opts, file = false) {
  const g = new Graph({ directed: true });
  const parser = parseFile.bind(null, opts);
  const resolveFile = resolveModule.bind(null, opts, parser);
  const resolve = resolveName.bind(null, opts, memoize(loadJSON));
  const build = buildTree.bind(null, resolve);
  return createGraphFromFileHelper(sign, resolveFile, build, g, filename, file);
}

module.exports = {
  createGraphFromFile
};
