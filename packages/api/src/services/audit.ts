import { query } from '../db';
import { AuthRequest } from '../auth/middleware';
import { logger } from '../logger';

export type AuditAction = 'create' | 'update' | 'delete' | 'login' | 'logout' | 'login_failed' | 'check_in';
export type AuditResourceType =
  | 'booking'
  | 'desk'
  | 'floor'
  | 'room'
  | 'user'
  | 'team_booking'
  | 'sso_connection'
  | 'integration'
  | 'billing'
  | 'room_booking'
  | 'recurring_booking'
  | 'tenant'
  | 'checkin_settings'
  | 'api_key';

interface AuditParams {
  tenantId: string;
  actorId?: string | null;
  actorEmail?: string | null;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string | null;
  changes?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function writeAuditLog(params: AuditParams): void {
  void Promise.resolve(query(
    `INSERT INTO audit_logs
       (tenant_id, actor_id, actor_email, action, resource_type, resource_id, changes, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      params.tenantId,
      params.actorId ?? null,
      params.actorEmail ?? null,
      params.action,
      params.resourceType,
      params.resourceId ?? null,
      params.changes ? JSON.stringify(params.changes) : null,
      params.ipAddress ?? null,
      params.userAgent ?? null,
    ],
  )).catch((err: unknown) => logger.error({ err }, '[audit] write error'));
}

function getClientIp(req: AuthRequest): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',')[0].trim();
  }
  return req.socket?.remoteAddress ?? null;
}

export function auditLog(
  req: AuthRequest,
  params: {
    action: AuditAction;
    resourceType: AuditResourceType;
    resourceId?: string | null;
    changes?: Record<string, unknown> | null;
  },
): void {
  if (!req.user) return;
  const { sub: actorId, tenantId } = req.user;
  const ipAddress = getClientIp(req);
  const userAgent = req.headers['user-agent'] ?? null;

  void Promise.resolve(query<{ email: string }>('SELECT email FROM users WHERE id = $1', [actorId]))
    .then((result) => {
      if (!result) return;
      writeAuditLog({
        tenantId,
        actorId,
        actorEmail: result.rows[0]?.email ?? null,
        ...params,
        ipAddress,
        userAgent,
      });
    })
    .catch((err: unknown) => logger.error({ err }, '[audit] email lookup error'));
}

export function auditLogDirect(params: AuditParams): void {
  writeAuditLog(params);
}

export async function purgeExpiredAuditLogs(): Promise<void> {
  const retentionDays = parseInt(process.env.AUDIT_LOG_RETENTION_DAYS ?? '90', 10);
  const result = await query<{ count: string }>(
    `WITH deleted AS (
       DELETE FROM audit_logs
       WHERE created_at < now() - ($1 || ' days')::INTERVAL
       RETURNING id
     ) SELECT COUNT(*) AS count FROM deleted`,
    [retentionDays],
  );
  const count = parseInt(result.rows[0]?.count ?? '0', 10);
  if (count > 0) {
    logger.info(`[audit] purged ${count} expired log(s) (retention: ${retentionDays} days)`);
  }
}
