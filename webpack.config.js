const path = require('path')
const TerserPlugin = require('terser-webpack-plugin');

// src for commented optimizations is pixi-hotwire
// https://github.com/miltoncandelero/pixi-hotwire/blob/master/webpack.config.js#L61

module.exports = (env, argv) => ({
  mode: "development",
  // Enable sourcemaps while debugging
  devtool: argv.mode === 'development' ? 'eval-source-map' : undefined,
  // Minify the code when making a final build
  optimization: {
    minimize: argv.mode === 'production',
    minimizer: [new TerserPlugin({
      terserOptions: {
        ecma: 6,
        compress: { drop_console: true },
        output: { comments: false, beautify: false },
      },
    })],
  },
  entry: {
    main: "./src/app.ts",
  },
  output: {
    path: path.resolve(__dirname, './docs'),
    filename: "index.js" // <--- Will be compiled to this single file
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js"],
    fallback: {
      "fs": false,
      "path": require.resolve("path-browserify"),
      "os": false
    },
  },
  // Web games are bigger than pages, disable the warnings that our game is too big.
  performance: { hints: false },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: "ts-loader",
        exclude: /node_modules/
      },
      {
        test: /\.(glsl|vs|fs|frag|vert)$/,
        loader: 'ts-shader-loader'
      }
    ]
  },
  devServer: {
    static: {
      directory: path.join(__dirname, '/docs'),
    },
    compress: false,
    port: 9000,
  },
  experiments: {
    syncWebAssembly: true,
  }
})