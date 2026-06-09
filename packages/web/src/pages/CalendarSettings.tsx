import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import styles from './CalendarSettings.module.css';

interface CalendarConnection {
  id: string;
  provider: 'google' | 'microsoft';
  calendar_id: string | null;
  connected_at: string;
  revoked_at: string | null;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

function statusOf(conn: CalendarConnection | undefined): 'connected' | 'expired' | 'disconnected' {
  if (!conn) return 'disconnected';
  if (conn.revoked_at) return 'expired';
  return 'connected';
}

export function CalendarSettings() {
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const connectedParam = searchParams.get('connected');
  const errorParam = searchParams.get('error');

  useEffect(() => {
    if (connectedParam || errorParam) {
      // Clear query params from URL after reading them
      setSearchParams({}, { replace: true });
    }
  }, [connectedParam, errorParam, setSearchParams]);

  useEffect(() => {
    api.get<CalendarConnection[]>('/calendar/connections')
      .then(setConnections)
      .catch(() => setConnections([]))
      .finally(() => setLoading(false));
  }, []);

  const google = connections.find(c => c.provider === 'google');
  const microsoft = connections.find(c => c.provider === 'microsoft');

  async function disconnect(conn: CalendarConnection) {
    if (!confirm(`Disconnect ${conn.provider === 'google' ? 'Google Calendar' : 'Outlook'}? Future bookings will not sync.`)) return;
    setDisconnecting(conn.id);
    try {
      await api.delete(`/calendar/connections/${conn.id}`);
      setConnections(prev => prev.filter(c => c.id !== conn.id));
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setDisconnecting(null);
    }
  }

  function connectGoogle() {
    // Redirect through backend — backend redirects to Google consent
    window.location.href = `${API_BASE}/calendar/google/connect`;
  }

  function connectMicrosoft() {
    window.location.href = `${API_BASE}/calendar/microsoft/connect`;
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Connected Calendars</h1>
      <p className={styles.subtitle}>
        Connect your calendar so desk bookings appear automatically alongside your meetings.
      </p>

      {connectedParam && (
        <div className={`${styles.alert} ${styles.alertSuccess}`}>
          {connectedParam === 'google' ? 'Google Calendar' : 'Outlook'} connected successfully.
        </div>
      )}
      {errorParam && (
        <div className={`${styles.alert} ${styles.alertError}`}>
          Could not connect calendar: {decodeURIComponent(errorParam)}
        </div>
      )}

      {loading ? (
        <p className={styles.loading}>Loading…</p>
      ) : (
        <>
          {/* Google Calendar card */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={`${styles.providerIcon} ${styles.googleIcon}`}>G</div>
              <span className={styles.providerName}>Google Calendar</span>
            </div>
            <div className={styles.statusRow}>
              <StatusBadge status={statusOf(google)} />
              <div className={styles.actions}>
                {!google || google.revoked_at ? (
                  <button className={styles.connectBtn} onClick={connectGoogle}>
                    Connect
                  </button>
                ) : (
                  <>
                    <button className={styles.connectBtn} onClick={connectGoogle}>
                      Reconnect
                    </button>
                    <button
                      className={styles.disconnectBtn}
                      disabled={disconnecting === google.id}
                      onClick={() => disconnect(google)}
                    >
                      {disconnecting === google.id ? 'Disconnecting…' : 'Disconnect'}
                    </button>
                  </>
                )}
              </div>
            </div>
            {google && !google.revoked_at && (
              <p className={styles.connectedAt}>
                Connected {new Date(google.connected_at).toLocaleDateString()}
              </p>
            )}
          </div>

          {/* Outlook / Microsoft 365 card */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={`${styles.providerIcon} ${styles.microsoftIcon}`}>M</div>
              <span className={styles.providerName}>Outlook / Microsoft 365</span>
            </div>
            <div className={styles.statusRow}>
              <StatusBadge status={statusOf(microsoft)} />
              <div className={styles.actions}>
                {!microsoft || microsoft.revoked_at ? (
                  <button className={styles.connectBtn} onClick={connectMicrosoft}>
                    Connect
                  </button>
                ) : (
                  <>
                    <button className={styles.connectBtn} onClick={connectMicrosoft}>
                      Reconnect
                    </button>
                    <button
                      className={styles.disconnectBtn}
                      disabled={disconnecting === microsoft.id}
                      onClick={() => disconnect(microsoft)}
                    >
                      {disconnecting === microsoft.id ? 'Disconnecting…' : 'Disconnect'}
                    </button>
                  </>
                )}
              </div>
            </div>
            {microsoft && !microsoft.revoked_at && (
              <p className={styles.connectedAt}>
                Connected {new Date(microsoft.connected_at).toLocaleDateString()}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: 'connected' | 'expired' | 'disconnected' }) {
  const label = status === 'connected' ? '● Connected'
    : status === 'expired' ? '⚠ Expired'
    : '○ Not connected';
  const cls = status === 'connected' ? styles.connected
    : status === 'expired' ? styles.expired
    : styles.disconnected;
  return <span className={`${styles.statusBadge} ${cls}`}>{label}</span>;
}
