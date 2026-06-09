import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import styles from './Admin.module.css';

const ALL_SCOPES = [
  { key: 'read:bookings',  label: 'Read bookings' },
  { key: 'write:bookings', label: 'Write bookings (create / cancel)' },
  { key: 'read:floors',    label: 'Read floors' },
  { key: 'read:desks',     label: 'Read desks' },
  { key: 'read:rooms',     label: 'Read meeting rooms' },
  { key: 'read:analytics', label: 'Read analytics' },
  { key: 'read:users',     label: 'Read users' },
] as const;

type Scope = typeof ALL_SCOPES[number]['key'];

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: Scope[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  status: 'active' | 'revoked' | 'expired';
}

const EMPTY_FORM = {
  name: '',
  scopes: [] as Scope[],
  expires_at: '',
};

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function AdminApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get<ApiKey[]>('/admin/api-keys')
      .then(setKeys)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function toggleScope(scope: Scope) {
    setForm(prev => ({
      ...prev,
      scopes: prev.scopes.includes(scope)
        ? prev.scopes.filter(s => s !== scope)
        : [...prev.scopes, scope],
    }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) { setFormError('Name is required'); return; }
    if (form.scopes.length === 0) { setFormError('Select at least one scope'); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { name: form.name, scopes: form.scopes };
      if (form.expires_at) body.expires_at = new Date(form.expires_at).toISOString();
      const created = await api.post<ApiKey & { key: string }>('/admin/api-keys', body);
      setNewKey(created.key);
      setKeys(prev => [{ ...created, status: 'active' }, ...prev]);
      setForm(EMPTY_FORM);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create');
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm('Revoke this API key? Any integration using it will immediately lose access.')) return;
    try {
      await api.delete(`/admin/api-keys/${id}`);
      setKeys(prev => prev.map(k => k.id === id ? { ...k, status: 'revoked', revoked_at: new Date().toISOString() } : k));
    } catch {
      // ignore — could add a toast here
    }
  }

  function copyKey() {
    if (!newKey) return;
    navigator.clipboard.writeText(newKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div>
      <div className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>API Keys</h2>
      </div>
      <p className={styles.subheading}>
        Create API keys so third-party systems can integrate with Green Desk.{' '}
        <a href="/api/docs" target="_blank" rel="noreferrer" style={{ color: '#4ade80' }}>
          View API docs →
        </a>
      </p>

      {loading && <p className={styles.meta}>Loading…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && (
        <>
          {/* Create form */}
          <form onSubmit={handleCreate} className={styles.form}>
            <p className={styles.formTitle}>Create API Key</p>
            <div className={styles.formRow}>
              <label className={styles.label}>
                Name
                <input
                  className={styles.input}
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. HRIS Integration"
                />
              </label>
              <label className={styles.label}>
                Expires (optional)
                <input
                  className={styles.input}
                  type="date"
                  value={form.expires_at}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={e => setForm(p => ({ ...p, expires_at: e.target.value }))}
                />
              </label>
            </div>
            <div className={styles.formRow} style={{ flexDirection: 'column', gap: '0.4rem' }}>
              <span className={styles.label}>Scopes</span>
              {ALL_SCOPES.map(s => (
                <label key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.scopes.includes(s.key)}
                    onChange={() => toggleScope(s.key)}
                  />
                  <code style={{ fontSize: '0.8rem' }}>{s.key}</code> — {s.label}
                </label>
              ))}
            </div>
            {formError && <p className={styles.error}>{formError}</p>}
            <button className={styles.btnPrimary} type="submit" disabled={saving}>
              {saving ? 'Creating…' : 'Create API Key'}
            </button>
          </form>

          {/* Key list */}
          {keys.length === 0 && <p className={styles.meta}>No API keys yet.</p>}

          {keys.length > 0 && (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Prefix</th>
                  <th>Scopes</th>
                  <th>Last used</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map(k => (
                  <tr key={k.id}>
                    <td style={{ fontWeight: 500 }}>{k.name}</td>
                    <td><code style={{ fontSize: '0.82rem' }}>{k.key_prefix}…</code></td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                        {(Array.isArray(k.scopes) ? k.scopes : []).map(s => (
                          <span key={s} style={{ background: '#1e1b4b', color: '#a5b4fc', fontSize: '0.72rem', padding: '0.15rem 0.4rem', borderRadius: 10 }}>
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{fmt(k.last_used_at)}</td>
                    <td style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{fmt(k.expires_at)}</td>
                    <td>
                      <span className={`${styles.badge} ${k.status === 'active' ? styles.badgeActive : styles.badgeInactive}`}>
                        {k.status}
                      </span>
                    </td>
                    <td>
                      {k.status === 'active' && (
                        <button
                          className={`${styles.btnSmall} ${styles.btnDanger}`}
                          onClick={() => handleRevoke(k.id)}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {/* Show-once modal */}
      {newKey && (
        <div className={styles.overlay} onClick={() => setNewKey(null)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <h3 className={styles.dialogTitle}>API Key Created</h3>
            <p className={styles.dialogBody}>
              Copy this key now — it will not be shown again.
            </p>
            <pre style={{
              background: '#0f172a', border: '1px solid #334155', borderRadius: 6,
              padding: '0.75rem 1rem', marginBottom: '1rem',
              fontSize: '0.8rem', wordBreak: 'break-all', color: '#4ade80',
              whiteSpace: 'pre-wrap',
            }}>
              {newKey}
            </pre>
            <div className={styles.dialogActions}>
              <button className={styles.btnSmallSecondary} onClick={copyKey}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button className={styles.btnPrimary} onClick={() => setNewKey(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
