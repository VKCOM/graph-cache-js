/* eslint-env mocha */

const { createGraphFromFile } = require('../../lib/parser');
const { expect } = require('chai');
const path = require('path');
const fs = require('fs');

function s(t) {
  return 1;
}

function fixturesPath() {
  return path.join(__dirname, '..', 'fixtures');
}

function createPath(name) {
  let ext = '';
  if (!path.extname(name)) {
    ext = '.js';
  }

  let newPath = path.join(fixturesPath(), name + ext);
  const exist = fs.existsSync(newPath);

  if (!exist) {
    newPath = path.join(fixturesPath(), name + path.sep + 'index.js');
  }

  return newPath;
}
function verifyGraph(g, vertexList, edgeList = []) {
  let nodes = g.nodes().sort();
  let edges = g.edges().sort((a, b) => a.v <= b.v);

  edgeList = edgeList.map((e) => ({ v: createPath(e.v), w: createPath(e.w) }))
    .sort((a, b) => a.v <= b.v);
  vertexList = vertexList.map(createPath).sort();

  expect(nodes).to.eql(vertexList);
  expect(edges).to.eql(edgeList);
}

describe('Parser', () => {
  describe('createGraphFromFile', () => {
    it('creates 2 file graph', () => {
      return createGraphFromFile(createPath('test1'), s, {})
        .then((g) => verifyGraph(g, [
          'test1', 'test2'
        ], [
          { v: 'test2', w: 'test1' }
        ]));
    });

    it('creates 3 file graph', () => {
      return createGraphFromFile(createPath('test3'), s, {})
        .then((g) => verifyGraph(g, [
          'test1', 'test2', 'test3'
        ], [
          { v: 'test1', w: 'test3' },
          { v: 'test2', w: 'test1' }
        ]));
    });

    it('creates graph with files from different dirs', () => {
      return createGraphFromFile(createPath('test/test4'), s, {})
        .then((g) => verifyGraph(g, [
          'test1', 'test2', 'test/test4'
        ], [
          { v: 'test1', w: 'test/test4' },
          { v: 'test2', w: 'test/test4' },
          { v: 'test2', w: 'test1' },
        ]));
    });

    it('handles cyclic deps', () => {
      return createGraphFromFile(createPath('cyclic1'), s, {})
        .then((g) => verifyGraph(g, [
          'cyclic1', 'cyclic2'
        ], [
          { v: 'cyclic2', w: 'cyclic1' },
          { v: 'cyclic1', w: 'cyclic2' },
        ]));
    });

    it('handles npm deps', () => {
      return createGraphFromFile(createPath('testNpm'), s, {
        packageJSON: './package.json'
      }).then((g) => {
        verifyGraph(g, [
          'testNpm', '../../node_modules/babylon/package.json'
        ], [
          { v: '../../node_modules/babylon/package.json', w: 'testNpm' },
        ]);
      });
    });

    it('handles npm deps with namespace', () => {
      return createGraphFromFile(createPath('namespace/test'), s, {
        packageJSON: './tests/fixtures/namespace/package.json'
      }).then((g) => {
        verifyGraph(
          g,
          [
            'namespace/test',
            '../fixtures/namespace/node_modules/@vkontakte/vkui-connect/package.json'
          ],
          [
            { v: '../fixtures/namespace/node_modules/@vkontakte/vkui-connect/package.json', w: 'namespace/test' }
          ]
        );
      });
    });

    it('handles files with extension like names', () => {
      return createGraphFromFile(createPath('ext_source'), s, {})
        .then((g) => verifyGraph(g, [
          'ext_source', 'ext_import.min.js'
        ], [
          { v: 'ext_import.min.js', w: 'ext_source' },
        ]));
    });

    it('handles files with not js extensions', () => {
      return createGraphFromFile(createPath('test_html'), s, {})
        .then((g) => verifyGraph(g, [
          'test/test.html', 'test2.js', 'test_html.js'
        ], [
          { v: 'test2.js', w: 'test_html.js' },
          { v: 'test/test.html', w: 'test_html.js' }
        ])).catch((err) => {
          if (err + '' === 'SyntaxError: Unexpected token (1:0)') {
            return;
          }

          return Promise.reject(err);
        });
    });

    it('handles files with php extension', () => {
      return createGraphFromFile(createPath('test_php'), s, {})
        .then((g) => verifyGraph(g, [
          'test/test.php', 'test_php.js'
        ], [
          { v: 'test/test.php', w: 'test_php.js' }
        ]));
    });

    it('handles files with absolute aliases', () => {
      return createGraphFromFile(createPath('test_alias'), s, {
        alias: {
          '#rewritten': path.join(fixturesPath(), 'test')
        }
      })
      .then((g) => verifyGraph(g, [
        'test1', 'test2', 'test/test4', 'test_alias'
      ], [
        { v: 'test/test4', w: 'test_alias' },
        { v: 'test1', w: 'test/test4' },
        { v: 'test2', w: 'test/test4' },
        { v: 'test2', w: 'test1' },
      ]));
    });

    it('handles files with relative aliases', () => {
      return createGraphFromFile(createPath('test_alias'), s, {
        alias: {
          '#rewritten': 'test'
        }
      })
      .then((g) => verifyGraph(g, [
        'test2', 'test1', 'test/test4', 'test_alias'
      ], [
        { v: 'test/test4', w: 'test_alias' },
        { v: 'test1', w: 'test/test4' },
        { v: 'test2', w: 'test/test4' },
        { v: 'test2', w: 'test1' },
      ]));
    });

    it('handles path to folder without index.js', () => {
      return createGraphFromFile(createPath('testFolder'), s, {}).then((g) =>
        verifyGraph(
          g,
          ['testFolder', 'folder', 'folder/module', 'folder/module2'],
          [
            { v: 'folder', w: 'testFolder.js' },
            { v: 'folder/module', w: 'folder' },
            { v: 'folder/module2', w: 'folder' }
          ]
        )
      );
    });


    it('supports require statement', () => {
      return createGraphFromFile(createPath('test_require'), s, {})
      .then((g) => verifyGraph(g, [
        'test_require', 'test2'
      ], [
        { v: 'test2', w: 'test_require' }
      ]));
    });

    it('supports nesting in import statement', () => {
      return createGraphFromFile(createPath('testNested'), s, {
        packageJSON: './package.json'
      });
    });

    it('supports require statement with declaration', () => {
      return createGraphFromFile(createPath('test_require2'), s, {})
        .then((g) => verifyGraph(g, [
          'test_require2', 'test2'
        ], [
          { v: 'test2', w: 'test_require2' }
        ]));
    });

    it('supports core node js modules', () => {
      return createGraphFromFile(createPath('test-core'), s, {})
        .then((g) => verifyGraph(g, [
          'test-core', 'test-core2'
        ], [
          { v: 'test-core2', w: 'test-core' }
        ]));
    });

    it('supports export with import statement', () => {
      return createGraphFromFile(createPath('import_export'), s, {})
        .then((g) => verifyGraph(g, [
          'import_export', 'test2'
        ], [
          { v: 'test2', w: 'import_export' }
        ]));
    });

    it('supports export with import all statement', () => {
      return createGraphFromFile(createPath('import_export_all'), s, {})
        .then((g) => verifyGraph(g, [
          'import_export_all', 'test2'
        ], [
          { v: 'test2', w: 'import_export_all' }
        ]));
    });
  });
});
