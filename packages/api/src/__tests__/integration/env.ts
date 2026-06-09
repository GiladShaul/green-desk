// Runs before any module imports in integration tests — sets env vars so db.ts
// creates its Pool with the right connection string.
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/greendesk_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
process.env.JWT_EXPIRES_IN = '1h';
