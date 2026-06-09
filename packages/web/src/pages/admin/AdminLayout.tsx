import { NavLink, Outlet } from 'react-router-dom';
import styles from './AdminLayout.module.css';

export function AdminLayout() {
  return (
    <div className={styles.wrapper}>
      <aside className={styles.sidebar}>
        <h2 className={styles.sidebarTitle}>Admin</h2>
        <nav className={styles.nav}>
          <NavLink
            to="/admin/floors"
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}
          >
            Floors
          </NavLink>
          <NavLink
            to="/admin/users"
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}
          >
            Users
          </NavLink>
          <NavLink
            to="/admin/analytics"
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}
          >
            Analytics
          </NavLink>
          <NavLink
            to="/admin/team-bookings"
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}
          >
            Team Bookings
          </NavLink>
          <NavLink
            to="/admin/sso"
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}
          >
            SSO
          </NavLink>
          <NavLink
            to="/admin/integrations"
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}
          >
            Integrations
          </NavLink>
          <NavLink
            to="/admin/billing"
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}
          >
            Billing
          </NavLink>
          <NavLink
            to="/admin/audit-log"
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}
          >
            Audit Log
          </NavLink>
          <NavLink
            to="/admin/api-keys"
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}
          >
            API Keys
          </NavLink>
        </nav>
      </aside>
      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}
