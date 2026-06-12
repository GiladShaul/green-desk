import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Dashboard } from '../pages/Dashboard';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
  },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '1', name: 'Jane Doe', email: 'jane@example.com', role: 'user', tenantId: 't1', tenantName: 'Acme' },
    loading: false,
  }),
}));

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders welcome heading with user name', async () => {
    vi.mocked(api.get).mockResolvedValueOnce([]);
    renderDashboard();
    expect(screen.getByText(/welcome, jane doe/i)).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    vi.mocked(api.get).mockReturnValueOnce(new Promise(() => {}));
    renderDashboard();
    expect(screen.getByText(/loading floors/i)).toBeInTheDocument();
  });

  it('renders desk list when floors load', async () => {
    const floors = [
      { id: 'f1', name: 'Ground Floor', building: 'HQ', floor_number: 0 },
      { id: 'f2', name: 'First Floor', building: 'HQ', floor_number: 1 },
    ];
    vi.mocked(api.get).mockResolvedValueOnce(floors);
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Ground Floor')).toBeInTheDocument();
      expect(screen.getByText('First Floor')).toBeInTheDocument();
    });
  });

  it('shows error state when API fails', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Network error'));
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('shows empty state when no floors available', async () => {
    vi.mocked(api.get).mockResolvedValueOnce([]);
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/no floors available/i)).toBeInTheDocument();
    });
  });

  it('navigates to floor when floor card is clicked', async () => {
    const floors = [{ id: 'f1', name: 'Ground Floor', building: 'HQ', floor_number: 0 }];
    vi.mocked(api.get).mockResolvedValueOnce(floors);
    renderDashboard();

    await waitFor(() => screen.getByText('Ground Floor'));

    const user = userEvent.setup();
    await user.click(screen.getByText('Ground Floor'));
  });
});
