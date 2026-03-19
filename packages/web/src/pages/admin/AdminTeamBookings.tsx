import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import styles from './Admin.module.css';

interface TeamBooking {
  id: string;
  floor_id: string;
  created_by_user_id: string;
  date: string;
  title: string;
  status: 'confirmed' | 'cancelled';
  created_at: string;
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
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

export function AdminTeamBookings() {
  const [date, setDate] = useState<string>(toLocalDateString(new Date()));
  const [bookings, setBookings] = useState<TeamBooking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState('');

  function loadBookings(d: string) {
    setLoading(true);
    setError('');
    api.get<TeamBooking[]>(`/team-bookings?date=${d}`)
      .then(setBookings)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadBookings(date);
  }, [date]);

  async function handleCancel(id: string) {
    setCancellingId(id);
    setCancelError('');
    try {
      await api.delete(`/team-bookings/${id}`);
      setBookings(prev => prev.map(b => b.id === id ? { ...b, status: 'cancelled' } : b));
    } catch (e: unknown) {
      setCancelError(e instanceof Error ? e.message : 'Cancellation failed');
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div>
      <h2 className={styles.heading}>Team Bookings</h2>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: 500 }}>
          Date:
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={{ padding: '0.35rem 0.6rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.875rem' }}
          />
        </label>
      </div>

      {error && <p className={styles.error}>{error}</p>}
      {cancelError && <p className={styles.error}>{cancelError}</p>}
      {loading && <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>Loading…</p>}

      {!loading && !error && bookings.length === 0 && (
        <p style={{ color: '#9ca3af', fontSize: '0.9rem' }}>No team bookings for this date.</p>
      )}

      {!loading && bookings.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Title</th>
              <th className={styles.th}>Date</th>
              <th className={styles.th}>Status</th>
              <th className={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map(b => (
              <tr key={b.id} className={styles.tr}>
                <td className={styles.td}>{b.title}</td>
                <td className={styles.td}>{formatDate(b.date)}</td>
                <td className={styles.td}>
                  <span style={{
                    display: 'inline-block',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '999px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    background: b.status === 'confirmed' ? '#dcfce7' : '#f3f4f6',
                    color: b.status === 'confirmed' ? '#166534' : '#6b7280',
                  }}>
                    {b.status}
                  </span>
                </td>
                <td className={styles.td}>
                  {b.status === 'confirmed' && (
                    <button
                      className={styles.deleteBtn}
                      onClick={() => handleCancel(b.id)}
                      disabled={cancellingId === b.id}
                    >
                      {cancellingId === b.id ? 'Cancelling…' : 'Cancel'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
