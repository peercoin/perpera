module.exports = {
  mode: 'development',
  devtool: 'inline-source-map',
  entry: './dist/index.js',
  output: {
    filename: 'bundle.js',
    path: __dirname + '/dist',
    library: 'naughtary'
  },
  /*
  resolve: {
    extensions: ['.js'],
  },
  module: {
    rules: [
    ]
  },
  */
  externals: {
    /*
    'bitcore-lib': {
      commonjs: 'bitcore-lib'
    }
    */
  },
  node: {
    Buffer: true
  }
};
