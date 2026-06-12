import { createHmac, timingSafeEqual } from 'crypto';

const SECRET = process.env.CHECKIN_HMAC_SECRET || 'dev-checkin-secret-change-in-prod';

export function generateCheckInToken(bookingId: string): string {
  const mac = createHmac('sha256', SECRET).update(bookingId).digest('hex');
  return `${bookingId}.${mac}`;
}

export function validateCheckInToken(token: string): string | null {
  const dot = token.indexOf('.');
  if (dot === -1) return null;
  const bookingId = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac('sha256', SECRET).update(bookingId).digest('hex');
  try {
    if (!timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch {
    return null;
  }
  return bookingId;
}
