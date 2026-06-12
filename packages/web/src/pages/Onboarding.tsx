import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const STEPS = ['Your workspace', 'Invite your team', 'Settings'] as const;

const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Istanbul',
  'Asia/Dubai', 'Asia/Jerusalem', 'Asia/Kolkata', 'Asia/Tokyo', 'Asia/Singapore',
  'Australia/Sydney', 'Pacific/Auckland',
];

export function Onboarding() {
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Step 1 — floor + desks
  const [floorName, setFloorName] = useState('');
  const [building, setBuilding] = useState('Main');
  const [floorNumber, setFloorNumber] = useState('1');
  const [deskCount, setDeskCount] = useState('5');
  const [floorCreated, setFloorCreated] = useState(false);

  // Step 2 — invite team
  const [inviteEmails, setInviteEmails] = useState('');
  const [inviteResults, setInviteResults] = useState<Array<{ email: string; status: string; inviteUrl?: string }>>([]);

  // Step 3 — settings
  const [timezone, setTimezone] = useState('UTC');
  const [maxDaysAhead, setMaxDaysAhead] = useState('30');
  const [maxDailyBookings, setMaxDailyBookings] = useState('1');

  async function handleCreateFloor(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const floor = await api.post<{ id: string }>('/floors', {
        name: floorName,
        building,
        floor_number: parseInt(floorNumber, 10),
      });
      const count = Math.min(50, Math.max(1, parseInt(deskCount, 10) || 1));
      await Promise.all(
        Array.from({ length: count }, (_, i) =>
          api.post('/desks', {
            floor_id: floor.id,
            label: `Desk ${i + 1}`,
            x_position: (i % 5) * 120,
            y_position: Math.floor(i / 5) * 100,
          })
        )
      );
      setFloorCreated(true);
      setStep(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create floor');
    } finally {
      setSaving(false);
    }
  }

  async function handleInviteTeam(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const emails = inviteEmails
        .split(/[\n,;]+/)
        .map(s => s.trim().toLowerCase())
        .filter(s => s.includes('@'));

      if (emails.length === 0) {
        setStep(2);
        return;
      }

      const rows = emails.map(email => ({ email, role: 'member' }));
      const { results } = await api.post<{ results: Array<{ email: string; status: string; inviteUrl?: string }> }>(
        '/admin/users/bulk-invite',
        { rows }
      );
      setInviteResults(results);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invitations');
    } finally {
      setSaving(false);
    }
  }

  function skipInvite() {
    setStep(2);
  }

  async function handleSettings(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.patch('/admin/tenant', {
        timezone,
        booking_rules: {
          maxDaysAhead: parseInt(maxDaysAhead, 10),
          maxDailyBookings: parseInt(maxDailyBookings, 10),
        },
        onboarding_completed: true,
      });
      await refreshUser();
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f9', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '3rem' }}>
      <div style={{ width: '100%', maxWidth: '520px', padding: '0 1rem' }}>
        {/* Progress bar */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
          {STEPS.map((label, i) => (
            <div key={i} style={{ flex: 1 }}>
              <div style={{
                height: '4px',
                borderRadius: '2px',
                background: i <= step ? '#1a1a2e' : '#dee2e6',
                marginBottom: '0.35rem',
              }} />
              <p style={{ fontSize: '0.75rem', color: i === step ? '#1a1a2e' : '#6c757d', fontWeight: i === step ? 600 : 400, margin: 0 }}>
                {label}
              </p>
            </div>
          ))}
        </div>

        <div style={{ background: '#fff', borderRadius: '10px', boxShadow: '0 2px 12px rgba(0,0,0,.09)', padding: '2rem' }}>
          {error && (
            <div style={{ background: '#fee2e2', color: '#b91c1c', borderRadius: '4px', padding: '0.5rem 0.75rem', fontSize: '0.875rem', marginBottom: '1rem' }}>
              {error}
            </div>
          )}

          {/* Step 0 — Create floor */}
          {step === 0 && (
            <form onSubmit={handleCreateFloor}>
              <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#1a1a2e', margin: '0 0 0.5rem' }}>
                Set up your first floor
              </h2>
              <p style={{ color: '#6c757d', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                Add a floor so your team can book desks.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.875rem', fontWeight: 500 }}>
                  Floor name *
                  <input
                    type="text"
                    required
                    autoFocus
                    value={floorName}
                    onChange={e => setFloorName(e.target.value)}
                    placeholder="e.g. Ground Floor"
                    style={{ padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.95rem' }}
                  />
                </label>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.875rem', fontWeight: 500, flex: 1 }}>
                    Building
                    <input
                      type="text"
                      value={building}
                      onChange={e => setBuilding(e.target.value)}
                      placeholder="Main"
                      style={{ padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.95rem' }}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.875rem', fontWeight: 500, width: '100px' }}>
                    Floor #
                    <input
                      type="number"
                      min="0"
                      value={floorNumber}
                      onChange={e => setFloorNumber(e.target.value)}
                      style={{ padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.95rem' }}
                    />
                  </label>
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.875rem', fontWeight: 500 }}>
                  Number of desks to create
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={deskCount}
                    onChange={e => setDeskCount(e.target.value)}
                    style={{ padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.95rem', width: '100px' }}
                  />
                </label>
                <button
                  type="submit"
                  disabled={saving}
                  style={{ padding: '0.65rem', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '0.95rem', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
                >
                  {saving ? 'Creating…' : 'Create floor & desks →'}
                </button>
              </div>
            </form>
          )}

          {/* Step 1 — Invite team */}
          {step === 1 && (
            <form onSubmit={handleInviteTeam}>
              <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#1a1a2e', margin: '0 0 0.5rem' }}>
                Invite your team
              </h2>
              <p style={{ color: '#6c757d', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                Add colleagues' email addresses (one per line, or comma-separated). They'll receive an invitation link.
              </p>
              {floorCreated && (
                <div style={{ background: '#d1fae5', color: '#065f46', borderRadius: '4px', padding: '0.5rem 0.75rem', fontSize: '0.875rem', marginBottom: '1rem' }}>
                  Floor created successfully!
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.875rem', fontWeight: 500 }}>
                  Email addresses
                  <textarea
                    value={inviteEmails}
                    onChange={e => setInviteEmails(e.target.value)}
                    rows={4}
                    placeholder={"alice@company.com\nbob@company.com"}
                    style={{ padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.9rem', resize: 'vertical' }}
                  />
                </label>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button
                    type="submit"
                    disabled={saving}
                    style={{ flex: 1, padding: '0.65rem', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '0.95rem', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
                  >
                    {saving ? 'Sending…' : 'Send invitations →'}
                  </button>
                  <button
                    type="button"
                    onClick={skipInvite}
                    style={{ padding: '0.65rem 1rem', background: 'transparent', color: '#6c757d', border: '1px solid #ced4da', borderRadius: '6px', fontSize: '0.9rem', cursor: 'pointer' }}
                  >
                    Skip
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Step 2 — Settings */}
          {step === 2 && (
            <form onSubmit={handleSettings}>
              <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#1a1a2e', margin: '0 0 0.5rem' }}>
                Configure your workspace
              </h2>
              <p style={{ color: '#6c757d', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                These settings can be changed later in Admin → Settings.
              </p>
              {inviteResults.length > 0 && (
                <div style={{ background: '#d1fae5', color: '#065f46', borderRadius: '4px', padding: '0.5rem 0.75rem', fontSize: '0.875rem', marginBottom: '1rem' }}>
                  {inviteResults.filter(r => r.status === 'invited').length} invitation(s) sent.
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.875rem', fontWeight: 500 }}>
                  Timezone
                  <select
                    value={timezone}
                    onChange={e => setTimezone(e.target.value)}
                    style={{ padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.95rem' }}
                  >
                    {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.875rem', fontWeight: 500 }}>
                  Max days ahead a booking can be made
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={maxDaysAhead}
                    onChange={e => setMaxDaysAhead(e.target.value)}
                    style={{ padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.95rem', width: '120px' }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.875rem', fontWeight: 500 }}>
                  Max daily bookings per user
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={maxDailyBookings}
                    onChange={e => setMaxDailyBookings(e.target.value)}
                    style={{ padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.95rem', width: '120px' }}
                  />
                </label>
                <button
                  type="submit"
                  disabled={saving}
                  style={{ padding: '0.65rem', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '0.95rem', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
                >
                  {saving ? 'Saving…' : 'Finish setup →'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
