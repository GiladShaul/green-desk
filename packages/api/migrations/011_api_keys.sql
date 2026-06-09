-- API keys for third-party integrations
CREATE TABLE api_keys (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_hash        TEXT        NOT NULL,
  key_prefix      CHAR(11)    NOT NULL,  -- 'gd_' + first 8 hex chars
  name            TEXT        NOT NULL,
  scopes          JSONB       NOT NULL DEFAULT '[]',
  last_used_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  created_by_user_id UUID     REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ
);

CREATE INDEX api_keys_tenant_id_idx  ON api_keys(tenant_id);
CREATE INDEX api_keys_key_prefix_idx ON api_keys(key_prefix);
