-- Migration: 013_fix_booking_unique_constraint
-- Description: Replace table-level UNIQUE on (desk_id, date, start_time) with a
-- partial index that only prevents double-booking of *confirmed* slots.
-- Cancelled bookings should be re-bookable.

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_no_double_booking;

CREATE UNIQUE INDEX bookings_no_double_booking
  ON bookings (desk_id, date, start_time)
  WHERE status != 'cancelled';
