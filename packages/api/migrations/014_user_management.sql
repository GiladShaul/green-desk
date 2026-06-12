-- Migration: 014_user_management
-- Description: Full user management — invite tokens, deactivate/reactivate, viewer role, tenant settings + onboarding flag

-- ── 1. Extend users role to include 'viewer' ─────────────────────────────────

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'member', 'viewer'));

-- ── 2. Add status column to users ────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'deactivated'));

CREATE INDEX IF NOT EXISTS idx_users_status ON users (tenant_id, status);

-- ── 3. User invitations ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'viewer')),
  token       TEXT NOT NULL UNIQUE,
  invited_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitations_token     ON user_invitations (token);
CREATE INDEX IF NOT EXISTS idx_invitations_tenant    ON user_invitations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email     ON user_invitations (tenant_id, email);

-- ── 4. Tenant settings & onboarding ──────────────────────────────────────────

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS booking_rules JSONB NOT NULL DEFAULT '{}';
