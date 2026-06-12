import { query } from '../db';
import { sendNoShowNotification } from './email';
import { logger } from '../logger';

interface ExpiredBooking {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  desk_id: string;
  desk_label: string;
  floor_name: string;
  building: string;
  user_id: string;
  user_email: string;
  user_name: string;
  tenant_id: string;
  checkin_window_minutes: number;
}

async function releaseExpiredBookings(): Promise<void> {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // Find confirmed bookings where start_time + window has passed and still unchecked-in
  const result = await query<ExpiredBooking>(
    `SELECT b.id, b.date::text, b.start_time::text, b.end_time::text,
            b.desk_id, d.label AS desk_label, f.name AS floor_name, f.building,
            b.user_id, u.email AS user_email, u.name AS user_name, b.tenant_id,
            COALESCE(s.checkin_window_minutes, 15) AS checkin_window_minutes
     FROM bookings b
     JOIN desks d ON d.id = b.desk_id
     JOIN floors f ON f.id = d.floor_id
     JOIN users u ON u.id = b.user_id
     LEFT JOIN tenant_checkin_settings s ON s.tenant_id = b.tenant_id
     WHERE b.date = $1::date
       AND b.status = 'confirmed'
       AND (b.start_time + (COALESCE(s.checkin_window_minutes, 15) * INTERVAL '1 minute'))::time <= $2::time
       AND COALESCE(s.checkin_enabled, true) = true`,
    [today, nowTime],
  );

  for (const booking of result.rows) {
    try {
      await query(
        `UPDATE bookings SET status = 'no_show', no_show_released_at = now() WHERE id = $1 AND status = 'confirmed'`,
        [booking.id],
      );
      await query(
        `UPDATE users SET no_show_count = no_show_count + 1 WHERE id = $1`,
        [booking.user_id],
      );
      await sendNoShowNotification(
        { id: booking.user_id, email: booking.user_email, name: booking.user_name },
        { id: booking.id, date: booking.date, start_time: booking.start_time, end_time: booking.end_time },
        { id: booking.desk_id, label: booking.desk_label },
        { id: '', name: booking.floor_name, building: booking.building },
      );
      logger.info({ bookingId: booking.id }, '[noshow] Released unclaimed booking');
    } catch (err) {
      logger.error({ err, bookingId: booking.id }, '[noshow] Error releasing booking');
    }
  }

  if (result.rows.length > 0) {
    logger.info(`[noshow] Released ${result.rows.length} unclaimed booking(s)`);
  }
}

let _timer: ReturnType<typeof setInterval> | null = null;

export function startNoShowScheduler(intervalMs = 60_000): void {
  if (_timer) return;
  logger.info(`[noshow] Scheduler started (interval: ${intervalMs} ms)`);
  _timer = setInterval(() => {
    releaseExpiredBookings().catch((err: unknown) =>
      logger.error({ err }, '[noshow] Scheduler error'),
    );
  }, intervalMs);
}

export function stopNoShowScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
