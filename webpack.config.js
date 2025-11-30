// webpack.config.js
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
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
    publicPath: '', // Chrome Extension에서는 상대 경로 사용
    chunkFilename: '[id]-[name].bundle.js', // 청크 파일명에 ID와 이름을 포함하여 디버깅 용이하게
    clean: true,
  },
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        test: /^(?!.*background\.bundle\.js$).*\.js$/i, // background.bundle.js 제외
      }),
    ],
    splitChunks: {
      chunks: (chunk) => {
        // content script와 background script는 코드 분할하지 않음 (동적 로딩 제한)
        return chunk.name !== 'content' && chunk.name !== 'background';
      },
      cacheGroups: {
        // UI 관련 모듈들을 별도 청크로 분리 (content, background 제외)
        ui: {
          test: /[\\/]js[\\/]ui[\\/]/,
          name: 'ui',
          chunks: (chunk) => chunk.name !== 'content' && chunk.name !== 'background',
          priority: 10,
        },
        // 서비스 관련 모듈들을 별도 청크로 분리 (content, background 제외)
        services: {
          test: /[\\/]js[\\/]services[\\/]/,
          name: 'services',
          chunks: (chunk) => chunk.name !== 'content' && chunk.name !== 'background',
          priority: 10,
        },
        // 코어 모듈들을 별도 청크로 분리 (content, background 제외)
        core: {
          test: /[\\/]js[\\/]core[\\/]/,
          name: 'core',
          chunks: (chunk) => chunk.name !== 'content' && chunk.name !== 'background',
          priority: 10,
        },
        // 유틸리티 모듈들을 별도 청크로 분리 (content, background 제외)
        utils: {
          test: /[\\/]js[\\/]utils\.js$/,
          name: 'utils',
          chunks: (chunk) => chunk.name !== 'content' && chunk.name !== 'background',
          priority: 10,
        },
        // node_modules의 큰 라이브러리들을 분리 (content, background 제외)
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendor',
          chunks: (chunk) => chunk.name !== 'content' && chunk.name !== 'background',
          priority: 5,
        },
        // 기본 청크 분할 (나머지 공통 모듈들, content, background 제외)
        common: {
          name: 'common',
          minChunks: 2,
          chunks: (chunk) => chunk.name !== 'content' && chunk.name !== 'background',
          priority: 1,
        },
      },
    },
  },
  devtool: 'cheap-module-source-map',
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: 'css', to: 'css' },
        { from: 'images', to: 'images', noErrorOnMissing: true },
        // Removed background.cjs copy since we're bundling it now
      ],
    }),
  ],
  module: {
    rules: [
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
