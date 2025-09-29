// webpack.config.js (수정 후)
const path = require("path");

module.exports = {
  mode: "development",
  entry: {
    content: './content.js', // content.js와 그 종속성들을 번들링
    background: './background.js' // background.js만 독립적으로 번들링
  }, 
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: '[name].bundle.js', // 'content.bundle.js'와 'background.bundle.js' 파일 생성
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