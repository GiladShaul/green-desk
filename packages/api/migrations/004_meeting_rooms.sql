-- Migration: 004_meeting_rooms
-- Description: Add meeting room booking support (rooms, room_equipment, room_bookings)

-- Rooms table
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  x_position NUMERIC NOT NULL DEFAULT 0,
  y_position NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rooms_floor ON rooms (floor_id);

-- Room equipment tags
CREATE TABLE IF NOT EXISTS room_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_room_equipment_room ON room_equipment (room_id);

-- Room bookings table
CREATE TABLE IF NOT EXISTS room_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_room_bookings_room_date ON room_bookings (room_id, date);
CREATE INDEX IF NOT EXISTS idx_room_bookings_user ON room_bookings (user_id);

-- Auto-update updated_at on rooms
CREATE OR REPLACE TRIGGER rooms_updated_at
  BEFORE UPDATE ON rooms
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at on room_bookings
CREATE OR REPLACE TRIGGER room_bookings_updated_at
  BEFORE UPDATE ON room_bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
