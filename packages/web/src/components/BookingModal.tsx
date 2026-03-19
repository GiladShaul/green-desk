import { useState } from 'react';
import { api } from '../api/client';
import type { Desk } from '../pages/FloorView';
import styles from './BookingModal.module.css';

const TIME_SLOTS = [
  { label: 'Morning (09:00 – 13:00)', start: '09:00', end: '13:00' },
  { label: 'Afternoon (13:00 – 17:00)', start: '13:00', end: '17:00' },
  { label: 'Full Day (09:00 – 17:00)', start: '09:00', end: '17:00' },
];

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface BookingModalProps {
  desk: Desk;
  date: string;
  onClose: () => void;
  onBooked: () => void;
}

export function BookingModal({ desk, date, onClose, onBooked }: BookingModalProps) {
  const [slotIdx, setSlotIdx] = useState(2); // default full day
  const [isRecurring, setIsRecurring] = useState(false);
  // day_of_week derived from selected date (0=Sunday)
  const [recurringDay, setRecurringDay] = useState<number>(() => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).getDay();
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleConfirm() {
    setError('');
    setSubmitting(true);
    const slot = TIME_SLOTS[slotIdx];
    try {
      if (isRecurring) {
        await api.post('/recurring-bookings', {
          desk_id: desk.id,
          day_of_week: recurringDay,
          start_time: slot.start,
          end_time: slot.end,
          start_date: date,
        });
      } else {
        await api.post('/bookings', {
          desk_id: desk.id,
          date,
          start_time: slot.start,
          end_time: slot.end,
        });
      }
      setSuccess(true);
      setTimeout(onBooked, 1000);
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError(e.message);
      } else {
        setError('Booking failed');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>

        <h3 className={styles.title}>Book Desk: {desk.label}</h3>
        <p className={styles.dateLine}>Date: <strong>{date}</strong></p>

        {success ? (
          <p className={styles.successMsg}>
            {isRecurring ? 'Recurring booking created!' : 'Booking confirmed!'}
          </p>
        ) : (
          <>
            <div className={styles.slots}>
              {TIME_SLOTS.map((slot, i) => (
                <label key={i} className={`${styles.slotOption} ${slotIdx === i ? styles.slotSelected : ''}`}>
                  <input
                    type="radio"
                    name="slot"
                    checked={slotIdx === i}
                    onChange={() => setSlotIdx(i)}
                  />
                  {slot.label}
                </label>
              ))}
            </div>

            <label className={styles.recurringToggle}>
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={(e) => setIsRecurring(e.target.checked)}
              />
              <span>Repeat weekly</span>
            </label>

            {isRecurring && (
              <div className={styles.dayPicker}>
                <span className={styles.dayPickerLabel}>Every:</span>
                <div className={styles.dayOptions}>
                  {DAY_LABELS.map((label, dow) => (
                    <label
                      key={dow}
                      className={`${styles.dayOption} ${recurringDay === dow ? styles.daySelected : ''}`}
                    >
                      <input
                        type="radio"
                        name="recurringDay"
                        checked={recurringDay === dow}
                        onChange={() => setRecurringDay(dow)}
                      />
                      {label.slice(0, 3)}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <p className={styles.error}>
                {error.includes('conflict') || error.includes('409')
                  ? 'This slot conflicts with an existing booking. Please choose another time.'
                  : error}
              </p>
            )}

            <div className={styles.actions}>
              <button className={styles.cancelBtn} onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button className={styles.confirmBtn} onClick={handleConfirm} disabled={submitting}>
                {submitting ? 'Booking…' : isRecurring ? 'Set Recurring' : 'Confirm Booking'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
