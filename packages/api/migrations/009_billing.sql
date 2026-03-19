-- Migration: 009_billing
-- Description: Add Stripe billing columns to tenants table

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS billing_email          TEXT,
  ADD COLUMN IF NOT EXISTS plan_seats_limit        INTEGER,
  ADD COLUMN IF NOT EXISTS current_period_end      TIMESTAMPTZ;
