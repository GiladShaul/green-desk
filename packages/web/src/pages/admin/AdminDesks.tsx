import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import styles from './Admin.module.css';

interface Floor {
  id: string;
  name: string;
  building: string;
  floor_number: number;
}

interface Desk {
  id: string;
  floor_id: string;
  label: string;
  x_position: number;
  y_position: number;
  status: 'active' | 'inactive';
  created_at: string;
}

interface DeskFormData {
  label: string;
  x_position: string;
  y_position: string;
}

const emptyForm: DeskFormData = { label: '', x_position: '0', y_position: '0' };

export function AdminDesks() {
  const { floorId } = useParams<{ floorId: string }>();
  const [floor, setFloor] = useState<Floor | null>(null);
  const [desks, setDesks] = useState<Desk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<DeskFormData>(emptyForm);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    if (!floorId) return;
    Promise.all([
      api.get<Floor>(`/floors/${floorId}`),
      api.get<Desk[]>(`/floors/${floorId}/desks`),
    ])
      .then(([f, d]) => { setFloor(f); setDesks(d); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [floorId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      const desk = await api.post<Desk>('/desks', {
        floor_id: floorId,
        label: createForm.label,
        x_position: parseFloat(createForm.x_position),
        y_position: parseFloat(createForm.y_position),
      });
      setDesks(prev => [...prev, desk]);
      setCreateForm(emptyForm);
      setShowCreate(false);
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create desk');
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleStatus(desk: Desk) {
    setTogglingId(desk.id);
    try {
      const newStatus = desk.status === 'active' ? 'inactive' : 'active';
      const updated = await api.patch<Desk>(`/desks/${desk.id}`, { status: newStatus });
      setDesks(prev => prev.map(d => d.id === desk.id ? updated : d));
    } catch {
      // ignore, could surface a toast
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(desk: Desk) {
    try {
      await api.delete(`/desks/${desk.id}`);
      setDesks(prev => prev.map(d => d.id === desk.id ? { ...d, status: 'inactive' } : d));
    } catch {
      // ignore
    }
  }

  return (
    <div>
      <Link to="/admin/floors" className={styles.backLink}>← Back to Floors</Link>

      {floor && (
        <div className={styles.pageHeader}>
          <div>
            <h2 className={styles.pageTitle}>Desks — {floor.name}</h2>
            <p className={styles.subheading}>{floor.building}, floor {floor.floor_number}</p>
          </div>
          <button className={styles.btnPrimary} onClick={() => setShowCreate(v => !v)}>
            {showCreate ? 'Cancel' : '+ Add Desk'}
          </button>
        </div>
      )}

      {showCreate && (
        <form className={styles.form} onSubmit={handleCreate}>
          <h3 className={styles.formTitle}>New Desk</h3>
          <div className={styles.formRow}>
            <label className={styles.label}>Label
              <input
                className={styles.input}
                value={createForm.label}
                onChange={e => setCreateForm(f => ({ ...f, label: e.target.value }))}
                placeholder="e.g. A-01"
                required
              />
            </label>
            <label className={styles.label}>X Position
              <input
                className={styles.input}
                type="number"
                value={createForm.x_position}
                onChange={e => setCreateForm(f => ({ ...f, x_position: e.target.value }))}
              />
            </label>
            <label className={styles.label}>Y Position
              <input
                className={styles.input}
                type="number"
                value={createForm.y_position}
                onChange={e => setCreateForm(f => ({ ...f, y_position: e.target.value }))}
              />
            </label>
          </div>
          {createError && <p className={styles.error}>{createError}</p>}
          <button className={styles.btnPrimary} type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create Desk'}
          </button>
        </form>
      )}

      {loading && <p className={styles.meta}>Loading desks…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && !error && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Label</th>
              <th>Position (x, y)</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {desks.length === 0 && (
              <tr><td colSpan={4} className={styles.emptyCell}>No desks on this floor yet.</td></tr>
            )}
            {desks.map(desk => (
              <tr key={desk.id}>
                <td>{desk.label}</td>
                <td>({desk.x_position}, {desk.y_position})</td>
                <td>
                  <span className={`${styles.badge} ${desk.status === 'active' ? styles.badgeActive : styles.badgeInactive}`}>
                    {desk.status}
                  </span>
                </td>
                <td className={styles.actions}>
                  <button
                    className={styles.toggle}
                    onClick={() => handleToggleStatus(desk)}
                    disabled={togglingId === desk.id}
                  >
                    {desk.status === 'active' ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    className={styles.btnDanger}
                    onClick={() => handleDelete(desk)}
                    disabled={desk.status === 'inactive'}
                    title={desk.status === 'inactive' ? 'Already deactivated' : 'Deactivate desk'}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
