import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import styles from './Admin.module.css';

type Provider = 'slack' | 'teams';
type EventKey = 'booking_confirmed' | 'booking_cancelled' | 'booking_reminder';

const ALL_EVENTS: { key: EventKey; label: string }[] = [
  { key: 'booking_confirmed', label: 'Booking confirmed' },
  { key: 'booking_cancelled', label: 'Booking cancelled' },
  { key: 'booking_reminder', label: 'Booking reminder (30 min before)' },
];

interface Integration {
  id: string;
  name: string;
  provider: Provider;
  webhook_url: string;
  events: EventKey[];
  enabled: boolean;
  created_at: string;
}

const EMPTY_FORM = {
  name: '',
  provider: 'slack' as Provider,
  webhook_url: '',
  events: ['booking_confirmed', 'booking_cancelled', 'booking_reminder'] as EventKey[],
};

export function AdminIntegrations() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<Integration[]>('/admin/integrations')
      .then(setIntegrations)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function toggleFormEvent(key: EventKey) {
    setForm(prev => ({
      ...prev,
      events: prev.events.includes(key)
        ? prev.events.filter(e => e !== key)
        : [...prev.events, key],
    }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) { setFormError('Name is required'); return; }
    if (!form.webhook_url.trim()) { setFormError('Webhook URL is required'); return; }
    if (form.events.length === 0) { setFormError('Select at least one event'); return; }
    setSaving(true);
    try {
      const created = await api.post<Integration>('/admin/integrations', {
        name: form.name,
        provider: form.provider,
        webhook_url: form.webhook_url,
        events: form.events,
      });
      setIntegrations(prev => [created, ...prev]);
      setForm(EMPTY_FORM);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(integration: Integration) {
    try {
      const updated = await api.patch<Integration>(`/admin/integrations/${integration.id}`, {
        enabled: !integration.enabled,
      });
      setIntegrations(prev => prev.map(i => i.id === integration.id ? updated : i));
    } catch {
      // ignore
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this integration? Notifications will stop being sent to this webhook.')) return;
    try {
      await api.delete(`/admin/integrations/${id}`);
      setIntegrations(prev => prev.filter(i => i.id !== id));
    } catch {
      // ignore
    }
  }

  return (
    <div>
      <div className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>Webhook Integrations</h2>
      </div>

      {loading && <p className={styles.meta}>Loading…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && (
        <>
          <form onSubmit={handleCreate} className={styles.form}>
            <p className={styles.formTitle}>Add Integration</p>
            <div className={styles.formRow}>
              <label className={styles.label}>
                Name
                <input
                  className={styles.input}
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. #bookings-channel"
                />
              </label>
              <label className={styles.label}>
                Provider
                <select
                  className={styles.input}
                  value={form.provider}
                  onChange={e => setForm(p => ({ ...p, provider: e.target.value as Provider }))}
                >
                  <option value="slack">Slack</option>
                  <option value="teams">Microsoft Teams</option>
                </select>
              </label>
            </div>
            <div className={styles.formRow}>
              <label className={styles.label} style={{ flex: 2 }}>
                Webhook URL
                <input
                  className={styles.input}
                  value={form.webhook_url}
                  onChange={e => setForm(p => ({ ...p, webhook_url: e.target.value }))}
                  placeholder="https://hooks.slack.com/…"
                />
              </label>
            </div>
            <div className={styles.formRow} style={{ flexDirection: 'column', gap: '0.4rem' }}>
              <span className={styles.label}>Events</span>
              {ALL_EVENTS.map(ev => (
                <label key={ev.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.events.includes(ev.key)}
                    onChange={() => toggleFormEvent(ev.key)}
                  />
                  {ev.label}
                </label>
              ))}
            </div>
            {formError && <p className={styles.error}>{formError}</p>}
            <button className={styles.btnPrimary} type="submit" disabled={saving}>
              {saving ? 'Adding…' : 'Add Integration'}
            </button>
          </form>

          {integrations.length === 0 && <p className={styles.meta}>No integrations configured.</p>}

          {integrations.length > 0 && (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Provider</th>
                  <th>Events</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {integrations.map(i => (
                  <tr key={i.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{i.name}</div>
                      <div style={{ fontSize: '0.78rem', color: '#6c757d', wordBreak: 'break-all' }}>
                        {i.webhook_url.length > 60 ? `${i.webhook_url.slice(0, 57)}…` : i.webhook_url}
                      </div>
                    </td>
                    <td style={{ textTransform: 'capitalize' }}>{i.provider}</td>
                    <td>
                      <div style={{ fontSize: '0.8rem', lineHeight: 1.6 }}>
                        {(Array.isArray(i.events) ? i.events : []).map(ev => (
                          <div key={ev}>{ALL_EVENTS.find(e => e.key === ev)?.label ?? ev}</div>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span style={{
                        fontSize: '0.78rem',
                        padding: '0.2rem 0.5rem',
                        borderRadius: 12,
                        background: i.enabled ? '#d1fae5' : '#f3f4f6',
                        color: i.enabled ? '#065f46' : '#6b7280',
                        fontWeight: 500,
                      }}>
                        {i.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td>
                      <div className={styles.actions}>
                        <button
                          className={styles.btnSmall}
                          onClick={() => handleToggle(i)}
                        >
                          {i.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          className={`${styles.btnSmall} ${styles.btnDanger}`}
                          onClick={() => handleDelete(i.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
