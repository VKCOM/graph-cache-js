const { createGraphFromFile } = require('../../lib/parser');
const Graph = require('graphlib').Graph;
function s(t) {
  return 1;
}
function verifyGraph(g, vertexList, edgeList = []) {
  let nodes = g.nodes().sort();
  let edges = g.edges().sort((a, b) => a.v <= b.v);

  edgeList = edgeList.map(e => ({ v: createPath(e.v), w: createPath(e.w) }))
    .sort((a, b) => a.v <= b.v);
  vertexList = vertexList.map(createPath).sort();

  expect(nodes).to.eql(vertexList);
  expect(edges).to.eql(edgeList);
}

describe('Parser', () => {
  describe('createGraphFromFile', () => {
    it("works", () => {
      const g = new Graph({ directed: true })
      return createGraphFromFile('tests/fixtures/test1.js', s, g, {})
        .then(() => console.log(g));
    });
  });
});
