import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import styles from './Admin.module.css';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member' | 'viewer';
  status: 'active' | 'deactivated';
  created_at: string;
}

interface InviteResult {
  email: string;
  status: 'invited' | 'skipped';
  reason?: string;
  inviteUrl?: string;
}

function parseCsv(text: string): Array<{ email: string; role: string }> {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .slice(1) // skip header row
    .map(line => {
      const [email = '', role = ''] = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
      return { email, role };
    })
    .filter(r => r.email.includes('@'));
}

export function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [inviting, setInviting] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviteError, setInviteError] = useState('');

  const [showBulk, setShowBulk] = useState(false);
  const [bulkResults, setBulkResults] = useState<InviteResult[] | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);

  const [actionId, setActionId] = useState<string | null>(null);

  function loadUsers() {
    setLoading(true);
    const params: Record<string, string> = {};
    if (search) params.search = search;
    if (filterRole) params.role = filterRole;
    if (filterStatus) params.status = filterStatus;
    api.getWithParams<AdminUser[]>('/admin/users', params)
      .then(setUsers)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadUsers(); }, [search, filterRole, filterStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRoleChange(user: AdminUser, newRole: 'admin' | 'member' | 'viewer') {
    setActionId(user.id);
    try {
      const updated = await api.patch<AdminUser>(`/admin/users/${user.id}`, { role: newRole });
      setUsers(prev => prev.map(u => u.id === user.id ? updated : u));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update role');
    } finally {
      setActionId(null);
    }
  }

  async function handleStatusToggle(user: AdminUser) {
    const newStatus = user.status === 'active' ? 'deactivated' : 'active';
    setActionId(user.id);
    try {
      const updated = await api.patch<AdminUser>(`/admin/users/${user.id}`, { status: newStatus });
      setUsers(prev => prev.map(u => u.id === user.id ? updated : u));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update status');
    } finally {
      setActionId(null);
    }
  }

  async function handleInvite() {
    setInviteError('');
    setInviting(true);
    setInviteUrl('');
    try {
      const result = await api.post<{ inviteUrl: string }>('/admin/users/invite', { email: inviteEmail, role: inviteRole });
      setInviteUrl(result.inviteUrl);
      setInviteEmail('');
    } catch (e: unknown) {
      setInviteError(e instanceof Error ? e.message : 'Failed to send invitation');
    } finally {
      setInviting(false);
    }
  }

  async function handleBulkUpload() {
    const file = csvRef.current?.files?.[0];
    if (!file) return;
    setBulkPending(true);
    setBulkResults(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) {
        setBulkResults([{ email: '', status: 'skipped', reason: 'No valid rows found in CSV' }]);
        return;
      }
      const { results } = await api.post<{ results: InviteResult[] }>('/admin/users/bulk-invite', { rows });
      setBulkResults(results);
      loadUsers();
    } catch (e: unknown) {
      setBulkResults([{ email: '', status: 'skipped', reason: e instanceof Error ? e.message : 'Upload failed' }]);
    } finally {
      setBulkPending(false);
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return (
    <div>
      <div className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>Users</h2>
        <div className={styles.actions}>
          <button className={styles.btnSmallSecondary} onClick={() => { setShowBulk(true); setShowInvite(false); }}>
            Upload CSV
          </button>
          <button className={styles.btnPrimary} onClick={() => { setShowInvite(true); setShowBulk(false); setInviteUrl(''); setInviteError(''); }}>
            Invite User
          </button>
        </div>
      </div>

      {showInvite && (
        <div className={styles.form}>
          <p className={styles.formTitle}>Invite by email</p>
          {inviteUrl ? (
            <div>
              <p style={{ fontSize: '0.85rem', color: '#065f46', marginBottom: '0.5rem' }}>
                Invitation created. Share this link with the invitee:
              </p>
              <div className={styles.inlineForm}>
                <input className={styles.input} readOnly value={inviteUrl} style={{ flex: 1 }} />
                <button className={styles.btnSmall} onClick={() => navigator.clipboard.writeText(inviteUrl)}>Copy</button>
              </div>
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                <button className={styles.btnSmall} onClick={() => { setInviteUrl(''); }}>Invite another</button>
                <button className={styles.btnSmallSecondary} onClick={() => { setShowInvite(false); setInviteUrl(''); loadUsers(); }}>Done</button>
              </div>
            </div>
          ) : (
            <div>
              {inviteError && <p className={styles.error}>{inviteError}</p>}
              <div className={styles.formRow}>
                <label className={styles.label}>
                  Email
                  <input type="email" className={styles.input} value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="colleague@example.com" />
                </label>
                <label className={styles.label}>
                  Role
                  <select className={styles.input} value={inviteRole} onChange={e => setInviteRole(e.target.value as 'admin' | 'member' | 'viewer')}>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
              </div>
              <div className={styles.actions}>
                <button className={styles.btnPrimary} onClick={handleInvite} disabled={inviting || !inviteEmail}>
                  {inviting ? 'Creating…' : 'Create invite link'}
                </button>
                <button className={styles.btnSmallSecondary} onClick={() => setShowInvite(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {showBulk && (
        <div className={styles.form}>
          <p className={styles.formTitle}>Bulk invite via CSV</p>
          <p className={styles.meta} style={{ marginBottom: '0.75rem' }}>
            CSV format: <code>email,role</code> (header row required, role defaults to "member")
          </p>
          <div className={styles.inlineForm}>
            <input type="file" accept=".csv,text/csv" ref={csvRef} className={styles.input} style={{ width: 'auto', flex: 'none' }} />
            <button className={styles.btnPrimary} onClick={handleBulkUpload} disabled={bulkPending}>
              {bulkPending ? 'Uploading…' : 'Upload & Invite'}
            </button>
            <button className={styles.btnSmallSecondary} onClick={() => { setShowBulk(false); setBulkResults(null); }}>Cancel</button>
          </div>
          {bulkResults && (
            <div style={{ marginTop: '1rem' }}>
              <p className={styles.formTitle}>Results</p>
              <table className={styles.table}>
                <thead>
                  <tr><th>Email</th><th>Status</th><th>Detail</th></tr>
                </thead>
                <tbody>
                  {bulkResults.map((r, i) => (
                    <tr key={i}>
                      <td>{r.email}</td>
                      <td>
                        <span className={`${styles.badge} ${r.status === 'invited' ? styles.badgeActive : styles.badgeInactive}`}>
                          {r.status}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: '#6c757d' }}>
                        {r.status === 'invited' ? (
                          <span>
                            Link:{' '}
                            <a href={r.inviteUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.78rem' }}>
                              {r.inviteUrl?.slice(0, 60)}…
                            </a>
                          </span>
                        ) : r.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className={styles.form} style={{ marginBottom: '1rem' }}>
        <div className={styles.formRow}>
          <label className={styles.label}>
            Search
            <input className={styles.input} placeholder="Name or email…" value={search} onChange={e => setSearch(e.target.value)} />
          </label>
          <label className={styles.label}>
            Role
            <select className={styles.input} value={filterRole} onChange={e => setFilterRole(e.target.value)}>
              <option value="">All roles</option>
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <label className={styles.label}>
            Status
            <select className={styles.input} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="deactivated">Deactivated</option>
            </select>
          </label>
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}
      {loading && <p className={styles.meta}>Loading users…</p>}

      {!loading && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr><td colSpan={6} className={styles.emptyCell}>No users found.</td></tr>
            )}
            {users.map(user => (
              <tr key={user.id} style={user.status === 'deactivated' ? { opacity: 0.55 } : undefined}>
                <td>{user.name}</td>
                <td>{user.email}</td>
                <td>
                  <select
                    className={styles.toggle}
                    value={user.role}
                    disabled={actionId === user.id}
                    onChange={e => handleRoleChange(user, e.target.value as 'admin' | 'member' | 'viewer')}
                    style={{ cursor: 'pointer' }}
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </td>
                <td>
                  <span className={`${styles.badge} ${user.status === 'active' ? styles.badgeActive : styles.badgeInactive}`}>
                    {user.status}
                  </span>
                </td>
                <td>{formatDate(user.created_at)}</td>
                <td>
                  <button
                    className={user.status === 'active' ? styles.btnDanger : styles.btnSmall}
                    disabled={actionId === user.id}
                    onClick={() => handleStatusToggle(user)}
                  >
                    {actionId === user.id ? '…' : user.status === 'active' ? 'Deactivate' : 'Reactivate'}
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
