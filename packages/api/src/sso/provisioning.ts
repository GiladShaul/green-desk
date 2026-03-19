import { query } from '../db';
import type { SsoConnection, SsoUserInfo } from './oidc';

export interface ProvisionedUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

const USER_COLS = 'id, email, name, role';

export async function findOrProvisionUser(
  connection: SsoConnection,
  info: SsoUserInfo,
): Promise<ProvisionedUser> {
  // 1. Lookup by (sso_connection_id, external_id) — fastest path for repeat logins
  const bySSO = await query<ProvisionedUser>(
    `SELECT ${USER_COLS} FROM users WHERE sso_connection_id = $1 AND external_id = $2`,
    [connection.id, info.externalId],
  );
  if (bySSO.rows.length > 0) return bySSO.rows[0];

  // 2. Lookup by email — existing local user first logs in via SSO
  const byEmail = await query<ProvisionedUser>(
    `SELECT ${USER_COLS} FROM users WHERE email = $1`,
    [info.email],
  );
  if (byEmail.rows.length > 0) {
    // Link the SSO identity going forward
    const updated = await query<ProvisionedUser>(
      `UPDATE users SET sso_connection_id = $1, external_id = $2 WHERE id = $3 RETURNING ${USER_COLS}`,
      [connection.id, info.externalId, byEmail.rows[0].id],
    );
    return updated.rows[0];
  }

  // 3. Auto-provision new user
  const inserted = await query<ProvisionedUser>(
    `INSERT INTO users (email, name, sso_connection_id, external_id)
     VALUES ($1, $2, $3, $4)
     RETURNING ${USER_COLS}`,
    [info.email, info.name, connection.id, info.externalId],
  );
  return inserted.rows[0];
}
