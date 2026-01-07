// webpack.config.js
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const ImageMinimizerPlugin = require('image-minimizer-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
  mode: 'production',
  entry: {
    content: './content.js',
    background: './background.cjs', // Bundle the CommonJS background script
    offscreen: './offscreen.js',
    editor: './editor.js',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].bundle.js',
    publicPath: 'dist/', // 동적 청크는 dist/ 하위에서 로드되도록 설정
    chunkFilename: '[name].bundle.js', // 청크 파일명에 ID 대신 이름을 사용하여 안정성 확보
    clean: true,
  },
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        test: /^(?!.*background\.bundle\.js$).*\.js$/i, // background.bundle.js 제외
      }),
    ],
    splitChunks: false, // 코드 분할 완전 비활성화 (Chrome Extension 제약)
  },
  devtool: 'cheap-module-source-map',
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: 'css', to: 'css' },
        { from: 'images', to: 'images', noErrorOnMissing: true },
        { from: 'rules.json', to: 'rules.json' },
        { from: 'manifest.json', to: 'manifest.json' }, // manifest.json 복사 추가
        // Removed background.cjs copy since we're bundling it now
      ],
    }),
    // Image optimization for build assets (lossy defaults tuned for web)
    new ImageMinimizerPlugin({
      minimizer: {
        implementation: ImageMinimizerPlugin.imageminMinify,
        options: {
          plugins: [
            ['imagemin-mozjpeg', { quality: 75 }],
            ['imagemin-pngquant', { quality: [0.6, 0.8] }],
            ['imagemin-webp', { quality: 75 }],
          ],
        },
      },
    }),
  ],
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.js$/,
        include: path.resolve(__dirname, 'background.cjs'), // background.cjs 절대 경로로 지정
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              [
                '@babel/preset-env',
                {
                  targets: {
                    chrome: '109',
                  },
                  modules: 'commonjs', // background는 CommonJS로 변환
                },
              ],
            ],
          },
        },
      },
      {
        test: /\.js$/,
        exclude: /node_modules/, // node_modules 제외, 다른 JS 파일들은 ES modules 유지
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              [
                '@babel/preset-env',
                {
                  targets: {
                    chrome: '109',
                  },
                  modules: false, // ES modules 유지
                },
              ],
            ],
          },
        },
      },
    ],
  },
};
