import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { BookingModal } from '../components/BookingModal';
import { RoomBookingModal, type Room } from '../components/RoomBookingModal';
import { TeamBookingModal } from '../components/TeamBookingModal';
import styles from './FloorView.module.css';
import teamStyles from './FloorView.team.module.css';

interface Floor {
  id: string;
  name: string;
  building: string;
  floor_number: number;
}

export interface Desk {
  id: string;
  floor_id: string;
  label: string;
  x_position: number;
  y_position: number;
  status: 'active' | 'inactive';
  availability?: 'available' | 'booked';
  has_recurring?: boolean;
  team_booked?: boolean;
}

function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function FloorView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [floor, setFloor] = useState<Floor | null>(null);
  const [desks, setDesks] = useState<Desk[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [date, setDate] = useState<string>(toLocalDateString(new Date()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDesk, setSelectedDesk] = useState<Desk | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);

  // Team booking mode (admin only)
  const [teamMode, setTeamMode] = useState(false);
  const [teamSelected, setTeamSelected] = useState<Set<string>>(new Set());
  const [showTeamModal, setShowTeamModal] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.get<Floor>(`/floors/${id}`)
      .catch(() => null)
      .then((f) => {
        if (f) setFloor(f);
        else setError('Floor not found');
      });
  }, [id]);

  const loadDesks = useCallback(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api.get<Desk[]>(`/floors/${id}/desks?date=${date}`),
      api.get<Room[]>(`/floors/${id}/rooms?date=${date}`),
    ])
      .then(([d, r]) => { setDesks(d); setRooms(r); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, date]);

  useEffect(() => {
    loadDesks();
  }, [loadDesks]);

  // Reset team selection when date or mode changes
  useEffect(() => {
    setTeamSelected(new Set());
  }, [date, teamMode]);

  function deskColorClass(desk: Desk): string {
    if (desk.status === 'inactive') return styles.deskInactive;
    if (teamMode) {
      if (desk.availability === 'booked' || desk.team_booked) return styles.deskBooked;
      if (teamSelected.has(desk.id)) return teamStyles.deskTeamSelected;
      return styles.deskAvailable;
    }
    if (desk.availability === 'booked') return styles.deskBooked;
    if (desk.team_booked) return teamStyles.deskTeamBooked;
    if (desk.has_recurring) return styles.deskRecurring;
    return styles.deskAvailable;
  }

  function handleDeskClick(desk: Desk) {
    if (desk.status === 'inactive') return;

    if (teamMode) {
      if (desk.availability === 'booked' || desk.team_booked) return;
      setTeamSelected(prev => {
        const next = new Set(prev);
        if (next.has(desk.id)) next.delete(desk.id);
        else next.add(desk.id);
        return next;
      });
      return;
    }

    if (desk.availability === 'booked' || desk.team_booked) return;
    setSelectedDesk(desk);
  }

  function deskTitle(desk: Desk): string {
    if (desk.status === 'inactive') return 'Inactive';
    if (teamMode) {
      if (desk.availability === 'booked' || desk.team_booked) return 'Already booked';
      return teamSelected.has(desk.id) ? `Deselect ${desk.label}` : `Select ${desk.label} for team booking`;
    }
    if (desk.team_booked) return 'Reserved for team booking';
    if (desk.availability === 'booked') return 'Already booked';
    if (desk.has_recurring) return `Book ${desk.label} (has recurring booking)`;
    return `Book ${desk.label}`;
  }

  const selectedDeskObjects = desks.filter(d => teamSelected.has(d.id));

  return (
    <div>
      <button className={styles.back} onClick={() => navigate('/dashboard')}>
        ← Back to floors
      </button>

      {floor && (
        <div className={styles.header}>
          <h2 className={styles.title}>{floor.name}</h2>
          <span className={styles.subtitle}>{floor.building} · Floor {floor.floor_number}</span>
        </div>
      )}

      <div className={styles.controls}>
        <label className={styles.dateLabel}>
          Date:
          <input
            type="date"
            className={styles.dateInput}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <div className={styles.legend}>
          <span className={styles.legendItem}><span className={styles.dotAvailable} /> Available</span>
          <span className={styles.legendItem}><span className={styles.dotRecurring} /> Recurring</span>
          <span className={styles.legendItem}><span className={styles.dotBooked} /> Booked</span>
          <span className={styles.legendItem}><span className={styles.dotInactive} /> Inactive</span>
          {!teamMode && <span className={styles.legendItem}><span className={teamStyles.dotTeamBooked} /> Team</span>}
        </div>
        {isAdmin && (
          <div className={teamStyles.teamModeBar}>
            <button
              className={teamMode ? teamStyles.teamModeBtnActive : teamStyles.teamModeBtn}
              onClick={() => setTeamMode(m => !m)}
            >
              {teamMode ? 'Exit Team Mode' : 'Team Booking Mode'}
            </button>
            {teamMode && teamSelected.size > 0 && (
              <button
                className={teamStyles.createTeamBtn}
                onClick={() => setShowTeamModal(true)}
              >
                Book {teamSelected.size} Desk{teamSelected.size !== 1 ? 's' : ''} for Team →
              </button>
            )}
          </div>
        )}
      </div>

      {teamMode && (
        <p className={teamStyles.teamHint}>
          Click desks to select them for a team booking. {teamSelected.size} desk{teamSelected.size !== 1 ? 's' : ''} selected.
        </p>
      )}

      {error && <p className={styles.error}>{error}</p>}
      {loading && <p className={styles.meta}>Loading…</p>}

      {!loading && !error && desks.length === 0 && rooms.length === 0 && (
        <p className={styles.meta}>No desks or rooms on this floor.</p>
      )}

      {!loading && !error && desks.length > 0 && (
        <>
          <h3 className={styles.sectionHeading}>Desks</h3>
          <div className={styles.deskGrid}>
            {desks.map((desk) => {
              const isUnavailable = desk.status === 'inactive' ||
                (!teamMode && (desk.availability === 'booked' || !!desk.team_booked));
              return (
                <button
                  key={desk.id}
                  className={`${styles.desk} ${deskColorClass(desk)}`}
                  onClick={() => handleDeskClick(desk)}
                  disabled={isUnavailable}
                  title={deskTitle(desk)}
                >
                  {desk.label}
                  {!teamMode && desk.has_recurring && desk.availability !== 'booked' && desk.status !== 'inactive' && (
                    <span className={styles.recurringIndicator} aria-label="Has recurring booking">↻</span>
                  )}
                  {teamMode && teamSelected.has(desk.id) && (
                    <span className={teamStyles.checkmark}>✓</span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {!loading && !error && rooms.length > 0 && (
        <>
          <h3 className={styles.sectionHeading}>Meeting Rooms</h3>
          <div className={styles.deskGrid}>
            {rooms.map((room) => (
              <button
                key={room.id}
                className={`${styles.room} ${room.status === 'inactive' ? styles.deskInactive : room.availability === 'booked' ? styles.roomBusy : styles.roomAvailable}`}
                onClick={() => {
                  if (!teamMode && room.status !== 'inactive') setSelectedRoom(room);
                }}
                disabled={room.status === 'inactive'}
                title={room.status === 'inactive' ? 'Inactive' : room.availability === 'booked' ? `${room.name} — has bookings, check availability` : `Book ${room.name}`}
              >
                <span className={styles.roomName}>{room.name}</span>
                <span className={styles.roomCapacity}>👥 {room.capacity}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {selectedDesk && (
        <BookingModal
          desk={selectedDesk}
          date={date}
          onClose={() => setSelectedDesk(null)}
          onBooked={() => {
            setSelectedDesk(null);
            loadDesks();
          }}
        />
      )}

      {selectedRoom && (
        <RoomBookingModal
          room={selectedRoom}
          date={date}
          onClose={() => setSelectedRoom(null)}
          onBooked={() => {
            setSelectedRoom(null);
            loadDesks();
          }}
        />
      )}

      {showTeamModal && id && (
        <TeamBookingModal
          floorId={id}
          date={date}
          selectedDesks={selectedDeskObjects}
          onClose={() => setShowTeamModal(false)}
          onBooked={() => {
            setShowTeamModal(false);
            setTeamMode(false);
            setTeamSelected(new Set());
            loadDesks();
          }}
        />
      )}
    </div>
  );
}
