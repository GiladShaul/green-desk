import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import styles from './Admin.module.css';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  created_at: string;
}

export function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    api.get<AdminUser[]>('/admin/users')
      .then(setUsers)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleToggleRole(user: AdminUser) {
    setTogglingId(user.id);
    try {
      const newRole = user.role === 'admin' ? 'member' : 'admin';
      const updated = await api.patch<AdminUser>(`/admin/users/${user.id}`, { role: newRole });
      setUsers(prev => prev.map(u => u.id === user.id ? updated : u));
    } catch {
      // could surface a toast
    } finally {
      setTogglingId(null);
    }
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  }

  return (
    <div>
      <div className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>Users</h2>
      </div>

      {loading && <p className={styles.meta}>Loading users…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && !error && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr><td colSpan={5} className={styles.emptyCell}>No users found.</td></tr>
            )}
            {users.map(user => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td>{user.email}</td>
                <td>
                  <span className={`${styles.badge} ${user.role === 'admin' ? styles.badgeAdmin : styles.badgeMember}`}>
                    {user.role}
                  </span>
                </td>
                <td>{formatDate(user.created_at)}</td>
                <td>
                  <button
                    className={styles.toggle}
                    onClick={() => handleToggleRole(user)}
                    disabled={togglingId === user.id}
                  >
                    {togglingId === user.id
                      ? 'Saving…'
                      : user.role === 'admin' ? 'Make Member' : 'Make Admin'}
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
