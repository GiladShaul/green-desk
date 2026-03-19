import { useEffect, useState } from 'react';
import { api } from '../../api/client';

interface BillingStatus {
  plan: string;
  seatsUsed: number;
  seatsLimit: number | null;
  floorsLimit: number | null;
  subscriptionStatus: string;
  currentPeriodEnd: string | null;
  billingEmail: string | null;
}

export function AdminBilling() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    api.get<BillingStatus>('/billing/status')
      .then(setStatus)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleUpgrade(planId: 'starter' | 'pro') {
    setActionLoading(true);
    try {
      const { url } = await api.post<{ url: string }>('/billing/checkout', { planId });
      window.location.href = url;
    } catch (e) {
      setError((e as Error).message);
      setActionLoading(false);
    }
  }

  async function handleManage() {
    setActionLoading(true);
    try {
      const { url } = await api.post<{ url: string }>('/billing/portal', {});
      window.location.href = url;
    } catch (e) {
      setError((e as Error).message);
      setActionLoading(false);
    }
  }

  if (loading) return <p>Loading billing info…</p>;
  if (error) return <p style={{ color: 'red' }}>{error}</p>;
  if (!status) return null;

  const isNearLimit = status.seatsLimit !== null && status.seatsUsed >= status.seatsLimit - 1;

  return (
    <div style={{ maxWidth: 600 }}>
      <h1>Billing</h1>

      {isNearLimit && (
        <div style={{
          background: '#fff3cd',
          border: '1px solid #ffc107',
          borderRadius: 6,
          padding: '10px 16px',
          marginBottom: 20,
        }}>
          {status.seatsLimit !== null
            ? `${status.seatsUsed}/${status.seatsLimit} seats used — upgrade to add more users`
            : `${status.seatsUsed} seats used`}
        </div>
      )}

      <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 24 }}>
        <tbody>
          <tr>
            <td style={{ padding: '8px 0', fontWeight: 600, width: 180 }}>Plan</td>
            <td style={{ textTransform: 'capitalize' }}>{status.plan}</td>
          </tr>
          <tr>
            <td style={{ padding: '8px 0', fontWeight: 600 }}>Seats used</td>
            <td>
              {status.seatsUsed}
              {status.seatsLimit !== null ? ` / ${status.seatsLimit}` : ' (unlimited)'}
            </td>
          </tr>
          <tr>
            <td style={{ padding: '8px 0', fontWeight: 600 }}>Floors limit</td>
            <td>{status.floorsLimit !== null ? status.floorsLimit : 'Unlimited'}</td>
          </tr>
          <tr>
            <td style={{ padding: '8px 0', fontWeight: 600 }}>Subscription</td>
            <td style={{ textTransform: 'capitalize' }}>{status.subscriptionStatus}</td>
          </tr>
          {status.currentPeriodEnd && (
            <tr>
              <td style={{ padding: '8px 0', fontWeight: 600 }}>Next billing date</td>
              <td>{new Date(status.currentPeriodEnd).toLocaleDateString()}</td>
            </tr>
          )}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {status.plan === 'free' && (
          <>
            <button
              onClick={() => handleUpgrade('starter')}
              disabled={actionLoading}
              style={{ padding: '10px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
            >
              Upgrade to Starter
            </button>
            <button
              onClick={() => handleUpgrade('pro')}
              disabled={actionLoading}
              style={{ padding: '10px 20px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
            >
              Upgrade to Pro
            </button>
          </>
        )}
        {status.plan !== 'free' && (
          <button
            onClick={handleManage}
            disabled={actionLoading}
            style={{ padding: '10px 20px', background: '#6b7280', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
          >
            Manage Subscription
          </button>
        )}
      </div>
    </div>
  );
}
