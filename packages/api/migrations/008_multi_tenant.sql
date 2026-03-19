-- Migration: 008_multi_tenant
-- Description: Multi-tenant isolation — tenants table + tenant_id on every row-bearing table

-- ── 1. Tenants table ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'pro')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ── 2. Default tenant (backfill target for existing rows) ─────────────────────

INSERT INTO tenants (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Organization', 'default-org')
ON CONFLICT (id) DO NOTHING;

-- ── 3. Add tenant_id columns (nullable first for backfill) ────────────────────

ALTER TABLE users          ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE floors         ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE desks          ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE rooms          ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE bookings       ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE recurring_bookings ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE room_bookings  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE team_bookings  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE sso_connections ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE integrations   ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

-- ── 4. Backfill existing rows with the default tenant ─────────────────────────

UPDATE users           SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE floors          SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE desks           SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE rooms           SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE bookings        SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE recurring_bookings SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE room_bookings   SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE team_bookings   SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE sso_connections SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE integrations    SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

-- ── 5. Add NOT NULL constraint after backfill ─────────────────────────────────

ALTER TABLE users           ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE floors          ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE desks           ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE rooms           ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE bookings        ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE recurring_bookings ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE room_bookings   ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE team_bookings   ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE sso_connections ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE integrations    ALTER COLUMN tenant_id SET NOT NULL;

-- ── 6. Indexes on tenant_id for all tables ────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_users_tenant            ON users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_floors_tenant           ON floors (tenant_id);
CREATE INDEX IF NOT EXISTS idx_desks_tenant            ON desks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_rooms_tenant            ON rooms (tenant_id);
CREATE INDEX IF NOT EXISTS idx_bookings_tenant         ON bookings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_recurring_bookings_tenant ON recurring_bookings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_room_bookings_tenant    ON room_bookings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_team_bookings_tenant    ON team_bookings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sso_connections_tenant  ON sso_connections (tenant_id);
CREATE INDEX IF NOT EXISTS idx_integrations_tenant     ON integrations (tenant_id);
