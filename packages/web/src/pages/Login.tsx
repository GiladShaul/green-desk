import { useState, useEffect, FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import styles from './Auth.module.css';

interface SsoConnection {
  id: string;
  name: string;
  provider_type: string;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(searchParams.get('error') ?? '');
  const [loading, setLoading] = useState(false);
  const [ssoConnections, setSsoConnections] = useState<SsoConnection[]>([]);

  useEffect(() => {
    api.get<SsoConnection[]>('/auth/sso/connections')
      .then(setSsoConnections)
      .catch(() => { /* non-critical */ });
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  function handleSsoLogin(connectionId: string) {
    window.location.href = `${API_BASE}/auth/sso/${connectionId}/login`;
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Sign in to Green Desk</h1>
        {error && <p className={styles.error}>{error}</p>}
        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Email
            <input type="email" className={styles.input} value={email}
              onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <label className={styles.label}>
            Password
            <input type="password" className={styles.input} value={password}
              onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button type="submit" className={styles.btn} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {ssoConnections.length > 0 && (
          <>
            <p className={styles.divider}>or</p>
            {ssoConnections.map((conn) => (
              <button
                key={conn.id}
                className={styles.btnSecondary}
                onClick={() => handleSsoLogin(conn.id)}
              >
                Sign in with {conn.name}
              </button>
            ))}
          </>
        )}

        <p className={styles.footer}>
          No account? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  );
}
