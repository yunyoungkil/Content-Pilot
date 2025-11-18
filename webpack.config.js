// webpack.config.js
const path = require("path");

module.exports = {
  mode: "development",
  entry: {
    content: './content.js'
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: 'bundle.js',
    publicPath: '', // Chrome Extension에서는 상대 경로 사용
    chunkFilename: '[name].bundle.js', // 청크 파일명 명시
  },
  optimization: {
    splitChunks: {
      chunks: 'async', // 동기 import는 스플리팅하지 않음
      minSize: 20000, // 최소 크기를 크게 설정하여 스플리팅 방지
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