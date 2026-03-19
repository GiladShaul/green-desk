-- Migration: 003_recurring_bookings
-- Description: Recurring desk bookings table

CREATE TABLE IF NOT EXISTS recurring_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  desk_id UUID NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for conflict detection and floor-plan queries
CREATE INDEX IF NOT EXISTS idx_recurring_bookings_desk_day ON recurring_bookings (desk_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_recurring_bookings_user ON recurring_bookings (user_id);

-- Auto-update updated_at
CREATE OR REPLACE TRIGGER recurring_bookings_updated_at
  BEFORE UPDATE ON recurring_bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
