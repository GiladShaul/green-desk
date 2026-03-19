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

interface Room {
  id: string;
  floor_id: string;
  name: string;
  capacity: number;
  status: 'active' | 'inactive';
  x_position: number;
  y_position: number;
  equipment: string[];
  created_at: string;
}

interface RoomFormData {
  name: string;
  capacity: string;
  x_position: string;
  y_position: string;
  equipment: string;
}

const emptyForm: RoomFormData = { name: '', capacity: '4', x_position: '0', y_position: '0', equipment: '' };

function parseEquipment(raw: string): string[] {
  return raw.split(',').map(t => t.trim()).filter(Boolean);
}

export function AdminRooms() {
  const { floorId } = useParams<{ floorId: string }>();
  const [floor, setFloor] = useState<Floor | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<RoomFormData>(emptyForm);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RoomFormData>(emptyForm);
  const [editError, setEditError] = useState('');
  const [saving, setSaving] = useState(false);

  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    if (!floorId) return;
    Promise.all([
      api.get<Floor>(`/floors/${floorId}`),
      api.get<Room[]>(`/floors/${floorId}/rooms`),
    ])
      .then(([f, r]) => { setFloor(f); setRooms(r); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [floorId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      const room = await api.post<Room>('/rooms', {
        floor_id: floorId,
        name: createForm.name,
        capacity: parseInt(createForm.capacity, 10) || 4,
        x_position: parseFloat(createForm.x_position) || 0,
        y_position: parseFloat(createForm.y_position) || 0,
        equipment: parseEquipment(createForm.equipment),
      });
      setRooms(prev => [...prev, room]);
      setCreateForm(emptyForm);
      setShowCreate(false);
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create room');
    } finally {
      setCreating(false);
    }
  }

  function startEdit(room: Room) {
    setEditId(room.id);
    setEditForm({
      name: room.name,
      capacity: String(room.capacity),
      x_position: String(room.x_position),
      y_position: String(room.y_position),
      equipment: room.equipment.join(', '),
    });
    setEditError('');
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setSaving(true);
    setEditError('');
    try {
      const updated = await api.patch<Room>(`/rooms/${editId}`, {
        name: editForm.name,
        capacity: parseInt(editForm.capacity, 10) || 4,
        x_position: parseFloat(editForm.x_position) || 0,
        y_position: parseFloat(editForm.y_position) || 0,
        equipment: parseEquipment(editForm.equipment),
      });
      setRooms(prev => prev.map(r => r.id === editId ? updated : r));
      setEditId(null);
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(room: Room) {
    setTogglingId(room.id);
    try {
      const newStatus = room.status === 'active' ? 'inactive' : 'active';
      const updated = await api.patch<Room>(`/rooms/${room.id}`, { status: newStatus });
      setRooms(prev => prev.map(r => r.id === room.id ? updated : r));
    } catch {
      // ignore
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div>
      <Link to="/admin/floors" className={styles.backLink}>← Back to Floors</Link>

      {floor && (
        <div className={styles.pageHeader}>
          <div>
            <h2 className={styles.pageTitle}>Rooms — {floor.name}</h2>
            <p className={styles.subheading}>{floor.building}, floor {floor.floor_number}</p>
          </div>
          <button className={styles.btnPrimary} onClick={() => { setShowCreate(v => !v); setCreateError(''); }}>
            {showCreate ? 'Cancel' : '+ Add Room'}
          </button>
        </div>
      )}

      {showCreate && (
        <form className={styles.form} onSubmit={handleCreate}>
          <h3 className={styles.formTitle}>New Room</h3>
          <div className={styles.formRow}>
            <label className={styles.label}>Name
              <input
                className={styles.input}
                value={createForm.name}
                onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Conference Room A"
                required
              />
            </label>
            <label className={styles.label}>Capacity
              <input
                className={styles.input}
                type="number"
                min={1}
                value={createForm.capacity}
                onChange={e => setCreateForm(f => ({ ...f, capacity: e.target.value }))}
              />
            </label>
          </div>
          <div className={styles.formRow}>
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
          <div className={styles.formRow}>
            <label className={styles.label}>Equipment tags (comma-separated)
              <input
                className={styles.input}
                value={createForm.equipment}
                onChange={e => setCreateForm(f => ({ ...f, equipment: e.target.value }))}
                placeholder="e.g. projector, whiteboard, video_conferencing"
              />
            </label>
          </div>
          {createError && <p className={styles.error}>{createError}</p>}
          <button className={styles.btnPrimary} type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create Room'}
          </button>
        </form>
      )}

      {loading && <p className={styles.meta}>Loading rooms…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && !error && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Capacity</th>
              <th>Equipment</th>
              <th>Position (x, y)</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rooms.length === 0 && (
              <tr><td colSpan={6} className={styles.emptyCell}>No rooms on this floor yet.</td></tr>
            )}
            {rooms.map(room => (
              editId === room.id ? (
                <tr key={room.id}>
                  <td colSpan={6}>
                    <form className={styles.inlineForm} onSubmit={handleSaveEdit}>
                      <input
                        className={styles.input}
                        value={editForm.name}
                        onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="Name"
                        required
                        style={{ minWidth: 140 }}
                      />
                      <input
                        className={styles.input}
                        type="number"
                        min={1}
                        value={editForm.capacity}
                        onChange={e => setEditForm(f => ({ ...f, capacity: e.target.value }))}
                        placeholder="Capacity"
                        style={{ width: 80 }}
                      />
                      <input
                        className={styles.input}
                        value={editForm.equipment}
                        onChange={e => setEditForm(f => ({ ...f, equipment: e.target.value }))}
                        placeholder="Equipment (comma-sep)"
                        style={{ minWidth: 200 }}
                      />
                      {editError && <span className={styles.error}>{editError}</span>}
                      <button className={styles.btnPrimary} type="submit" disabled={saving}>
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button className={styles.toggle} type="button" onClick={() => setEditId(null)}>
                        Cancel
                      </button>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={room.id}>
                  <td>{room.name}</td>
                  <td>{room.capacity}</td>
                  <td>
                    {room.equipment.length === 0
                      ? <span style={{ color: '#9ca3af' }}>—</span>
                      : room.equipment.join(', ')}
                  </td>
                  <td>({room.x_position}, {room.y_position})</td>
                  <td>
                    <span className={`${styles.badge} ${room.status === 'active' ? styles.badgeActive : styles.badgeInactive}`}>
                      {room.status}
                    </span>
                  </td>
                  <td className={styles.actions}>
                    <button className={styles.btnSmallSecondary} onClick={() => startEdit(room)}>
                      Edit
                    </button>
                    <button
                      className={styles.toggle}
                      onClick={() => handleToggleStatus(room)}
                      disabled={togglingId === room.id}
                    >
                      {room.status === 'active' ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
