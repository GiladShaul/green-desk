import { useEffect, useState } from 'react';
import { api } from '../api/client';
import styles from './MyBookings.module.css';

interface TeamBooking {
  id: string;
  floor_id: string;
  created_by_user_id: string;
  date: string;
  title: string;
  status: 'confirmed' | 'cancelled';
  created_at: string;
  floor_name: string;
}

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

interface RecurringBooking {
  id: string;
  desk_id: string;
  floor_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  start_date: string;
  end_date: string | null;
  desk_label: string;
  floor_name: string;
}

interface RoomBooking {
  id: string;
  room_id: string;
  floor_id: string;
  date: string;
  start_time: string;
  end_time: string;
  title: string | null;
  status: 'confirmed' | 'cancelled';
  created_at: string;
  room_name: string;
  floor_name: string;
  capacity: number;
}

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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

interface RecurringCardProps {
  rb: RecurringBooking;
  onDeleteRequest: (id: string) => void;
}

function RecurringCard({ rb, onDeleteRequest }: RecurringCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.cardMain}>
        <span className={styles.deskLabel}>{rb.desk_label}</span>
        <span className={styles.floorName}>{rb.floor_name}</span>
      </div>
      <div className={styles.cardMeta}>
        <span className={styles.recurringBadge}>Every {DAY_LABELS[rb.day_of_week]}</span>
        <span className={styles.sep}>·</span>
        <span>{formatTimeSlot(rb.start_time, rb.end_time)}</span>
      </div>
      <div className={styles.cardFooter}>
        <span className={`${styles.status} ${styles.statusRecurring}`}>recurring</span>
        <button className={styles.cancelBtn} onClick={() => onDeleteRequest(rb.id)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function MyBookings() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [recurringBookings, setRecurringBookings] = useState<RecurringBooking[]>([]);
  const [roomBookings, setRoomBookings] = useState<RoomBooking[]>([]);
  const [teamBookings, setTeamBookings] = useState<TeamBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [deleteRbTarget, setDeleteRbTarget] = useState<string | null>(null);
  const [deletingRb, setDeletingRb] = useState(false);
  const [deleteRbError, setDeleteRbError] = useState('');
  const [cancelRoomTarget, setCancelRoomTarget] = useState<string | null>(null);
  const [cancellingRoom, setCancellingRoom] = useState(false);
  const [cancelRoomError, setCancelRoomError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get<Booking[]>('/bookings/me'),
      api.get<RecurringBooking[]>('/recurring-bookings'),
      api.get<RoomBooking[]>('/room-bookings/me'),
      api.get<TeamBooking[]>('/team-bookings/me'),
    ])
      .then(([b, rb, roomB, teamB]) => {
        setBookings(b);
        setRecurringBookings(rb);
        setRoomBookings(roomB);
        setTeamBookings(teamB);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const today = toLocalDateString(new Date());
  const upcoming = bookings.filter(b => b.date.split('T')[0] >= today);
  const past = bookings.filter(b => b.date.split('T')[0] < today);
  const upcomingRoomBookings = roomBookings.filter(b => b.date.split('T')[0] >= today);
  const pastRoomBookings = roomBookings.filter(b => b.date.split('T')[0] < today);

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

  async function handleConfirmDeleteRb() {
    if (!deleteRbTarget) return;
    setDeletingRb(true);
    setDeleteRbError('');
    try {
      await api.delete(`/recurring-bookings/${deleteRbTarget}`);
      setRecurringBookings(prev => prev.filter(rb => rb.id !== deleteRbTarget));
      setDeleteRbTarget(null);
    } catch (e: unknown) {
      setDeleteRbError(e instanceof Error ? e.message : 'Cancellation failed');
    } finally {
      setDeletingRb(false);
    }
  }

  function handleCloseRbDialog() {
    if (deletingRb) return;
    setDeleteRbTarget(null);
    setDeleteRbError('');
  }

  async function handleConfirmCancelRoom() {
    if (!cancelRoomTarget) return;
    setCancellingRoom(true);
    setCancelRoomError('');
    try {
      await api.delete(`/room-bookings/${cancelRoomTarget}`);
      setRoomBookings(prev =>
        prev.map(rb => rb.id === cancelRoomTarget ? { ...rb, status: 'cancelled' } : rb)
      );
      setCancelRoomTarget(null);
    } catch (e: unknown) {
      setCancelRoomError(e instanceof Error ? e.message : 'Cancellation failed');
    } finally {
      setCancellingRoom(false);
    }
  }

  function handleCloseRoomDialog() {
    if (cancellingRoom) return;
    setCancelRoomTarget(null);
    setCancelRoomError('');
  }

  return (
    <div>
      <h2 className={styles.heading}>My Bookings</h2>

      {loading && <p className={styles.meta}>Loading bookings…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && !error && (
        <>
          {recurringBookings.length > 0 && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Recurring</h3>
              <div className={styles.list}>
                {recurringBookings.map(rb => (
                  <RecurringCard
                    key={rb.id}
                    rb={rb}
                    onDeleteRequest={setDeleteRbTarget}
                  />
                ))}
              </div>
            </section>
          )}

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

          {teamBookings.length > 0 && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Team Bookings</h3>
              <div className={styles.list}>
                {teamBookings.map(tb => {
                  const dateStr = tb.date.split('T')[0];
                  const isUpcoming = dateStr >= today;
                  return (
                    <div key={tb.id} className={`${styles.card} ${tb.status === 'cancelled' ? styles.cardCancelled : ''}`}>
                      <div className={styles.cardMain}>
                        <span className={styles.deskLabel}>{tb.title}</span>
                        <span className={styles.floorName}>{tb.floor_name}</span>
                      </div>
                      <div className={styles.cardMeta}>
                        <span>{formatDate(tb.date)}</span>
                      </div>
                      <div className={styles.cardFooter}>
                        <span className={`${styles.status} ${tb.status === 'confirmed' ? styles.statusConfirmed : styles.statusCancelled}`}>
                          {tb.status}
                        </span>
                        {isUpcoming && tb.status === 'confirmed' && (
                          <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Team booking</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {(upcomingRoomBookings.length > 0 || pastRoomBookings.length > 0) && (
            <>
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>Room Bookings — Upcoming</h3>
                {upcomingRoomBookings.length === 0 ? (
                  <p className={styles.empty}>No upcoming room bookings.</p>
                ) : (
                  <div className={styles.list}>
                    {upcomingRoomBookings.map(b => {
                      const dateStr = b.date.split('T')[0];
                      const canCancel = b.status === 'confirmed' && dateStr >= today;
                      return (
                        <div key={b.id} className={`${styles.card} ${b.status === 'cancelled' ? styles.cardCancelled : ''}`}>
                          <div className={styles.cardMain}>
                            <span className={styles.deskLabel}>{b.room_name}</span>
                            <span className={styles.floorName}>{b.floor_name}</span>
                          </div>
                          {b.title && <p className={styles.floorName} style={{ margin: '0 0 0.25rem' }}>{b.title}</p>}
                          <div className={styles.cardMeta}>
                            <span>{formatDate(b.date)}</span>
                            <span className={styles.sep}>·</span>
                            <span>{formatTimeSlot(b.start_time, b.end_time)}</span>
                          </div>
                          <div className={styles.cardFooter}>
                            <span className={`${styles.status} ${b.status === 'confirmed' ? styles.statusConfirmed : styles.statusCancelled}`}>
                              {b.status}
                            </span>
                            {canCancel && (
                              <button className={styles.cancelBtn} onClick={() => setCancelRoomTarget(b.id)}>
                                Cancel
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {pastRoomBookings.length > 0 && (
                <section className={styles.section}>
                  <h3 className={styles.sectionTitle}>Room Bookings — Past</h3>
                  <div className={styles.list}>
                    {pastRoomBookings.map(b => (
                      <div key={b.id} className={`${styles.card} ${b.status === 'cancelled' ? styles.cardCancelled : ''}`}>
                        <div className={styles.cardMain}>
                          <span className={styles.deskLabel}>{b.room_name}</span>
                          <span className={styles.floorName}>{b.floor_name}</span>
                        </div>
                        {b.title && <p className={styles.floorName} style={{ margin: '0 0 0.25rem' }}>{b.title}</p>}
                        <div className={styles.cardMeta}>
                          <span>{formatDate(b.date)}</span>
                          <span className={styles.sep}>·</span>
                          <span>{formatTimeSlot(b.start_time, b.end_time)}</span>
                        </div>
                        <div className={styles.cardFooter}>
                          <span className={`${styles.status} ${b.status === 'confirmed' ? styles.statusConfirmed : styles.statusCancelled}`}>
                            {b.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
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

      {deleteRbTarget && (
        <div className={styles.overlay} onClick={handleCloseRbDialog}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <h4 className={styles.dialogTitle}>Cancel recurring booking?</h4>
            <p className={styles.dialogBody}>
              This will stop future bookings from being created. Already-confirmed bookings will not be affected.
            </p>
            {deleteRbError && <p className={styles.dialogError}>{deleteRbError}</p>}
            <div className={styles.dialogActions}>
              <button
                className={styles.dialogKeep}
                onClick={handleCloseRbDialog}
                disabled={deletingRb}
              >
                Keep Recurring
              </button>
              <button
                className={styles.dialogConfirm}
                onClick={handleConfirmDeleteRb}
                disabled={deletingRb}
              >
                {deletingRb ? 'Cancelling…' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelRoomTarget && (
        <div className={styles.overlay} onClick={handleCloseRoomDialog}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <h4 className={styles.dialogTitle}>Cancel room booking?</h4>
            <p className={styles.dialogBody}>This action cannot be undone.</p>
            {cancelRoomError && <p className={styles.dialogError}>{cancelRoomError}</p>}
            <div className={styles.dialogActions}>
              <button
                className={styles.dialogKeep}
                onClick={handleCloseRoomDialog}
                disabled={cancellingRoom}
              >
                Keep Booking
              </button>
              <button
                className={styles.dialogConfirm}
                onClick={handleConfirmCancelRoom}
                disabled={cancellingRoom}
              >
                {cancellingRoom ? 'Cancelling…' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
