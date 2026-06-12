-- Migration: 015_checkin_noshow
-- Description: QR check-in flow and no-show handling

-- Extend booking status to include check-in lifecycle states
ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_status_check;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('confirmed', 'cancelled', 'checked_in', 'no_show', 'released'));

-- Check-in token (HMAC-signed QR payload) and timestamps
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS check_in_token TEXT,
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_show_released_at TIMESTAMPTZ;

-- No-show counter per user (incremented by the no-show job)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS no_show_count INTEGER NOT NULL DEFAULT 0;

-- Tenant check-in settings
CREATE TABLE IF NOT EXISTS tenant_checkin_settings (
  tenant_id UUID PRIMARY KEY,
  checkin_enabled BOOLEAN NOT NULL DEFAULT true,
  checkin_window_minutes INTEGER NOT NULL DEFAULT 15,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for no-show job: confirmed bookings whose window has passed
CREATE INDEX IF NOT EXISTS idx_bookings_noshow_candidates
  ON bookings (tenant_id, date, start_time, status)
  WHERE status = 'confirmed';
