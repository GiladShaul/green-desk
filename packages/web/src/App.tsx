import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AdminRoute } from './components/AdminRoute';
import { Layout } from './components/Layout';
import { AdminLayout } from './pages/admin/AdminLayout';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Dashboard } from './pages/Dashboard';
import { FloorView } from './pages/FloorView';
import { MyBookings } from './pages/MyBookings';
import { AdminFloors } from './pages/admin/AdminFloors';
import { AdminDesks } from './pages/admin/AdminDesks';
import { AdminUsers } from './pages/admin/AdminUsers';
import { AdminAnalytics } from './pages/admin/AdminAnalytics';
import { AdminRooms } from './pages/admin/AdminRooms';
import { AdminTeamBookings } from './pages/admin/AdminTeamBookings';
import { AdminSSO } from './pages/admin/AdminSSO';
import { SsoCallback } from './pages/SsoCallback';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/sso-callback" element={<SsoCallback />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/floors/:id" element={<FloorView />} />
              <Route path="/bookings" element={<MyBookings />} />
              <Route element={<AdminRoute />}>
                <Route element={<AdminLayout />}>
                  <Route path="/admin/floors" element={<AdminFloors />} />
                  <Route path="/admin/floors/:floorId/desks" element={<AdminDesks />} />
                  <Route path="/admin/floors/:floorId/rooms" element={<AdminRooms />} />
                  <Route path="/admin/team-bookings" element={<AdminTeamBookings />} />
                  <Route path="/admin/users" element={<AdminUsers />} />
                  <Route path="/admin/analytics" element={<AdminAnalytics />} />
                  <Route path="/admin/sso" element={<AdminSSO />} />
                </Route>
              </Route>
            </Route>
          </Route>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
