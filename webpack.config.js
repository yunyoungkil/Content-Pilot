// webpack.config.js
const path = require("path");

module.exports = {
  mode: "development",
  entry: {
    content: "./content.js",
    background: "./background.js",
    offscreen: "./offscreen.js",
    editor: "./editor.js",
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].bundle.js",
    publicPath: "", // Chrome Extension에서는 상대 경로 사용
    chunkFilename: "[id]-[name].bundle.js", // 청크 파일명에 ID와 이름을 포함하여 디버깅 용이하게
  },
  optimization: {
    splitChunks: {
      chunks: () => false, // 모든 청크 스플리팅 완전 비활성화
    },
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
