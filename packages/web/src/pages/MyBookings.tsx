import { useEffect, useState } from 'react';
import { api } from '../api/client';
import styles from './MyBookings.module.css';

interface Booking {
  id: string;
  desk_id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: 'confirmed' | 'cancelled';
  created_at: string;
  desk_label: string;
  floor_id: string;
  floor_name: string;
}

function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDate(dateStr: string): string {
  const iso = dateStr.split('T')[0];
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function formatTimeSlot(start: string, end: string): string {
  return `${start.slice(0, 5)} – ${end.slice(0, 5)}`;
}

function statusClass(status: string): string {
  if (status === 'confirmed') return styles.statusConfirmed;
  if (status === 'cancelled') return styles.statusCancelled;
  return '';
}

interface BookingCardProps {
  booking: Booking;
  today: string;
  onCancelRequest: (id: string) => void;
}

function BookingCard({ booking, today, onCancelRequest }: BookingCardProps) {
  const dateStr = booking.date.split('T')[0];
  const canCancel = booking.status === 'confirmed' && dateStr >= today;

  return (
    <div className={`${styles.card} ${booking.status === 'cancelled' ? styles.cardCancelled : ''}`}>
      <div className={styles.cardMain}>
        <span className={styles.deskLabel}>{booking.desk_label}</span>
        <span className={styles.floorName}>{booking.floor_name}</span>
      </div>
      <div className={styles.cardMeta}>
        <span>{formatDate(booking.date)}</span>
        <span className={styles.sep}>·</span>
        <span>{formatTimeSlot(booking.start_time, booking.end_time)}</span>
      </div>
      <div className={styles.cardFooter}>
        <span className={`${styles.status} ${statusClass(booking.status)}`}>
          {booking.status}
        </span>
        {canCancel && (
          <button className={styles.cancelBtn} onClick={() => onCancelRequest(booking.id)}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export function MyBookings() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');

  useEffect(() => {
    api.get<Booking[]>('/bookings/me')
      .then(setBookings)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const today = toLocalDateString(new Date());
  const upcoming = bookings.filter(b => b.date.split('T')[0] >= today);
  const past = bookings.filter(b => b.date.split('T')[0] < today);

  async function handleConfirmCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    setCancelError('');
    try {
      await api.delete(`/bookings/${cancelTarget}`);
      setBookings(prev =>
        prev.map(b => b.id === cancelTarget ? { ...b, status: 'cancelled' } : b)
      );
      setCancelTarget(null);
    } catch (e: unknown) {
      setCancelError(e instanceof Error ? e.message : 'Cancellation failed');
    } finally {
      setCancelling(false);
    }
  }

  function handleCloseDialog() {
    if (cancelling) return;
    setCancelTarget(null);
    setCancelError('');
  }

  return (
    <div>
      <h2 className={styles.heading}>My Bookings</h2>

      {loading && <p className={styles.meta}>Loading bookings…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && !error && (
        <>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Upcoming</h3>
            {upcoming.length === 0 ? (
              <p className={styles.empty}>No upcoming bookings.</p>
            ) : (
              <div className={styles.list}>
                {upcoming.map(b => (
                  <BookingCard
                    key={b.id}
                    booking={b}
                    today={today}
                    onCancelRequest={setCancelTarget}
                  />
                ))}
              </div>
            )}
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Past</h3>
            {past.length === 0 ? (
              <p className={styles.empty}>No past bookings.</p>
            ) : (
              <div className={styles.list}>
                {past.map(b => (
                  <BookingCard
                    key={b.id}
                    booking={b}
                    today={today}
                    onCancelRequest={setCancelTarget}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {cancelTarget && (
        <div className={styles.overlay} onClick={handleCloseDialog}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <h4 className={styles.dialogTitle}>Cancel this booking?</h4>
            <p className={styles.dialogBody}>This action cannot be undone.</p>
            {cancelError && <p className={styles.dialogError}>{cancelError}</p>}
            <div className={styles.dialogActions}>
              <button
                className={styles.dialogKeep}
                onClick={handleCloseDialog}
                disabled={cancelling}
              >
                Keep Booking
              </button>
              <button
                className={styles.dialogConfirm}
                onClick={handleConfirmCancel}
                disabled={cancelling}
              >
                {cancelling ? 'Cancelling…' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
