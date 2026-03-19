import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import styles from './AdminAnalytics.module.css';

interface FloorStat {
  floorId: string;
  floorName: string;
  bookings: number;
  activeDesks: number;
  utilizationRate: number;
}

interface PeakDay {
  date: string;
  bookings: number;
}

interface PeakSlot {
  startTime: string;
  endTime: string;
  bookings: number;
}

interface DeskStat {
  deskId: string;
  label: string;
  floorId: string;
  floorName: string;
  bookings: number;
}

interface AnalyticsData {
  days: number;
  totalBookings: number;
  avgDailyBookings: number;
  utilizationRate: number;
  bookingsByFloor: FloorStat[];
  peakDays: PeakDay[];
  peakTimeSlots: PeakSlot[];
  topDesks: DeskStat[];
  leastUsedDesks: DeskStat[];
}

const DAY_OPTIONS = [7, 30, 90] as const;

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function BarCell({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className={styles.barCell}>
      <div className={styles.barTrack}>
        <div className={styles.barFill} style={{ width: `${pct}%` }} />
      </div>
      <span className={styles.barLabel}>{value}</span>
    </div>
  );
}

export function AdminAnalytics() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get<AnalyticsData>(`/admin/analytics?days=${days}`)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [days]);

  const maxFloorBookings = data ? Math.max(...data.bookingsByFloor.map(f => f.bookings), 1) : 1;
  const maxDeskBookings = data ? Math.max(...data.topDesks.map(d => d.bookings), 1) : 1;

  return (
    <div>
      <div className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>Analytics</h2>
        <div className={styles.rangePicker}>
          {DAY_OPTIONS.map(d => (
            <button
              key={d}
              className={`${styles.rangeBtn} ${days === d ? styles.rangeBtnActive : ''}`}
              onClick={() => setDays(d)}
            >
              {d === 7 ? 'Last 7 days' : d === 30 ? 'Last 30 days' : 'Last 90 days'}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className={styles.meta}>Loading analytics…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && !error && data && (
        <>
          {/* Summary cards */}
          <div className={styles.cards}>
            <div className={styles.card}>
              <div className={styles.cardValue}>{data.totalBookings.toLocaleString()}</div>
              <div className={styles.cardLabel}>Total Bookings</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardValue}>{data.avgDailyBookings}</div>
              <div className={styles.cardLabel}>Avg Daily Bookings</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardValue}>{data.utilizationRate}%</div>
              <div className={styles.cardLabel}>Overall Utilization</div>
            </div>
          </div>

          {/* Bookings per floor */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Bookings by Floor</h3>
            {data.bookingsByFloor.length === 0 ? (
              <p className={styles.meta}>No floor data available.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Floor</th>
                    <th>Bookings</th>
                    <th>Active Desks</th>
                    <th>Utilization</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bookingsByFloor.map(floor => (
                    <tr key={floor.floorId}>
                      <td>{floor.floorName}</td>
                      <td><BarCell value={floor.bookings} max={maxFloorBookings} /></td>
                      <td>{floor.activeDesks}</td>
                      <td>
                        <span className={styles.utilBadge}>{floor.utilizationRate}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <div className={styles.twoCol}>
            {/* Peak days */}
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Peak Days</h3>
              {data.peakDays.length === 0 ? (
                <p className={styles.meta}>No data.</p>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Bookings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.peakDays.map(day => (
                      <tr key={day.date}>
                        <td>{formatDate(day.date)}</td>
                        <td>{day.bookings}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* Peak time slots */}
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Peak Time Slots</h3>
              {data.peakTimeSlots.length === 0 ? (
                <p className={styles.meta}>No data.</p>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Bookings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.peakTimeSlots.map(slot => (
                      <tr key={`${slot.startTime}-${slot.endTime}`}>
                        <td>{slot.startTime} – {slot.endTime}</td>
                        <td>{slot.bookings}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          {/* Top 10 most booked desks */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Top 10 Most Booked Desks</h3>
            {data.topDesks.length === 0 ? (
              <p className={styles.meta}>No desk data available.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Desk</th>
                    <th>Floor</th>
                    <th>Bookings</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topDesks.map(desk => (
                    <tr key={desk.deskId}>
                      <td>{desk.label}</td>
                      <td>{desk.floorName}</td>
                      <td><BarCell value={desk.bookings} max={maxDeskBookings} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Least used desks */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Least Used Desks</h3>
            <p className={styles.sectionSubtitle}>Candidates for removal or repurposing.</p>
            {data.leastUsedDesks.length === 0 ? (
              <p className={styles.meta}>No desk data available.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Desk</th>
                    <th>Floor</th>
                    <th>Bookings</th>
                  </tr>
                </thead>
                <tbody>
                  {data.leastUsedDesks.map(desk => (
                    <tr key={desk.deskId}>
                      <td>{desk.label}</td>
                      <td>{desk.floorName}</td>
                      <td>{desk.bookings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
