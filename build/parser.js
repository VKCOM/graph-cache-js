'use strict';

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var Graph = require('graphlib').Graph;
var fs = require('fs');
var path = require('path');
var babylon = require('babylon');
var walk = require('babylon-walk');
var memoize = require('lodash.memoize');

function fileExist(path) {
  return new Promise(function (resolve, reject) {
    fs.stat(path, function (err, stats) {
      if (err) {
        resolve(false);
      } else {
        resolve(stats.isFile());
      }
    });
  });
}

// TODO: resolving files with webpack options
function loadFile(file) {
  var cnt = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;

  if (cnt !== false) {
    return Promise.resolve(cnt);
  }
  return new Promise(function (resolve, reject) {
    fs.readFile(file, function (err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

function cantResolveError(name) {
  return new Error('Can\'t resolve file ' + name);
}

function resolveNpmDep(packageFile, json, depFile) {
  var root = depFile.split(path.sep)[0];
  var packageFileResolve = path.resolve(packageFile);

  var exist = Object.keys(json.dependencies).filter(function (el) {
    return el === root;
  }).length;

  if (exist) {
    return path.join(path.dirname(packageFileResolve), 'node_modules', root, 'package.json');
  } else {
    return false;
  }
}

function resolveName(opts, alias, loadPackageFile, curFile, depFile) {
  if (alias) {
    var error = false;

    alias.some(function (item) {
      if (depFile.indexOf(item.key) !== 0) return;

      if (item.exactMatch) {
        if (item.key !== depFile) {
          error = true;
        } else {
          depFile = item.value;
        }

        return true;
      }

      depFile = path.normalize(depFile.replace(item.key, item.value));

      // Convert to relative path.
      // An alternative would be to handle absolute paths in general case as well
      if (path.isAbsolute(depFile)) {
        depFile = path.relative(path.dirname(curFile), depFile);
      }

      // path.normalize extracts `./`
      if (depFile[0] !== '.') {
        depFile = './' + depFile;
      }

      return true;
    });

    if (error) {
      return Promise.reject(cantResolveError(depFile));
    }
  }

  if (depFile[0] === '.') {
    var extName = '';
    if (!path.extname(depFile)) {
      extName = '.js';
    }
    var candidate = path.resolve(path.dirname(curFile), depFile) + extName;
    if (extName === '') {
      return fileExist(candidate).then(function (result) {
        if (result) {
          return candidate;
        } else {
          return candidate + '.js';
        }
      });
    } else {
      return Promise.resolve(candidate);
    }
  }

  if (opts.packageJSON) {
    return loadPackageFile(opts.packageJSON).then(function (json) {
      var filePath = resolveNpmDep(opts.packageJSON, json, depFile);
      if (!filePath) {
        throw cantResolveError(depFile);
      }
      return filePath;
    });
  }

  return Promise.reject(cantResolveError(depFile));
}

function buildTree(resolveName, ast, g, filePath) {
  var state = [];
  walk.simple(ast, {
    ImportDeclaration: function ImportDeclaration(node, state) {
      state.push(resolveName(filePath, node.source.value).then(function (newName) {
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
  }, state);
  return Promise.all(state).then(function (deps) {
    return deps.filter(function (el) {
      return !!el;
    });
  });
}

function parseFile(opts, fileContent) {
  var plugins = opts && Array.isArray(opts.plugins) ? opts.plugins : [];

  return babylon.parse(fileContent, {
    ecmaVersion: 7,
    sourceType: 'module',
    plugins: plugins
  });
}

function resolveModule(opts, parser, jsFile) {
  var content = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : false;

  return loadFile(jsFile, content).then(function (content) {
    return [content, parser(content.toString())];
  });
}

function createGraphFromFileHelper(sign, resolveFile, buildTree, g, jsFile) {
  var content = arguments.length > 5 && arguments[5] !== undefined ? arguments[5] : false;

  // we don't want to parse those files, this is a leaf
  if (path.basename(jsFile) === 'package.json') {
    return loadFile(jsFile).then(function (content) {
      g.setNode(jsFile, sign(content));
      return g;
    });
  }

  if (jsFile.match(/\.php$/)) {
    return loadFile(jsFile).then(function (content) {
      g.setNode(jsFile, sign(content));
      return g;
    });
  }

  return resolveFile(jsFile, content).then(function (_ref) {
    var _ref2 = _slicedToArray(_ref, 2),
        content = _ref2[0],
        ast = _ref2[1];

    g.setNode(jsFile, sign(content));
    return buildTree(ast, g, jsFile).then(function (deps) {
      return Promise.all(deps.map(function (dep) {
        return createGraphFromFileHelper(sign, resolveFile, buildTree, g, dep);
      }));
    }).then(function () {
      return g;
    });
  });
}

function loadJSON(file) {
  return loadFile(file).then(function (cnt) {
    return JSON.parse(cnt.toString());
  });
}

// To be compatible with webpack, logic take from:
// https://github.com/webpack/enhanced-resolve/blob/49cddd1c5757849b1e0b53b9c765525b840c3b59/lib/ResolverFactory.js#L127s
function prepareAlias(alias) {
  if (!alias) {
    return null;
  }

  return Object.keys(alias).map(function (key) {
    var exactMatch = false;
    var obj = alias[key];

    if (key[key.length - 1] === '$') {
      exactMatch = true;
      key = key.slice(0, key.length - 1);
    }

    if (typeof obj === 'string') {
      obj = {
        value: obj
      };
    }

    obj = Object.assign({
      key: key,
      exactMatch: exactMatch
    }, obj);

    return obj;
  });
}

function createGraphFromFile(filename, sign, opts) {
  var file = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : false;

  var g = new Graph({ directed: true });
  var parser = parseFile.bind(null, opts);
  var alias = prepareAlias(opts.alias);
  var resolveFile = resolveModule.bind(null, opts, parser);
  var resolve = resolveName.bind(null, opts, alias, memoize(loadJSON));
  var build = buildTree.bind(null, resolve);
  return createGraphFromFileHelper(sign, resolveFile, build, g, filename, file);
}

module.exports = {
  createGraphFromFile: createGraphFromFile
};