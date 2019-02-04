const Graph = require("graphlib").Graph;
const fs = require("fs");
const path = require("path");
const babylon = require("babylon");
const walk = require("babylon-walk");
const memoize = require("lodash.memoize");

function fileExist(path) {
  return new Promise((resolve, reject) => {
    fs.stat(path, (err, stats) => {
      if (err) {
        resolve(false);
      } else {
        resolve(stats.isFile());
      }
    });
  });
}

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
        resolve(result);
      }
    });
  });
}

function cantResolveError(name) {
  return new Error(`Can\'t resolve file ${name}`);
}

function resolveNpmDep(packageFile, json, depFile) {
  let root = depFile.split(path.sep)[0];
  const packageFileResolve = path.resolve(packageFile);

  if (root.indexOf("@") === 0) {
    root += path.sep + depFile.split(path.sep)[1];
  }

  const exist = Object.keys(json.dependencies).filter(el => el === root).length;

  if (exist) {
    return path.join(
      path.dirname(packageFileResolve),
      "node_modules",
      root,
      "package.json"
    );
  } else {
    return false;
  }
}

function resolveName(opts, alias, loadPackageFile, curFile, depFile) {
  if (alias) {
    let error = false;

    alias.some(item => {
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
      if (depFile[0] !== ".") {
        depFile = "./" + depFile;
      }

      return true;
    });

    if (error) {
      return Promise.reject(cantResolveError(depFile));
    }
  }

  if (depFile[0] === ".") {
    let extName = "";
    if (!path.extname(depFile)) {
      extName = ".js";
    }
    const candidate = path.resolve(path.dirname(curFile), depFile) + extName;
    if (extName === "") {
      return fileExist(candidate).then(result => {
        if (result) {
          return candidate;
        } else {
          return candidate + ".js";
        }
      });
    } else {
      return Promise.resolve(candidate);
    }
  }

  if (opts.packageJSON) {
    return loadPackageFile(opts.packageJSON).then(json => {
      const filePath = resolveNpmDep(opts.packageJSON, json, depFile);
      if (!filePath) {
        throw cantResolveError(depFile);
      }
      return filePath;
    });
  }

  return Promise.reject(cantResolveError(depFile));
}

function buildTree(resolveName, ast, g, filePath) {
  const state = [];
  walk.simple(
    ast,
    {
      ImportDeclaration(node, state) {
        state.push(
          resolveName(filePath, node.source.value).then(async newName => {
            const exist = await fileExist(newName);
            if (!exist) {
              const parsed = path.parse(newName);
              newName = parsed.dir + path.sep + parsed.name + path.sep + 'index.js';
            }

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
          })
        );
      }
    },
    state
  );
  return Promise.all(state).then(deps => deps.filter(el => !!el));
}

function parseFile(opts, fileContent) {
  const plugins = opts && Array.isArray(opts.plugins) ? opts.plugins : [];

  return babylon.parse(fileContent, {
    ecmaVersion: 7,
    sourceType: "module",
    plugins: plugins
  });
}

function resolveModule(opts, parser, jsFile, content = false) {
  return loadFile(jsFile, content).then(content => {
    return [content, parser(content.toString())];
  });
}

function createGraphFromFileHelper(
  sign,
  resolveFile,
  buildTree,
  g,
  jsFile,
  content = false
) {
  // we don't want to parse those files, this is a leaf
  if (path.basename(jsFile) === "package.json") {
    return loadFile(jsFile).then(content => {
      g.setNode(jsFile, sign(content));
      return g;
    });
  }

  if (jsFile.match(/\.php$/)) {
    return loadFile(jsFile).then(content => {
      g.setNode(jsFile, sign(content));
      return g;
    });
  }

  return resolveFile(jsFile, content).then(([content, ast]) => {
    g.setNode(jsFile, sign(content));
    return buildTree(ast, g, jsFile)
      .then(deps => {
        return Promise.all(
          deps.map(dep => {
            return createGraphFromFileHelper(
              sign,
              resolveFile,
              buildTree,
              g,
              dep
            );
          })
        );
      })
      .then(() => g);
  });
}

function loadJSON(file) {
  return loadFile(file).then(cnt => JSON.parse(cnt.toString()));
}

// To be compatible with webpack, logic take from:
// https://github.com/webpack/enhanced-resolve/blob/49cddd1c5757849b1e0b53b9c765525b840c3b59/lib/ResolverFactory.js#L127s
function prepareAlias(alias) {
  if (!alias) {
    return null;
  }

  return Object.keys(alias).map(key => {
    let exactMatch = false;
    let obj = alias[key];

    if (key[key.length - 1] === "$") {
      exactMatch = true;
      key = key.slice(0, key.length - 1);
    }

    if (typeof obj === "string") {
      obj = {
        value: obj
      };
    }

    obj = Object.assign(
      {
        key: key,
        exactMatch: exactMatch
      },
      obj
    );

    return obj;
  });
}

function createGraphFromFile(filename, sign, opts, file = false) {
  const g = new Graph({ directed: true });
  const parser = parseFile.bind(null, opts);
  const alias = prepareAlias(opts.alias);
  const resolveFile = resolveModule.bind(null, opts, parser);
  const resolve = resolveName.bind(null, opts, alias, memoize(loadJSON));
  const build = buildTree.bind(null, resolve);
  return createGraphFromFileHelper(sign, resolveFile, build, g, filename, file);
}

module.exports = {
  createGraphFromFile
};
