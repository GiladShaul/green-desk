import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyBookings } from '../pages/MyBookings';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    delete: vi.fn(),
  },
}));

const today = new Date().toISOString().split('T')[0];
const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

const mockUpcomingBooking = {
  id: 'b1',
  desk_id: 'd1',
  date: `${tomorrow}T00:00:00.000Z`,
  start_time: '09:00:00',
  end_time: '17:00:00',
  status: 'confirmed',
  created_at: today,
  desk_label: 'A1',
  floor_id: 'f1',
  floor_name: 'Ground Floor',
};

const mockPastBooking = {
  id: 'b2',
  desk_id: 'd2',
  date: `${yesterday}T00:00:00.000Z`,
  start_time: '09:00:00',
  end_time: '17:00:00',
  status: 'confirmed',
  created_at: yesterday,
  desk_label: 'B2',
  floor_id: 'f1',
  floor_name: 'Ground Floor',
};

function mockEmptyResponses() {
  vi.mocked(api.get)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);
}

function renderMyBookings() {
  return render(<MyBookings />);
}

describe('MyBookings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    renderMyBookings();
    expect(screen.getByText(/loading bookings/i)).toBeInTheDocument();
  });

  it('renders bookings list', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce([mockUpcomingBooking, mockPastBooking])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    renderMyBookings();

    await waitFor(() => {
      expect(screen.getByText('A1')).toBeInTheDocument();
      expect(screen.getByText('B2')).toBeInTheDocument();
    });
  });

  it('shows cancel button for upcoming bookings', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce([mockUpcomingBooking])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    renderMyBookings();

    await waitFor(() => {
      expect(screen.getByText('A1')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('does not show cancel button for past bookings', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce([mockPastBooking])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    renderMyBookings();

    await waitFor(() => {
      expect(screen.getByText('B2')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  });

  it('shows cancel confirmation dialog when cancel is clicked', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce([mockUpcomingBooking])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    renderMyBookings();

    await waitFor(() => screen.getByText('A1'));

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.getByText(/cancel this booking/i)).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Failed to fetch bookings'));
    renderMyBookings();

    await waitFor(() => {
      expect(screen.getByText('Failed to fetch bookings')).toBeInTheDocument();
    });
  });

  it('shows empty state when no upcoming bookings', async () => {
    mockEmptyResponses();
    renderMyBookings();

    await waitFor(() => {
      expect(screen.getByText(/no upcoming bookings/i)).toBeInTheDocument();
    });
  });
});
