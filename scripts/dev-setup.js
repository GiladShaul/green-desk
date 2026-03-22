#!/usr/bin/env node
/**
 * dev-setup.js — Start an embedded PostgreSQL, run migrations, and print .env values.
 *
 * Usage:
 *   node scripts/dev-setup.js          # start PG + run migrations
 *   node scripts/dev-setup.js --stop   # stop the running PG instance
 */

const EmbeddedPostgres = require('embedded-postgres').default;
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '.pgdata');
const PG_PORT = 5433; // avoid conflict with any system PG on 5432
const PG_USER = 'greendesk';
const PG_PASSWORD = 'greendesk';
const PG_DATABASE = 'greendesk';

const DATABASE_URL = `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/${PG_DATABASE}`;

async function main() {
  if (process.argv.includes('--stop')) {
    console.log('Stopping embedded PostgreSQL...');
    const pg = new EmbeddedPostgres({
      databaseDir: DATA_DIR,
      port: PG_PORT,
    });
    try { await pg.stop(); } catch { /* already stopped */ }
    console.log('Stopped.');
    return;
  }

  console.log('Starting embedded PostgreSQL...');

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASSWORD,
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  // initialise or start
  if (!fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'))) {
    console.log('First run — initialising database...');
    await pg.initialise();
  }
  await pg.start();
  console.log(`PostgreSQL running on port ${PG_PORT}`);

  // Create the database (ignore error if it already exists)
  try {
    await pg.createDatabase(PG_DATABASE);
    console.log(`Database "${PG_DATABASE}" created.`);
  } catch {
    console.log(`Database "${PG_DATABASE}" already exists.`);
  }

  // Write .env if it doesn't exist
  const envPath = path.join(__dirname, '..', '.env');
  const envContent = [
    `DATABASE_URL=${DATABASE_URL}`,
    `JWT_SECRET=dev-secret-change-in-production-${Date.now()}`,
    `JWT_EXPIRES_IN=7d`,
    `PORT=3001`,
    '',
  ].join('\n');

  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, envContent);
    console.log('.env file created.');
  } else {
    console.log('.env file already exists — not overwriting.');
  }

  // Run migrations
  console.log('Running migrations...');
  try {
    execSync(`npx ts-node packages/api/src/migrate.ts`, {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL },
    });
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }

  console.log('\n✅ Dev environment ready!\n');
  console.log('Demo accounts:');
  console.log('  admin@greendesk.com / password123  (admin)');
  console.log('  alice@greendesk.com / password123  (member)');
  console.log(`\nPostgreSQL: port ${PG_PORT} (data in .pgdata/)`);
  console.log('Run the app: npm run dev');
  console.log('Stop PG:     node scripts/dev-setup.js --stop');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
