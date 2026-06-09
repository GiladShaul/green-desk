/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/integration/**/*.test.ts'],
  testTimeout: 30000,
  runInBand: true,
  forceExit: true,
  setupFiles: ['<rootDir>/src/__tests__/integration/env.ts'],
};
