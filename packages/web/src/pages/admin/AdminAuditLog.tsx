import { useEffect, useState, useCallback } from 'react';
import { api } from '../../api/client';
import styles from './AdminAuditLog.module.css';

interface AuditLog {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  changes: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

interface AuditLogsResponse {
  logs: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

const RESOURCE_TYPES = [
  'booking', 'desk', 'floor', 'room', 'user', 'team_booking',
  'sso_connection', 'integration', 'billing', 'room_booking', 'recurring_booking',
];
const ACTIONS = ['create', 'update', 'delete', 'login', 'logout', 'login_failed'];

const PAGE_SIZE = 50;

function formatTs(ts: string): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function actionBadgeClass(action: string): string {
  switch (action) {
    case 'create': return styles.badgeCreate;
    case 'update': return styles.badgeUpdate;
    case 'delete': return styles.badgeDelete;
    case 'login': return styles.badgeLogin;
    case 'login_failed': return styles.badgeFailed;
    default: return styles.badgeDefault;
  }
}

function buildQueryString(params: Record<string, string>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) q.set(k, v);
  }
  return q.toString() ? `?${q.toString()}` : '';
}

function exportCsv(logs: AuditLog[]): void {
  const header = ['Timestamp', 'Actor', 'Action', 'Resource Type', 'Resource ID', 'IP Address', 'Changes'];
  const rows = logs.map(l => [
    l.created_at,
    l.actor_email ?? l.actor_id ?? '',
    l.action,
    l.resource_type,
    l.resource_id ?? '',
    l.ip_address ?? '',
    l.changes ? JSON.stringify(l.changes) : '',
  ]);
  const csv = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function AdminAuditLog() {
  const [data, setData] = useState<AuditLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [actor, setActor] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [action, setAction] = useState('');

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const qs = buildQueryString({ page: String(page), pageSize: String(PAGE_SIZE), from, to, actor, resourceType, action });
    api.get<AuditLogsResponse>(`/admin/audit-logs${qs}`)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, from, to, actor, resourceType, action]);

  useEffect(() => { load(); }, [load]);

  function applyFilters() {
    setPage(1);
    load();
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div>
      <div className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>Audit Log</h2>
        {data && data.logs.length > 0 && (
          <button className={styles.exportBtn} onClick={() => exportCsv(data.logs)}>
            Export CSV
          </button>
        )}
      </div>

      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>From</label>
          <input
            type="datetime-local"
            className={styles.filterInput}
            value={from}
            onChange={e => setFrom(e.target.value)}
          />
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>To</label>
          <input
            type="datetime-local"
            className={styles.filterInput}
            value={to}
            onChange={e => setTo(e.target.value)}
          />
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Actor email</label>
          <input
            type="text"
            className={styles.filterInput}
            placeholder="user@example.com"
            value={actor}
            onChange={e => setActor(e.target.value)}
          />
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Resource type</label>
          <select className={styles.filterInput} value={resourceType} onChange={e => setResourceType(e.target.value)}>
            <option value="">All</option>
            {RESOURCE_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Action</label>
          <select className={styles.filterInput} value={action} onChange={e => setAction(e.target.value)}>
            <option value="">All</option>
            {ACTIONS.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <button className={styles.applyBtn} onClick={applyFilters}>Apply</button>
      </div>

      {loading && <p className={styles.meta}>Loading…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && !error && data && (
        <>
          <p className={styles.meta}>{data.total.toLocaleString()} event{data.total !== 1 ? 's' : ''}</p>

          {data.logs.length === 0 ? (
            <p className={styles.meta}>No audit events match the current filters.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>Resource ID</th>
                  <th>IP</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map(log => (
                  <>
                    <tr
                      key={log.id}
                      className={expandedId === log.id ? styles.rowExpanded : styles.row}
                      onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                    >
                      <td className={styles.ts}>{formatTs(log.created_at)}</td>
                      <td className={styles.actor}>{log.actor_email ?? log.actor_id ?? '—'}</td>
                      <td>
                        <span className={`${styles.badge} ${actionBadgeClass(log.action)}`}>
                          {log.action}
                        </span>
                      </td>
                      <td>{log.resource_type}</td>
                      <td className={styles.resourceId}>{log.resource_id ? log.resource_id.slice(0, 8) + '…' : '—'}</td>
                      <td>{log.ip_address ?? '—'}</td>
                      <td>{log.changes ? '▸ view' : '—'}</td>
                    </tr>
                    {expandedId === log.id && (
                      <tr key={`${log.id}-detail`} className={styles.detailRow}>
                        <td colSpan={7}>
                          <div className={styles.detail}>
                            <div><strong>ID:</strong> {log.id}</div>
                            {log.resource_id && <div><strong>Resource ID:</strong> {log.resource_id}</div>}
                            {log.user_agent && <div><strong>User-Agent:</strong> {log.user_agent}</div>}
                            {log.changes && (
                              <div>
                                <strong>Changes:</strong>
                                <pre className={styles.pre}>{JSON.stringify(log.changes, null, 2)}</pre>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          )}

          {totalPages > 1 && (
            <div className={styles.pagination}>
              <button
                className={styles.pageBtn}
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >
                ← Prev
              </button>
              <span className={styles.pageInfo}>Page {page} of {totalPages}</span>
              <button
                className={styles.pageBtn}
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
