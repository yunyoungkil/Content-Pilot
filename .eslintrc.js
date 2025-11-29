module.exports = {
  root: true,
  ignorePatterns: ['node_modules/', 'dist/', 'coverage/', 'lib/', '*.bundle.js'],
  env: {
    browser: true,
    node: true,
    jest: true,
    es2021: true,
  },
  globals: {
    chrome: 'readonly',
    Promise: 'readonly',
    Set: 'readonly',
    Map: 'readonly',
    WeakMap: 'readonly',
    WeakSet: 'readonly',
  },
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
  },
  extends: [
    'eslint:recommended',
    'plugin:jest/recommended',
    'plugin:prettier/recommended',
  ],
  plugins: ['jest', 'prettier'],
  rules: {
    'prettier/prettier': 'error',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-console': ['off'],
    'no-undef': 'error',
  },
};
