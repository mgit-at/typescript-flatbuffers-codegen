module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: [
    "**/*.{spec,test}.{js,jsx,ts,tsx}"
  ],
  collectCoverageFrom: [
    "src/**/*.{js,jsx,ts,tsx}"
  ],
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    }
  },
  coverageReporters: [
    "text"
  ],
  watchPathIgnorePatterns: [
    ".*\\/__generated__\\/.*"
  ]
};
