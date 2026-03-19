import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { BookingModal } from '../components/BookingModal';
import styles from './FloorView.module.css';

interface Floor {
  id: string;
  name: string;
  building: string;
  floor_number: number;
}

export interface Desk {
  id: string;
  floor_id: string;
  label: string;
  x_position: number;
  y_position: number;
  status: 'active' | 'inactive';
  availability?: 'available' | 'booked';
}

function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function FloorView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [floor, setFloor] = useState<Floor | null>(null);
  const [desks, setDesks] = useState<Desk[]>([]);
  const [date, setDate] = useState<string>(toLocalDateString(new Date()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDesk, setSelectedDesk] = useState<Desk | null>(null);

  useEffect(() => {
    if (!id) return;
    api.get<Floor>(`/floors/${id}`)
      .catch(() => null)
      .then((f) => {
        if (f) setFloor(f);
        else setError('Floor not found');
      });
  }, [id]);

  const loadDesks = useCallback(() => {
    if (!id) return;
    setLoading(true);
    api.get<Desk[]>(`/floors/${id}/desks?date=${date}`)
      .then(setDesks)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, date]);

  useEffect(() => {
    loadDesks();
  }, [loadDesks]);

  function deskColorClass(desk: Desk): string {
    if (desk.status === 'inactive') return styles.deskInactive;
    if (desk.availability === 'booked') return styles.deskBooked;
    return styles.deskAvailable;
  }

  function handleDeskClick(desk: Desk) {
    if (desk.status === 'inactive' || desk.availability === 'booked') return;
    setSelectedDesk(desk);
  }

  return (
    <div>
      <button className={styles.back} onClick={() => navigate('/dashboard')}>
        ← Back to floors
      </button>

      {floor && (
        <div className={styles.header}>
          <h2 className={styles.title}>{floor.name}</h2>
          <span className={styles.subtitle}>{floor.building} · Floor {floor.floor_number}</span>
        </div>
      )}

      <div className={styles.controls}>
        <label className={styles.dateLabel}>
          Date:
          <input
            type="date"
            className={styles.dateInput}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <div className={styles.legend}>
          <span className={styles.legendItem}><span className={styles.dotAvailable} /> Available</span>
          <span className={styles.legendItem}><span className={styles.dotBooked} /> Booked</span>
          <span className={styles.legendItem}><span className={styles.dotInactive} /> Inactive</span>
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}
      {loading && <p className={styles.meta}>Loading desks…</p>}

      {!loading && !error && desks.length === 0 && (
        <p className={styles.meta}>No desks on this floor.</p>
      )}

      <div className={styles.deskGrid}>
        {desks.map((desk) => (
          <button
            key={desk.id}
            className={`${styles.desk} ${deskColorClass(desk)}`}
            onClick={() => handleDeskClick(desk)}
            disabled={desk.status === 'inactive' || desk.availability === 'booked'}
            title={
              desk.status === 'inactive'
                ? 'Inactive'
                : desk.availability === 'booked'
                ? 'Already booked'
                : `Book ${desk.label}`
            }
          >
            {desk.label}
          </button>
        ))}
      </div>

      {selectedDesk && (
        <BookingModal
          desk={selectedDesk}
          date={date}
          onClose={() => setSelectedDesk(null)}
          onBooked={() => {
            setSelectedDesk(null);
            loadDesks();
          }}
        />
      )}
    </div>
  );
}
