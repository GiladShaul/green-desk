import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import styles from './Dashboard.module.css';

interface Floor {
  id: string;
  name: string;
  building: string;
  floor_number: number;
}

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [floors, setFloors] = useState<Floor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Floor[]>('/floors')
      .then(setFloors)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h2 className={styles.heading}>Welcome, {user?.name}</h2>
      <p className={styles.sub}>Select a floor to view and book desks.</p>
      {loading && <p className={styles.meta}>Loading floors…</p>}
      {error && <p className={styles.error}>{error}</p>}
      {!loading && !error && floors.length === 0 && (
        <p className={styles.meta}>No floors available yet.</p>
      )}
      <div className={styles.grid}>
        {floors.map((floor) => (
          <button
            key={floor.id}
            className={styles.floorCard}
            onClick={() => navigate(`/floors/${floor.id}`)}
          >
            <span className={styles.floorName}>{floor.name}</span>
            <span className={styles.floorMeta}>{floor.building} · Floor {floor.floor_number}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
