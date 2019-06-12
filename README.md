# graph-cache-js

This is a ```JavaScript``` parser for [graph-cache](https://github.com/VKCOM/graph-cache) library.

## Installation

```npm install --save graph-cache-js```

## Usage
```javascript
const createGraphCache = require('graph-cache');
const jsParser = require('graph-cache-js');

function parser(parserOptions, sign, file, filename) {
  return jsParser(sign, file, filename, parserOptions);
}

const gcache = createGraphCache(parser.bind(null, parserOptions), sign, {});
```

### Parser options
- ```packageJSON``` — path to package.json which you use in your project, so that parser could walk dependencies from npm.

**Important!**
It will only store and check versions of packets from npm. 
It won't walk your whole dependencies  tree, so if you change files inside your node_modules — parser won't be able to detect those changes 
without changing version of the packet you're importing.
- ```plugins``` — list of plugins for bablylon or now babel-parser (https://babeljs.io/docs/en/babel-parser)
- ```alias``` — alias section from webpack config

## Testing

This library is tested using ```Mocha``` and ```Chai```. You can run test suit with ```npm test```.
You can run ```npm run test-watch``` to rerun tests on file updates.


## Contributing

Issues and PR's are welcomed here. 
