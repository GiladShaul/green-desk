import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function SsoCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshUser } = useAuth();

  useEffect(() => {
    const token = searchParams.get('token');
    const error = searchParams.get('error');

    if (error) {
      navigate(`/login?error=${encodeURIComponent(error)}`, { replace: true });
      return;
    }
    if (!token) {
      navigate('/login', { replace: true });
      return;
    }

    localStorage.setItem('token', token);
    refreshUser().then(() => navigate('/dashboard', { replace: true }));
  }, []);

  return <p style={{ padding: '2rem' }}>Signing you in…</p>;
}
