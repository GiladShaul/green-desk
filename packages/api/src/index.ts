import express from 'express';
import authRouter from './auth/router';
import floorsRouter from './floors/router';
import desksRouter from './desks/router';
import bookingsRouter from './bookings/router';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ message: 'Hello from Green Desk API!' });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRouter);
app.use('/api/floors', floorsRouter);
app.use('/api/desks', desksRouter);
app.use('/api/bookings', bookingsRouter);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
  });
}

export default app;
