// webpack.config.js (수정 완료)
const path = require("path");

module.exports = {
  mode: "development",
  entry: {
    content: './content.js',
    // ▼▼▼ [수정] background 부분을 아래와 같이 배열로 변경 ▼▼▼
    background: [
      './lib/firebase-app-compat.js',
      './lib/firebase-database-compat.js',
      './background.js'
    ]
  }, 
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: '[name].bundle.js',
  },
  devtool: "cheap-module-source-map",
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            presets: ["@babel/preset-env"],
          },
        },
      },
    ],
  },
};