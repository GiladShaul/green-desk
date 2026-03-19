-- Migration: 007_integrations
-- Description: Webhook integrations for Slack/Teams booking notifications

-- Integrations table — stores webhook endpoints with event configuration
CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('slack', 'teams')),
  webhook_url TEXT NOT NULL,
  events JSONB NOT NULL DEFAULT '["booking_confirmed","booking_cancelled","booking_reminder"]',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER integrations_updated_at
  BEFORE UPDATE ON integrations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Reminder log — tracks which bookings have had reminders sent (dedup guard)
CREATE TABLE IF NOT EXISTS reminder_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL,
  booking_type TEXT NOT NULL DEFAULT 'desk' CHECK (booking_type IN ('desk', 'room')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reminder_log_booking_unique UNIQUE (booking_id, booking_type)
);
