import { Pool } from 'pg';
import { runMigrations } from '../../migrate';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
});

// Idempotent — safe to call from multiple test files; migration table prevents re-runs.
export async function migrate(): Promise<void> {
  await runMigrations();
}

// Wipe all tenant data between test suites. CASCADE handles FK ordering automatically.
export async function truncateTables(): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE
      api_keys, audit_logs,
      reminder_log, integrations, sso_connections,
      team_booking_desks, team_bookings,
      room_equipment, room_bookings, rooms,
      recurring_bookings, bookings,
      desks, floors, users, tenants
    CASCADE
  `);
}

export async function closePool(): Promise<void> {
  await pool.end();
}
