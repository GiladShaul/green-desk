-- Migration: 005_team_bookings
-- Description: Team booking support (team_bookings, team_booking_desks)

-- Team bookings table: a manager books a cluster of desks for their team
CREATE TABLE IF NOT EXISTS team_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_bookings_floor_date ON team_bookings (floor_id, date);
CREATE INDEX IF NOT EXISTS idx_team_bookings_creator ON team_bookings (created_by_user_id);

-- Join table: which desks belong to a team booking, with optional per-desk user assignment
CREATE TABLE IF NOT EXISTS team_booking_desks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_booking_id UUID NOT NULL REFERENCES team_bookings(id) ON DELETE CASCADE,
  desk_id UUID NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT team_booking_desks_unique UNIQUE (team_booking_id, desk_id)
);

CREATE INDEX IF NOT EXISTS idx_team_booking_desks_booking ON team_booking_desks (team_booking_id);
CREATE INDEX IF NOT EXISTS idx_team_booking_desks_desk ON team_booking_desks (desk_id);

-- Auto-update updated_at on team_bookings
CREATE OR REPLACE TRIGGER team_bookings_updated_at
  BEFORE UPDATE ON team_bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
