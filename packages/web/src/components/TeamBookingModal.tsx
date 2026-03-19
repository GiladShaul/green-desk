import { useState } from 'react';
import { api } from '../api/client';
import type { Desk } from '../pages/FloorView';
import styles from './TeamBookingModal.module.css';

interface TeamBookingModalProps {
  floorId: string;
  date: string;
  selectedDesks: Desk[];
  onClose: () => void;
  onBooked: () => void;
}

interface DeskAssignment {
  desk_id: string;
  assigned_user_id: string | null;
}

export function TeamBookingModal({ floorId, date, selectedDesks, onClose, onBooked }: TeamBookingModalProps) {
  const [title, setTitle] = useState('');
  const [assignments, setAssignments] = useState<DeskAssignment[]>(
    selectedDesks.map(d => ({ desk_id: d.id, assigned_user_id: null }))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  function updateAssignment(deskId: string, userId: string) {
    setAssignments(prev =>
      prev.map(a => a.desk_id === deskId ? { ...a, assigned_user_id: userId || null } : a)
    );
  }

  async function handleSubmit() {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.post('/team-bookings', {
        floor_id: floorId,
        date,
        title: title.trim(),
        desks: assignments.map(a => ({
          desk_id: a.desk_id,
          ...(a.assigned_user_id ? { assigned_user_id: a.assigned_user_id } : {}),
        })),
      });
      setSuccess(true);
      setTimeout(() => {
        onBooked();
      }, 1200);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Booking failed');
    } finally {
      setSubmitting(false);
    }
  }

  const deskMap = Object.fromEntries(selectedDesks.map(d => [d.id, d]));

  function formatDate(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} disabled={submitting}>×</button>

        <h3 className={styles.title}>Create Team Booking</h3>
        <p className={styles.subtitle}>{formatDate(date)} · {selectedDesks.length} desk{selectedDesks.length !== 1 ? 's' : ''} selected</p>

        {success ? (
          <p className={styles.successMsg}>Team booking created!</p>
        ) : (
          <>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="team-booking-title">Booking title</label>
              <input
                id="team-booking-title"
                className={styles.input}
                type="text"
                placeholder="e.g. Engineering team day"
                value={title}
                onChange={e => setTitle(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className={styles.selectedDesks}>
              <span className={styles.label}>Selected desks</span>
              {assignments.length === 0 ? (
                <p className={styles.emptyDesks}>No desks selected.</p>
              ) : (
                <div className={styles.deskList}>
                  {assignments.map(a => {
                    const desk = deskMap[a.desk_id];
                    return (
                      <div key={a.desk_id} className={styles.deskRow}>
                        <span className={styles.deskBadge}>{desk?.label ?? a.desk_id}</span>
                        <input
                          className={styles.assignSelect}
                          type="text"
                          placeholder="Assign user email (optional)"
                          value={a.assigned_user_id ?? ''}
                          onChange={e => updateAssignment(a.desk_id, e.target.value)}
                          disabled={submitting}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
              <p className={styles.hint}>Optionally assign desks to team members by user ID. Leave blank for open claiming.</p>
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.actions}>
              <button className={styles.cancelBtn} onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button
                className={styles.confirmBtn}
                onClick={handleSubmit}
                disabled={submitting || assignments.length === 0}
              >
                {submitting ? 'Booking…' : 'Create Team Booking'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
