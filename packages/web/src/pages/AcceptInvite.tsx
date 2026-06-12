import { useEffect, useState, FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import styles from './Auth.module.css';

interface InviteInfo {
  email: string;
  role: string;
  tenantName: string;
}

export function AcceptInvite() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const { acceptInvite } = useAuth();
  const navigate = useNavigate();

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError('Invalid invitation link.');
      return;
    }
    api.get<InviteInfo>(`/auth/invite/${token}`)
      .then(setInvite)
      .catch((e: Error) => setLoadError(e.message));
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError('');
    setLoading(true);
    try {
      await acceptInvite(token, name, password);
      navigate('/dashboard');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  if (loadError) {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <h1 className={styles.title}>Invalid invitation</h1>
          <p className={styles.error}>{loadError}</p>
        </div>
      </div>
    );
  }

  if (!invite) {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <p style={{ textAlign: 'center', color: '#6c757d' }}>Loading invitation…</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Join {invite.tenantName}</h1>
        <p className={styles.footer} style={{ marginBottom: '1.25rem', color: '#6c757d' }}>
          You've been invited as a <strong>{invite.role}</strong>. Create your account to get started.
        </p>
        {submitError && <p className={styles.error}>{submitError}</p>}
        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Email
            <input type="email" className={styles.input} value={invite.email} disabled />
          </label>
          <label className={styles.label}>
            Your name
            <input
              type="text"
              className={styles.input}
              value={name}
              onChange={e => setName(e.target.value)}
              required
              autoFocus
              placeholder="Full name"
            />
          </label>
          <label className={styles.label}>
            Password
            <input
              type="password"
              className={styles.input}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={8}
              placeholder="At least 8 characters"
            />
          </label>
          <button type="submit" className={styles.btn} disabled={loading}>
            {loading ? 'Creating account…' : 'Accept invitation'}
          </button>
        </form>
      </div>
    </div>
  );
}
