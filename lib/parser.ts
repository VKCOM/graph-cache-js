import { Graph } from 'graphlib';
import * as fs from 'fs';
import * as ts from 'typescript';
import * as path from 'path';
const memoize = require('lodash.memoize');

type JsonDeps = {
  dependencies: { [key: string]: unknown };
};

type Alias = {
  key: string;
  value: string;
  exactMatch: boolean;
};

type Opts = {
  plugins: unknown[]; // TODO
  alias: { [key: string]: string | Alias };
  packageJSON: string;
};
type ParserFunc = (content: string) => ts.Node;
type SignFunc = (content: Buffer) => number; /* unsigned int */

type BuildTreeFunc = (rootNode: ts.Node, g: Graph, jsFile: string) => Promise<string[]>;
type ResolverFunc = (filePath: string, edgePath: string) => Promise<string>;
type FileResolverFunc = (filePath: string, content: Buffer | false) => Promise<[Buffer, ts.Node]>;
type LoadPackageFunc = (packageJsonPath: string) => Promise<JsonDeps>;

function fileExist(path: string) {
  try {
    let stat = fs.statSync(path);
    return stat.isFile();
  } catch (e) {
    return false;
  }
}

// TODO: resolving files with webpack options
function loadFile(file: string, cnt: Buffer | false = false): Promise<Buffer> {
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

function cantResolveError(name: string) {
  return new Error(`Can\'t resolve file ${name}`);
}

function resolveNpmDep(packageFile: string, json: JsonDeps, depFile: string) {
  let root = depFile.split(path.sep)[0];
  const packageFileResolve = path.resolve(packageFile);

  if (root.startsWith('@')) {
    root += path.sep + depFile.split(path.sep)[1];
  }

  const exist = Object.keys(json.dependencies)
    .filter((el) => el === root).length;

  if (exist) {
    return path.join(path.dirname(packageFileResolve), 'node_modules', root, 'package.json');
  } else {
    return false;
  }
}

function resolveName(opts: Opts, alias: Alias[], loadPackageFile: LoadPackageFunc, curFile: string, depFile: string) {
  if (alias) {
    let error = false;

    alias.some((item) => {
      if (!depFile.startsWith(item.key)) return;

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
      if (!depFile.startsWith('.')) {
        depFile = './' + depFile;
      }

      return true;
    });

    if (error) {
      return Promise.reject(cantResolveError(depFile));
    }
  }

  if (depFile.startsWith('.')) {
    let extName = '';
    if (!path.extname(depFile)) {
      extName = '.js';
    }
    const candidate = path.resolve(path.dirname(curFile), depFile) + extName;
    if (extName === '') {
      return Promise.resolve(fileExist(candidate) ? candidate : candidate + '.js');
    } else {
      return Promise.resolve(candidate);
    }
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

function _addEdge(resolveName: ResolverFunc, g: Graph, filePath: string, edgePath: string): Promise<string | false> {
  try {
    if (require.resolve.paths(edgePath) === null) {
      return Promise.resolve(false);
    }
  } catch (err) {

  }

  return resolveName(filePath, edgePath).then((newName) => {
    const parsed = path.parse(newName);
    const pathsToCheck = [
      newName,
      path.join(parsed.dir, parsed.name + '.ts'),
      path.join(parsed.dir, parsed.name + '.tsx'),
      path.join(parsed.dir, parsed.name, 'index.ts'),
      path.join(parsed.dir, parsed.name, 'index.tsx'),
      path.join(parsed.dir, parsed.name, 'index.js')
    ];

    for (let path of pathsToCheck) {
      newName = path;
      if (fileExist(path)) {
        break;
      }
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
  });
}

function buildTree(resolveName: ResolverFunc, rootNode: ts.Node, g: Graph, filePath: string): Promise<string[]> {
  const state: Array<Promise<string | false>> = [];
  const addEdge = (filePath: string, edgePath: string) => _addEdge(resolveName, g, filePath, edgePath);

  function traverseChildren(node: ts.Node) {
    let n;
    switch (node.kind) {
      case ts.SyntaxKind.ImportDeclaration:
        n = node as ts.ImportDeclaration;
        let text = (n.moduleSpecifier as ts.StringLiteral).text;
        state.push(addEdge(filePath, text));
        break;
      case ts.SyntaxKind.ExportDeclaration:
        n = node as ts.ExportDeclaration;
        if (n.moduleSpecifier) {
          let text = (n.moduleSpecifier as ts.StringLiteral).text;
          state.push(addEdge(filePath, text));
        }
        break;
      case ts.SyntaxKind.CallExpression:
        n = node as ts.CallExpression;
        if (n.expression.kind === ts.SyntaxKind.Identifier && (n.expression as ts.Identifier).escapedText === 'require') {
          if (n.arguments[0] && n.arguments[0].kind === ts.SyntaxKind.StringLiteral) {
            state.push(addEdge(filePath, (n.arguments[0] as ts.StringLiteral).text));
          }
        }
        break;
      default:
        ts.forEachChild(node, traverseChildren);
    }
  }

  traverseChildren(rootNode);

  return Promise.all(state)
    .then((deps) => deps.filter((el): el is string => !!el));
}

function parseFile(opts: Opts, fileContent: string): ts.Node {
  return ts.createSourceFile('tmp', fileContent, ts.ScriptTarget.ES5);
}

function resolveModule(parser: ParserFunc, jsFile: string, content: Buffer | false = false): Promise<[Buffer, ts.Node]> {
  return loadFile(jsFile, content).then((content) => {
    return [content, parser(content.toString())];
  });
}

function createGraphFromFileHelper(sign: SignFunc, resolveFile: FileResolverFunc, buildTree: BuildTreeFunc, g: Graph, jsFile: string, content: Buffer | false = false): Promise<Graph> {
  // we don't want to parse those files, this is a leaf
  if (path.basename(jsFile) === 'package.json') {
    return loadFile(jsFile).then((content) => {
      g.setNode(jsFile, sign(content));
      return g;
    });
  }

  if (jsFile.match(/\.php$/)) {
    return loadFile(jsFile).then((content) => {
      g.setNode(jsFile, sign(content));
      return g;
    });
  }

  return resolveFile(jsFile, content).then(([content, ast]) => {
    g.setNode(jsFile, sign(content));
    return buildTree(ast, g, jsFile).then((deps) => {
      return Promise.all(deps.map((dep) => {
        return createGraphFromFileHelper(sign, resolveFile, buildTree, g, dep, false);
      }));
    }).then(() => g);
  });
}

function loadJSON(file: string) {
  return loadFile(file).then((cnt) => JSON.parse(cnt.toString()));
}

// To be compatible with webpack, logic taken from:
// https://github.com/webpack/enhanced-resolve/blob/49cddd1c5757849b1e0b53b9c765525b840c3b59/lib/ResolverFactory.js#L127s
function prepareAlias(alias: { [key: string]: string | Alias }): Alias[] | null {
  if (!alias) {
    return null;
  }

  return Object.keys(alias).map((key) => {
    let exactMatch = false;
    let value = alias[key];

    if (key.endsWith('$')) {
      exactMatch = true;
      key = key.slice(0, key.length - 1);
    }

    return (
      typeof value === 'string'
        ? { value, key, exactMatch }
        : { ...value, key, exactMatch }
    );
  });
}

function createGraphFromFile(filename: string, sign: SignFunc, opts: Opts, file: Buffer | false = false): Promise<Graph> {
  const g = new Graph({ directed: true });
  const parser: ParserFunc = (content: string) => parseFile(opts, content);
  const alias = prepareAlias(opts.alias) || [];
  const resolveFile: FileResolverFunc = (jsFile: string, content: Buffer | false = false) => resolveModule(parser, jsFile, content);
  const resolve: ResolverFunc = (curFile: string, depFile: string) => resolveName(opts, alias, memoize(loadJSON), curFile, depFile);
  const build: BuildTreeFunc = (rootNode: ts.Node, g: Graph, filePath: string) => buildTree(resolve, rootNode, g, filePath);
  return createGraphFromFileHelper(sign, resolveFile, build, g, filename, file);
}

module.exports = {
  createGraphFromFile
};
