/**
 * Integration tests against a real PostgreSQL.
 *
 * Separate from `jest.config.js` because these need a database and the unit
 * suite deliberately does not: `pnpm test` must stay runnable with nothing
 * installed but Node.
 *
 * `maxWorkers: 1` because every test shares one database and the cleanup helper
 * truncates between tests. Parallel workers would see each other's rows.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'test/.*\\.int-spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
  maxWorkers: 1,
  testTimeout: 30000,
};
