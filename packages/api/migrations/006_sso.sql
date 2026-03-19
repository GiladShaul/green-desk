-- Migration: 006_sso
-- Description: SSO connections and user SSO fields

-- SSO connections table
CREATE TABLE IF NOT EXISTS sso_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT,                          -- nullable; reserved for future multi-tenant
  provider_type TEXT NOT NULL CHECK (provider_type IN ('oidc', 'saml')),
  name TEXT NOT NULL,                       -- human-readable label, e.g. "Acme Corp OKTA"
  config JSONB NOT NULL DEFAULT '{}',       -- OIDC or SAML config blob (see docs)
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER sso_connections_updated_at
  BEFORE UPDATE ON sso_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Extend users for SSO identity
ALTER TABLE users
  ALTER COLUMN password_hash DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS sso_connection_id UUID REFERENCES sso_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_id TEXT;          -- IdP subject identifier

-- Prevent two SSO users from sharing the same (connection, externalId)
CREATE UNIQUE INDEX IF NOT EXISTS users_sso_connection_external
  ON users (sso_connection_id, external_id)
  WHERE sso_connection_id IS NOT NULL AND external_id IS NOT NULL;
