-- Migration: 010_audit_logs
-- Description: Add audit_logs table for compliance and security event tracking

CREATE TABLE IF NOT EXISTS audit_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id      UUID,
  actor_email   TEXT,
  action        TEXT        NOT NULL CHECK (action IN ('create', 'update', 'delete', 'login', 'logout', 'login_failed')),
  resource_type TEXT        NOT NULL CHECK (resource_type IN (
    'booking', 'desk', 'floor', 'room', 'user', 'team_booking',
    'sso_connection', 'integration', 'billing', 'room_booking', 'recurring_booking'
  )),
  resource_id   TEXT,
  changes       JSONB,
  ip_address    TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created
  ON audit_logs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_resource
  ON audit_logs (tenant_id, resource_type, resource_id);
