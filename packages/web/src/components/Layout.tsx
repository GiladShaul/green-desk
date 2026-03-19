import { Outlet, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import styles from './Layout.module.css';

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className={styles.wrapper}>
      <nav className={styles.nav}>
        <Link to="/dashboard" className={styles.logo}>Green Desk</Link>
        <div className={styles.navLinks}>
          <Link to="/bookings" className={styles.navLink}>My Bookings</Link>
        </div>
        <div className={styles.navRight}>
          {user && <span className={styles.userName}>{user.name}</span>}
          <button className={styles.logoutBtn} onClick={logout}>Logout</button>
        </div>
      </nav>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
