import express, { Request, Response, NextFunction } from 'express';
import authRouter from './auth/router';
import floorsRouter from './floors/router';
import desksRouter from './desks/router';
import bookingsRouter from './bookings/router';
import adminRouter from './admin/router';
import recurringBookingsRouter, { generateRecurringBookings } from './recurring-bookings/router';
import roomsRouter from './rooms/router';
import roomBookingsRouter from './room-bookings/router';
import teamBookingsRouter from './team-bookings/router';
import ssoRouter from './sso/router';
import { startReminderScheduler } from './services/reminder-scheduler';

const app = express();
const PORT = process.env.PORT || 3001;

// CORS
const corsOrigin = process.env.CORS_ORIGIN;
if (corsOrigin) {
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    if (_req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
}

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ message: 'Hello from Green Desk API!' });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRouter);
app.use('/api/auth/sso', ssoRouter);
app.use('/api/floors', floorsRouter);
app.use('/api/desks', desksRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/recurring-bookings', recurringBookingsRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/room-bookings', roomBookingsRouter);
app.use('/api/team-bookings', teamBookingsRouter);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
    // Materialize recurring bookings on startup
    generateRecurringBookings()
      .then((n) => console.log(`[recurring-bookings] generated ${n} booking(s) on startup`))
      .catch((err: unknown) => console.error('[recurring-bookings] startup generate error:', err));
    startReminderScheduler();
  });
}

export default app;
