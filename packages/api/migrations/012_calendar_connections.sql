-- user_calendar_connections: stores OAuth tokens per user per provider
CREATE TABLE IF NOT EXISTS user_calendar_connections (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id             UUID NOT NULL,
  provider              TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  access_token_encrypted  TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  token_expires_at      TIMESTAMPTZ,
  calendar_id           TEXT,
  connected_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at            TIMESTAMPTZ,
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_ucc_user_id ON user_calendar_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_ucc_tenant_id ON user_calendar_connections(tenant_id);

-- booking_calendar_events: tracks which external event corresponds to which booking
CREATE TABLE IF NOT EXISTS booking_calendar_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        UUID NOT NULL,
  connection_id     UUID NOT NULL REFERENCES user_calendar_connections(id) ON DELETE CASCADE,
  provider_event_id TEXT NOT NULL,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bce_booking_id ON booking_calendar_events(booking_id);
CREATE INDEX IF NOT EXISTS idx_bce_connection_id ON booking_calendar_events(connection_id);
