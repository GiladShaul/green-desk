import { query } from '../db';
import { notifyBookingEvent } from './webhook';

// How many minutes before a booking the reminder fires (±WINDOW_MINUTES tolerance)
const REMIND_BEFORE_MINUTES = 30;
const WINDOW_MINUTES = 2; // fire once within a ±2 min window around the target

interface UpcomingBooking {
  id: string;
  booking_type: 'desk' | 'room';
  date: string;
  start_time: string;
  end_time: string;
  resource_label: string;
  floor_name: string;
  building: string;
  user_name: string;
  user_email: string;
}

async function sendPendingReminders(): Promise<void> {
  const now = new Date();

  // Target time = now + REMIND_BEFORE_MINUTES, with ±WINDOW_MINUTES tolerance
  const targetMs = now.getTime() + REMIND_BEFORE_MINUTES * 60 * 1000;
  const lowerMs = targetMs - WINDOW_MINUTES * 60 * 1000;
  const upperMs = targetMs + WINDOW_MINUTES * 60 * 1000;

  // Express as HH:MM time strings for today
  function toHHMM(ms: number): string {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  const today = now.toISOString().split('T')[0];
  const lowerTime = toHHMM(lowerMs);
  const upperTime = toHHMM(upperMs);

  // Desk bookings due for a reminder
  const deskResult = await query<UpcomingBooking>(
    `SELECT b.id, 'desk' AS booking_type, b.date::text, b.start_time::text, b.end_time::text,
            d.label AS resource_label, f.name AS floor_name, f.building,
            u.name AS user_name, u.email AS user_email
     FROM bookings b
     JOIN desks d ON d.id = b.desk_id
     JOIN floors f ON f.id = d.floor_id
     JOIN users u ON u.id = b.user_id
     LEFT JOIN reminder_log rl ON rl.booking_id = b.id AND rl.booking_type = 'desk'
     WHERE b.date = $1::date
       AND b.status = 'confirmed'
       AND b.start_time::text >= $2
       AND b.start_time::text <= $3
       AND rl.id IS NULL`,
    [today, lowerTime, upperTime],
  );

  // Room bookings due for a reminder
  const roomResult = await query<UpcomingBooking>(
    `SELECT rb.id, 'room' AS booking_type, rb.date::text, rb.start_time::text, rb.end_time::text,
            r.name AS resource_label, f.name AS floor_name, f.building,
            u.name AS user_name, u.email AS user_email
     FROM room_bookings rb
     JOIN rooms r ON r.id = rb.room_id
     JOIN floors f ON f.id = rb.floor_id
     JOIN users u ON u.id = rb.user_id
     LEFT JOIN reminder_log rl ON rl.booking_id = rb.id AND rl.booking_type = 'room'
     WHERE rb.date = $1::date
       AND rb.status = 'confirmed'
       AND rb.start_time::text >= $2
       AND rb.start_time::text <= $3
       AND rl.id IS NULL`,
    [today, lowerTime, upperTime],
  );

  const pending = [...deskResult.rows, ...roomResult.rows];

  for (const b of pending) {
    try {
      await notifyBookingEvent(
        'booking_reminder',
        { id: b.id, date: b.date, start_time: b.start_time, end_time: b.end_time },
        { label: b.resource_label, resource_type: b.booking_type },
        { name: b.floor_name, building: b.building },
        { name: b.user_name, email: b.user_email },
      );
      // Record in reminder_log so we never send twice
      await query(
        `INSERT INTO reminder_log (booking_id, booking_type) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [b.id, b.booking_type],
      );
    } catch (err) {
      console.error(`[reminder] Failed to send reminder for booking ${b.id}:`, err);
    }
  }

  if (pending.length > 0) {
    console.log(`[reminder] Sent ${pending.length} reminder(s)`);
  }
}

let _schedulerTimer: ReturnType<typeof setInterval> | null = null;

export function startReminderScheduler(intervalMs = 60_000): void {
  if (_schedulerTimer) return; // already running
  console.log('[reminder] Scheduler started (interval:', intervalMs, 'ms)');
  _schedulerTimer = setInterval(() => {
    sendPendingReminders().catch((err: unknown) =>
      console.error('[reminder] Scheduler error:', err),
    );
  }, intervalMs);
}

export function stopReminderScheduler(): void {
  if (_schedulerTimer) {
    clearInterval(_schedulerTimer);
    _schedulerTimer = null;
  }
}
