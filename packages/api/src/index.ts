import { config } from 'dotenv';
import path from 'path';
config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

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
import { handleStripeWebhook } from './billing/webhook';
import billingRouter from './billing/router';

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

// Stripe webhook — raw body required for signature verification (must be before express.json)
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

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
app.use('/api/billing', billingRouter);

// Global error handler — catches unhandled async errors so the process doesn't crash
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[unhandled]', err.message);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Prevent unhandled promise rejections from crashing the process (Express 4 async gap)
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.message : reason);
});

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
