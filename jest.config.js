module.exports = {
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/test/setup.js"],
  collectCoverageFrom: ["js/**/*.js", "!js/**/vendor/**", "!js/**/*.test.js"],
  testMatch: ["<rootDir>/test/**/*.test.js"],
  transformIgnorePatterns: ["node_modules/(?!(marked)/)"],
  verbose: true,
};
