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
      // allow code splitting for content bundle to extract large shared modules
      // but keep background and offscreen single-file to avoid service worker
      // dynamic-loading pitfalls
      chunks: (chunk) => {
        return chunk.name !== 'background' && chunk.name !== 'offscreen';
      },
      cacheGroups: {
        // UI 관련 모듈들을 별도 청크로 분리 (content, background 제외)
        ui: {
          test: /[\\/]js[\\/]ui[\\/]/,
          name: 'ui',
          chunks: (chunk) => chunk.name !== 'content' && chunk.name !== 'background' && chunk.name !== 'offscreen',
          priority: 10,
        },
        // 서비스 관련 모듈들을 별도 청크로 분리 (content, background 제외)
        services: {
          test: /[\\/]js[\\/]services[\\/]/,
          name: 'services',
          chunks: (chunk) => chunk.name !== 'content' && chunk.name !== 'background' && chunk.name !== 'offscreen',
          priority: 10,
        },
        // firebaseService는 매우 큰 편이므로 content 번들에서 별도의 청크로 분리하여
        // content 초기 로드 크기를 낮춘다. background 번들의 분리는 피함.
        firebase_vendor: {
          test: /[\\/]node_modules[\\/](firebase|@firebase)[\\/]/,
          name: 'firebase-vendor',
          chunks: 'all',
          priority: 60,
          enforce: true,
        },
        services_firebase: {
          test: /[\\/]js[\\/]services[\\/]firebaseService\.js$/,
          name: 'services-firebase',
          // Extract firebaseService for all chunks (including background)
          // so it can be loaded as its own chunk and reduce initial background bundle size.
          chunks: 'all',
          priority: 50,
          enforce: true,
        },
        services_ai: {
          test: /[\\/]js[\\/]services[\\/]aiService\.js$/,
          name: 'services-ai',
          chunks: 'all',
          priority: 55,
          enforce: true,
        },
        ui_workspace: {
          test: /[\\/]js[\\/]ui[\\/]workspaceMode\.js$/,
          name: 'ui-workspace',
          chunks: 'all',
          priority: 45,
          enforce: true,
        },
        // 코어 모듈들을 별도 청크로 분리 (content, background 제외)
        core: {
          test: /[\\/]js[\\/]core[\\/]/,
          name: 'core',
          chunks: (chunk) => chunk.name !== 'content' && chunk.name !== 'background' && chunk.name !== 'offscreen',
          priority: 10,
        },
        // 유틸리티 모듈들을 별도 청크로 분리 (content, background 제외)
        utils: {
          test: /[\\/]js[\\/]utils\.js$/,
          name: 'utils',
          chunks: (chunk) => chunk.name !== 'content' && chunk.name !== 'background' && chunk.name !== 'offscreen',
          priority: 10,
        },
        // node_modules의 큰 라이브러리들을 분리 (content, background 제외)
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendor',
          chunks: (chunk) => chunk.name !== 'content' && chunk.name !== 'background' && chunk.name !== 'offscreen',
          priority: 5,
        },
        // 기본 청크 분할 (나머지 공통 모듈들, content, background 제외)
        common: {
          name: 'common',
          minChunks: 2,
          chunks: (chunk) => chunk.name !== 'content' && chunk.name !== 'background' && chunk.name !== 'offscreen',
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
        { from: 'rules.json', to: 'rules.json' },
        { from: 'manifest.json', to: 'manifest.json' }, // manifest.json 복사 추가
        // Removed background.cjs copy since we're bundling it now
      ],
    }),
    // Image optimization for build assets (lossy defaults tuned for web)
    // Use imageminMinify for lossy compression and imageminGenerate to produce
    // generated WebP variants. imageminMinify does not support generating
    // formats like WebP from other image types which caused warnings.
    new ImageMinimizerPlugin({
      minimizer: {
        implementation: ImageMinimizerPlugin.imageminMinify,
        options: {
          plugins: [
            ['imagemin-mozjpeg', { quality: 75 }],
            ['imagemin-pngquant', { quality: [0.6, 0.8] }],
          ],
        },
      },
      // generator will create additional converted images (e.g. WebP)
      generator: [
        {
          preset: 'webp',
          implementation: ImageMinimizerPlugin.imageminGenerate,
          filename: 'images/[path][name].webp',
          options: {
            plugins: [['imagemin-webp', { quality: 75 }]],
          },
        },
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
