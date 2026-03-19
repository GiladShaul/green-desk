import { useState } from 'react';
import { Outlet, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import styles from './Layout.module.css';

export function Layout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  function closeMenu() { setMenuOpen(false); }

  return (
    <div className={styles.wrapper}>
      <nav className={styles.nav}>
        <div className={styles.logoGroup}>
          <Link to="/dashboard" className={styles.logo} onClick={closeMenu}>Green Desk</Link>
          {user?.tenantName && (
            <span className={styles.tenantName}>{user.tenantName}</span>
          )}
        </div>
        <div className={styles.navLinks}>
          <Link to="/bookings" className={styles.navLink}>My Bookings</Link>
          {user?.role === 'admin' && (
            <Link to="/admin/floors" className={styles.navLink}>Admin</Link>
          )}
        </div>
        <div className={styles.navRight}>
          {user && <span className={styles.userName}>{user.name}</span>}
          <button className={styles.logoutBtn} onClick={logout}>Logout</button>
        </div>
        <button
          className={styles.hamburger}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(o => !o)}
        >
          {menuOpen ? '✕' : '☰'}
        </button>
      </nav>
      {menuOpen && (
        <div className={styles.mobileMenu}>
          {user?.tenantName && (
            <span className={styles.mobileTenantName}>{user.tenantName}</span>
          )}
          <Link to="/bookings" className={styles.mobileLink} onClick={closeMenu}>My Bookings</Link>
          {user?.role === 'admin' && (
            <Link to="/admin/floors" className={styles.mobileLink} onClick={closeMenu}>Admin</Link>
          )}
          <div className={styles.mobileDivider} />
          {user && <span className={styles.mobileUserName}>{user.name}</span>}
          <button className={styles.mobileLogoutBtn} onClick={() => { logout(); closeMenu(); }}>Logout</button>
        </div>
      )}
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
