// webpack.config.js (수정 후)
const path = require("path");

module.exports = {
  mode: "development",
  entry: './content.js', // 시작점을 다시 content.js 하나로
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: 'bundle.js', // 결과물도 bundle.js 하나로
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