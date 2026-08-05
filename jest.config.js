export default {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'SRC/**/*.js',
    '!SRC/server.js',
    '!SRC/config/**',
  ],
  setupFilesAfterEnv: ['./jest.setup.js'],
  transform: {},
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};