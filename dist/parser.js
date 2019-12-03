"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
var graphlib_1 = require("graphlib");
var fs = require("fs");
var ts = require("typescript");
var path = require("path");
var memoize = require('lodash.memoize');
function fileExist(path) {
    try {
        var stat = fs.statSync(path);
        return stat.isFile();
    }
    catch (e) {
        return false;
    }
}
// TODO: resolving files with webpack options
function loadFile(file, cnt) {
    if (cnt === void 0) { cnt = false; }
    if (cnt !== false) {
        return Promise.resolve(cnt);
    }
    return new Promise(function (resolve, reject) {
        fs.readFile(file, function (err, result) {
            if (err) {
                reject(err);
            }
            else {
                resolve(result);
            }
        });
    });
}
function cantResolveError(name) {
    return new Error("Can't resolve file " + name);
}
function resolveNpmDep(packageFile, json, depFile) {
    var root = depFile.split(path.sep)[0];
    var packageFileResolve = path.resolve(packageFile);
    if (root.startsWith('@')) {
        root += path.sep + depFile.split(path.sep)[1];
    }
    var exist = Object.keys(json.dependencies)
        .filter(function (el) { return el === root; }).length;
    if (exist) {
        return path.join(path.dirname(packageFileResolve), 'node_modules', root, 'package.json');
    }
    else {
        return false;
    }
}
function resolveName(opts, alias, loadPackageFile, curFile, depFile) {
    if (alias) {
        var error_1 = false;
        alias.some(function (item) {
            if (!depFile.startsWith(item.key))
                return;
            if (item.exactMatch) {
                if (item.key !== depFile) {
                    error_1 = true;
                }
                else {
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
        if (error_1) {
            return Promise.reject(cantResolveError(depFile));
        }
    }
    if (depFile.startsWith('.')) {
        var extName = '';
        if (!path.extname(depFile)) {
            extName = '.js';
        }
        var candidate = path.resolve(path.dirname(curFile), depFile) + extName;
        if (extName === '') {
            return Promise.resolve(fileExist(candidate) ? candidate : candidate + '.js');
        }
        else {
            return Promise.resolve(candidate);
        }
    }
    if (opts.packageJSON) {
        return loadPackageFile(opts.packageJSON)
            .then(function (json) {
            var filePath = resolveNpmDep(opts.packageJSON, json, depFile);
            if (!filePath) {
                throw cantResolveError(depFile);
            }
            return filePath;
        });
    }
    return Promise.reject(cantResolveError(depFile));
}
function _addEdge(resolveName, g, filePath, edgePath) {
    try {
        if (require.resolve.paths(edgePath) === null) {
            return Promise.resolve(false);
        }
    }
    catch (err) {
    }
    return resolveName(filePath, edgePath).then(function (newName) {
        var parsed = path.parse(newName);
        var pathsToCheck = [
            newName,
            path.join(parsed.dir, parsed.name + '.ts'),
            path.join(parsed.dir, parsed.name + '.tsx'),
            path.join(parsed.dir, parsed.name, 'index.ts'),
            path.join(parsed.dir, parsed.name, 'index.tsx'),
            path.join(parsed.dir, parsed.name, 'index.js')
        ];
        for (var _i = 0, pathsToCheck_1 = pathsToCheck; _i < pathsToCheck_1.length; _i++) {
            var path_1 = pathsToCheck_1[_i];
            newName = path_1;
            if (fileExist(path_1)) {
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
function buildTree(resolveName, rootNode, g, filePath) {
    var state = [];
    var addEdge = function (filePath, edgePath) { return _addEdge(resolveName, g, filePath, edgePath); };
    function traverseChildren(node) {
        var n;
        switch (node.kind) {
            case ts.SyntaxKind.ImportDeclaration:
                n = node;
                var text = n.moduleSpecifier.text;
                state.push(addEdge(filePath, text));
                break;
            case ts.SyntaxKind.ExportDeclaration:
                n = node;
                if (n.moduleSpecifier) {
                    var text_1 = n.moduleSpecifier.text;
                    state.push(addEdge(filePath, text_1));
                }
                break;
            case ts.SyntaxKind.CallExpression:
                n = node;
                if (n.expression.kind === ts.SyntaxKind.Identifier && n.expression.escapedText === 'require') {
                    if (n.arguments[0] && n.arguments[0].kind === ts.SyntaxKind.StringLiteral) {
                        state.push(addEdge(filePath, n.arguments[0].text));
                    }
                }
                break;
            default:
                ts.forEachChild(node, traverseChildren);
        }
    }
    traverseChildren(rootNode);
    return Promise.all(state)
        .then(function (deps) { return deps.filter(function (el) { return !!el; }); });
}
function parseFile(opts, fileContent) {
    return ts.createSourceFile('tmp', fileContent, ts.ScriptTarget.ES5);
}
function resolveModule(parser, jsFile, content) {
    if (content === void 0) { content = false; }
    return loadFile(jsFile, content).then(function (content) {
        return [content, parser(content.toString())];
    });
}
function createGraphFromFileHelper(sign, resolveFile, buildTree, g, jsFile, content) {
    if (content === void 0) { content = false; }
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
    return resolveFile(jsFile, content).then(function (_a) {
        var content = _a[0], ast = _a[1];
        g.setNode(jsFile, sign(content));
        return buildTree(ast, g, jsFile).then(function (deps) {
            return Promise.all(deps.map(function (dep) {
                return createGraphFromFileHelper(sign, resolveFile, buildTree, g, dep, false);
            }));
        }).then(function () { return g; });
    });
}
function loadJSON(file) {
    return loadFile(file).then(function (cnt) { return JSON.parse(cnt.toString()); });
}
// To be compatible with webpack, logic taken from:
// https://github.com/webpack/enhanced-resolve/blob/49cddd1c5757849b1e0b53b9c765525b840c3b59/lib/ResolverFactory.js#L127s
function prepareAlias(alias) {
    if (!alias) {
        return null;
    }
    return Object.keys(alias).map(function (key) {
        var exactMatch = false;
        var value = alias[key];
        if (key.endsWith('$')) {
            exactMatch = true;
            key = key.slice(0, key.length - 1);
        }
        return (typeof value === 'string'
            ? { value: value, key: key, exactMatch: exactMatch }
            : __assign(__assign({}, value), { key: key, exactMatch: exactMatch }));
    });
}
function createGraphFromFile(filename, sign, opts, file) {
    if (file === void 0) { file = false; }
    var g = new graphlib_1.Graph({ directed: true });
    var parser = function (content) { return parseFile(opts, content); };
    var alias = prepareAlias(opts.alias) || [];
    var resolveFile = function (jsFile, content) {
        if (content === void 0) { content = false; }
        return resolveModule(parser, jsFile, content);
    };
    var resolve = function (curFile, depFile) { return resolveName(opts, alias, memoize(loadJSON), curFile, depFile); };
    var build = function (rootNode, g, filePath) { return buildTree(resolve, rootNode, g, filePath); };
    return createGraphFromFileHelper(sign, resolveFile, build, g, filename, file);
}
module.exports = {
    createGraphFromFile: createGraphFromFile
};
