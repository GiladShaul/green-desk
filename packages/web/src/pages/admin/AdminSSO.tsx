import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import styles from './Admin.module.css';

interface SsoConnection {
  id: string;
  name: string;
  provider_type: 'oidc' | 'saml';
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
}

type ProviderType = 'oidc' | 'saml';

const EMPTY_FORM = { name: '', provider_type: 'oidc' as ProviderType, config: '' };

export function AdminSSO() {
  const [connections, setConnections] = useState<SsoConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<SsoConnection[]>('/admin/sso-connections')
      .then(setConnections)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    let parsedConfig: unknown;
    try {
      parsedConfig = JSON.parse(form.config);
    } catch {
      setFormError('Config must be valid JSON');
      return;
    }
    setSaving(true);
    try {
      const created = await api.post<SsoConnection>('/admin/sso-connections', {
        name: form.name,
        provider_type: form.provider_type,
        config: parsedConfig,
      });
      setConnections(prev => [created, ...prev]);
      setForm(EMPTY_FORM);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(conn: SsoConnection) {
    try {
      const updated = await api.patch<SsoConnection>(`/admin/sso-connections/${conn.id}`, {
        enabled: !conn.enabled,
      });
      setConnections(prev => prev.map(c => c.id === conn.id ? updated : c));
    } catch {
      // surface via error state if needed
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this SSO connection? Users linked to it will lose SSO access.')) return;
    try {
      await api.delete(`/admin/sso-connections/${id}`);
      setConnections(prev => prev.filter(c => c.id !== id));
    } catch {
      // surface error
    }
  }

  return (
    <div>
      <div className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>SSO Connections</h2>
      </div>

      {loading && <p className={styles.meta}>Loading…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && (
        <>
          {connections.length === 0 && <p className={styles.meta}>No SSO connections configured.</p>}
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {connections.map(conn => (
                <tr key={conn.id}>
                  <td>{conn.name}</td>
                  <td>{conn.provider_type.toUpperCase()}</td>
                  <td>
                    <span className={`${styles.badge} ${conn.enabled ? styles.badgeAdmin : styles.badgeMember}`}>
                      {conn.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td>
                    <button className={styles.toggle} onClick={() => handleToggle(conn)}>
                      {conn.enabled ? 'Disable' : 'Enable'}
                    </button>
                    {' '}
                    <button className={styles.toggle} onClick={() => handleDelete(conn.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ marginTop: '2rem' }}>Add SSO Connection</h3>
          {formError && <p className={styles.error}>{formError}</p>}
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '480px' }}>
            <label>
              Name
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
              />
            </label>
            <label>
              Type
              <select
                value={form.provider_type}
                onChange={e => setForm(f => ({ ...f, provider_type: e.target.value as ProviderType }))}
              >
                <option value="oidc">OIDC</option>
                <option value="saml">SAML</option>
              </select>
            </label>
            <label>
              Config (JSON)
              <textarea
                rows={6}
                value={form.config}
                onChange={e => setForm(f => ({ ...f, config: e.target.value }))}
                placeholder={form.provider_type === 'oidc'
                  ? '{"issuer_url":"https://...","client_id":"...","client_secret":"...","allowed_domains":["corp.com"]}'
                  : '{"idp_sso_url":"https://...","idp_entity_id":"https://...","idp_certificate":"MIIC..."}'}
                required
                style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
              />
            </label>
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Add Connection'}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
