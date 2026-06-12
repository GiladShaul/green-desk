import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { FloorView } from '../pages/FloorView';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '1', name: 'Jane Doe', email: 'jane@example.com', role: 'user', tenantId: 't1', tenantName: 'Acme' },
    loading: false,
  }),
}));

vi.mock('../components/BookingModal', () => ({
  BookingModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="booking-modal">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

vi.mock('../components/RoomBookingModal', () => ({
  RoomBookingModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="room-booking-modal">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

vi.mock('../components/TeamBookingModal', () => ({
  TeamBookingModal: () => <div data-testid="team-booking-modal" />,
}));

const mockFloor = { id: 'floor-1', name: 'Ground Floor', building: 'HQ', floor_number: 0 };
const mockDesks = [
  { id: 'd1', floor_id: 'floor-1', label: 'A1', x_position: 0, y_position: 0, status: 'active', availability: 'available' },
  { id: 'd2', floor_id: 'floor-1', label: 'A2', x_position: 1, y_position: 0, status: 'active', availability: 'booked' },
  { id: 'd3', floor_id: 'floor-1', label: 'A3', x_position: 2, y_position: 0, status: 'inactive', availability: 'available' },
];

function renderFloorView(id = 'floor-1') {
  return render(
    <MemoryRouter initialEntries={[`/floors/${id}`]}>
      <Routes>
        <Route path="/floors/:id" element={<FloorView />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('FloorView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    renderFloorView();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders back button', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(mockFloor)
      .mockResolvedValueOnce(mockDesks)
      .mockResolvedValueOnce([]);
    renderFloorView();
    expect(screen.getByText(/back to floors/i)).toBeInTheDocument();
  });

  it('renders floor map with desks after loading', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(mockFloor)
      .mockResolvedValueOnce(mockDesks)
      .mockResolvedValueOnce([]);
    renderFloorView();

    await waitFor(() => {
      expect(screen.getByText('A1')).toBeInTheDocument();
      expect(screen.getByText('A2')).toBeInTheDocument();
      expect(screen.getByText('A3')).toBeInTheDocument();
    });
  });

  it('opens booking modal when available desk is clicked', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(mockFloor)
      .mockResolvedValueOnce(mockDesks)
      .mockResolvedValueOnce([]);
    renderFloorView();

    await waitFor(() => screen.getByText('A1'));

    const user = userEvent.setup();
    await user.click(screen.getByText('A1'));

    expect(screen.getByTestId('booking-modal')).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(mockFloor)
      .mockRejectedValueOnce(new Error('Failed to load desks'))
      .mockRejectedValueOnce(new Error('Failed to load rooms'));
    renderFloorView();

    await waitFor(() => {
      expect(screen.getByText('Failed to load desks')).toBeInTheDocument();
    });
  });
});
