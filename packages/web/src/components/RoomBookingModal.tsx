import { useState, useEffect } from 'react';
import { api } from '../api/client';
import styles from './BookingModal.module.css';
import roomStyles from './RoomBookingModal.module.css';

export interface Room {
  id: string;
  floor_id: string;
  name: string;
  capacity: number;
  status: 'active' | 'inactive';
  x_position: number;
  y_position: number;
  equipment: string[];
  availability?: 'available' | 'booked';
}

interface ExistingBooking {
  id: string;
  start_time: string;
  end_time: string;
  title: string | null;
}

interface RoomBookingModalProps {
  room: Room;
  date: string;
  onClose: () => void;
  onBooked: () => void;
}

const TIME_SLOTS = [
  { label: 'Morning (09:00 – 13:00)', start: '09:00', end: '13:00' },
  { label: 'Afternoon (13:00 – 17:00)', start: '13:00', end: '17:00' },
  { label: 'Full Day (09:00 – 17:00)', start: '09:00', end: '17:00' },
];

const EQUIPMENT_ICONS: Record<string, string> = {
  projector: '📽',
  whiteboard: '📝',
  video_conferencing: '📹',
  phone: '📞',
};

export function RoomBookingModal({ room, date, onClose, onBooked }: RoomBookingModalProps) {
  const [useCustomTime, setUseCustomTime] = useState(false);
  const [slotIdx, setSlotIdx] = useState(0);
  const [customStart, setCustomStart] = useState('09:00');
  const [customEnd, setCustomEnd] = useState('10:00');
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [existingBookings, setExistingBookings] = useState<ExistingBooking[]>([]);

  useEffect(() => {
    api.get<ExistingBooking[]>(`/room-bookings?roomId=${room.id}&date=${date}`)
      .then(setExistingBookings)
      .catch(() => {/* non-critical */});
  }, [room.id, date]);

  const slot = useCustomTime
    ? { start: customStart, end: customEnd }
    : TIME_SLOTS[slotIdx];

  async function handleConfirm() {
    setError('');

    if (useCustomTime) {
      if (!customStart || !customEnd) {
        setError('Please enter start and end times');
        return;
      }
      if (customEnd <= customStart) {
        setError('End time must be after start time');
        return;
      }
    }

    setSubmitting(true);
    try {
      await api.post('/room-bookings', {
        room_id: room.id,
        date,
        start_time: slot.start,
        end_time: slot.end,
        title: title.trim() || undefined,
      });
      setSuccess(true);
      setTimeout(onBooked, 1000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Booking failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>

        <h3 className={styles.title}>Book Room: {room.name}</h3>
        <p className={styles.dateLine}>Date: <strong>{date}</strong></p>

        <div className={roomStyles.roomMeta}>
          <span className={roomStyles.capacity}>👥 Capacity: {room.capacity}</span>
          {room.equipment.length > 0 && (
            <div className={roomStyles.equipment}>
              {room.equipment.map(tag => (
                <span key={tag} className={roomStyles.tag}>
                  {EQUIPMENT_ICONS[tag] ?? '•'} {tag.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          )}
          {existingBookings.length > 0 && (
            <div className={roomStyles.existingBookings}>
              <span className={roomStyles.existingLabel}>Already booked:</span>
              {existingBookings.map(b => (
                <span key={b.id} className={roomStyles.existingSlot}>
                  {b.start_time.slice(0, 5)} – {b.end_time.slice(0, 5)}
                  {b.title ? ` (${b.title})` : ''}
                </span>
              ))}
            </div>
          )}
        </div>

        {success ? (
          <p className={styles.successMsg}>Room booking confirmed!</p>
        ) : (
          <>
            <label className={roomStyles.titleLabel}>
              Meeting title (optional)
              <input
                className={roomStyles.titleInput}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Team standup"
                maxLength={200}
              />
            </label>

            <label className={styles.recurringToggle}>
              <input
                type="checkbox"
                checked={useCustomTime}
                onChange={(e) => setUseCustomTime(e.target.checked)}
              />
              <span>Custom time</span>
            </label>

            {useCustomTime ? (
              <div className={roomStyles.customTime}>
                <label className={roomStyles.timeLabel}>
                  Start
                  <input
                    type="time"
                    className={roomStyles.timeInput}
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                  />
                </label>
                <span className={roomStyles.timeSep}>–</span>
                <label className={roomStyles.timeLabel}>
                  End
                  <input
                    type="time"
                    className={roomStyles.timeInput}
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                  />
                </label>
              </div>
            ) : (
              <div className={styles.slots}>
                {TIME_SLOTS.map((s, i) => (
                  <label key={i} className={`${styles.slotOption} ${slotIdx === i ? styles.slotSelected : ''}`}>
                    <input
                      type="radio"
                      name="roomSlot"
                      checked={slotIdx === i}
                      onChange={() => setSlotIdx(i)}
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            )}

            {error && (
              <p className={styles.error}>
                {error.includes('conflict') || error.includes('409')
                  ? 'This slot is already booked. Please choose another time.'
                  : error}
              </p>
            )}

            <div className={styles.actions}>
              <button className={styles.cancelBtn} onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button className={styles.confirmBtn} onClick={handleConfirm} disabled={submitting}>
                {submitting ? 'Booking…' : 'Confirm Booking'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
