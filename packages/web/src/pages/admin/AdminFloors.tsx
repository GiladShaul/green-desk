import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import styles from './Admin.module.css';

interface Floor {
  id: string;
  name: string;
  building: string;
  floor_number: number;
  created_at: string;
}

interface FloorFormData {
  name: string;
  building: string;
  floor_number: string;
}

const emptyForm: FloorFormData = { name: '', building: '', floor_number: '' };

export function AdminFloors() {
  const [floors, setFloors] = useState<Floor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<FloorFormData>(emptyForm);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FloorFormData>(emptyForm);
  const [editError, setEditError] = useState('');
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    api.get<Floor[]>('/floors')
      .then(setFloors)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      const floor = await api.post<Floor>('/floors', {
        name: createForm.name,
        building: createForm.building,
        floor_number: parseInt(createForm.floor_number, 10),
      });
      setFloors(prev => [...prev, floor]);
      setCreateForm(emptyForm);
      setShowCreate(false);
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create floor');
    } finally {
      setCreating(false);
    }
  }

  function startEdit(floor: Floor) {
    setEditId(floor.id);
    setEditForm({ name: floor.name, building: floor.building, floor_number: String(floor.floor_number) });
    setEditError('');
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setSaving(true);
    setEditError('');
    try {
      const updated = await api.patch<Floor>(`/floors/${editId}`, {
        name: editForm.name,
        building: editForm.building,
        floor_number: parseInt(editForm.floor_number, 10),
      });
      setFloors(prev => prev.map(f => f.id === editId ? updated : f));
      setEditId(null);
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : 'Failed to update floor');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api.delete(`/floors/${deleteTarget}`);
      setFloors(prev => prev.filter(f => f.id !== deleteTarget));
      setDeleteTarget(null);
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to delete floor');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <div className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>Floors</h2>
        <button className={styles.btnPrimary} onClick={() => setShowCreate(v => !v)}>
          {showCreate ? 'Cancel' : '+ Add Floor'}
        </button>
      </div>

      {showCreate && (
        <form className={styles.form} onSubmit={handleCreate}>
          <h3 className={styles.formTitle}>New Floor</h3>
          <div className={styles.formRow}>
            <label className={styles.label}>Name
              <input
                className={styles.input}
                value={createForm.name}
                onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Ground Floor"
                required
              />
            </label>
            <label className={styles.label}>Building
              <input
                className={styles.input}
                value={createForm.building}
                onChange={e => setCreateForm(f => ({ ...f, building: e.target.value }))}
                placeholder="e.g. Main"
                required
              />
            </label>
            <label className={styles.label}>Floor Number
              <input
                className={styles.input}
                type="number"
                value={createForm.floor_number}
                onChange={e => setCreateForm(f => ({ ...f, floor_number: e.target.value }))}
                placeholder="e.g. 1"
                required
              />
            </label>
          </div>
          {createError && <p className={styles.error}>{createError}</p>}
          <button className={styles.btnPrimary} type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create Floor'}
          </button>
        </form>
      )}

      {loading && <p className={styles.meta}>Loading floors…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && !error && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Building</th>
              <th>Floor #</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {floors.length === 0 && (
              <tr><td colSpan={4} className={styles.emptyCell}>No floors yet.</td></tr>
            )}
            {floors.map(floor => (
              <tr key={floor.id}>
                {editId === floor.id ? (
                  <td colSpan={3}>
                    <form className={styles.inlineForm} onSubmit={handleSaveEdit}>
                      <input
                        className={styles.input}
                        value={editForm.name}
                        onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                        required
                      />
                      <input
                        className={styles.input}
                        value={editForm.building}
                        onChange={e => setEditForm(f => ({ ...f, building: e.target.value }))}
                        required
                      />
                      <input
                        className={styles.input}
                        type="number"
                        value={editForm.floor_number}
                        onChange={e => setEditForm(f => ({ ...f, floor_number: e.target.value }))}
                        required
                      />
                      {editError && <span className={styles.error}>{editError}</span>}
                      <button className={styles.btnSmall} type="submit" disabled={saving}>
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button className={styles.btnSmallSecondary} type="button" onClick={() => setEditId(null)}>
                        Cancel
                      </button>
                    </form>
                  </td>
                ) : (
                  <>
                    <td>{floor.name}</td>
                    <td>{floor.building}</td>
                    <td>{floor.floor_number}</td>
                  </>
                )}
                {editId !== floor.id && (
                  <td className={styles.actions}>
                    <Link className={styles.btnSmall} to={`/admin/floors/${floor.id}/desks`}>
                      Desks
                    </Link>
                    <Link className={styles.btnSmall} to={`/admin/floors/${floor.id}/rooms`}>
                      Rooms
                    </Link>
                    <button className={styles.btnSmallSecondary} onClick={() => startEdit(floor)}>
                      Edit
                    </button>
                    <button className={styles.btnDanger} onClick={() => { setDeleteTarget(floor.id); setDeleteError(''); }}>
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {deleteTarget && (
        <div className={styles.overlay} onClick={() => !deleting && setDeleteTarget(null)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <h4 className={styles.dialogTitle}>Delete this floor?</h4>
            <p className={styles.dialogBody}>This will fail if the floor has active desks.</p>
            {deleteError && <p className={styles.error}>{deleteError}</p>}
            <div className={styles.dialogActions}>
              <button className={styles.btnSmallSecondary} onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancel
              </button>
              <button className={styles.btnDanger} onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
