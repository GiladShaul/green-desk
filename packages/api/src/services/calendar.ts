import crypto from 'crypto';
import { google } from 'googleapis';
import { query } from '../db';
import { logger } from '../logger';

// ---------------------------------------------------------------------------
// Token encryption (AES-256-GCM)
// CALENDAR_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)
// ---------------------------------------------------------------------------

function getEncKey(): Buffer {
  const hex = process.env.CALENDAR_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('CALENDAR_ENCRYPTION_KEY must be a 64-char hex string');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptToken(plain: string): string {
  const key = getEncKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Encode as iv:tag:ciphertext (all hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptToken(encoded: string): string {
  const key = getEncKey();
  const [ivHex, tagHex, ctHex] = encoded.split(':');
  if (!ivHex || !tagHex || !ctHex) throw new Error('Invalid encrypted token format');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ct = Buffer.from(ctHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ct) + decipher.final('utf8');
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface CalendarConnection {
  id: string;
  user_id: string;
  provider: 'google' | 'microsoft';
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: Date | null;
  calendar_id: string | null;
}

interface BookingDetails {
  id: string;
  date: string;       // YYYY-MM-DD
  start_time: string; // HH:MM
  end_time: string;   // HH:MM
  desk_label: string;
  floor_name: string;
  building: string;
}

// ---------------------------------------------------------------------------
// Google Calendar helpers
// ---------------------------------------------------------------------------

function buildGoogleOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
}

async function getValidGoogleTokens(conn: CalendarConnection): Promise<{ accessToken: string } | null> {
  try {
    const oauth2Client = buildGoogleOAuth2Client();
    const refreshToken = decryptToken(conn.refresh_token_encrypted);
    oauth2Client.setCredentials({
      refresh_token: refreshToken,
      access_token: decryptToken(conn.access_token_encrypted),
      expiry_date: conn.token_expires_at ? conn.token_expires_at.getTime() : undefined,
    });

    const now = Date.now();
    const isExpired = conn.token_expires_at && conn.token_expires_at.getTime() < now + 60_000;
    if (isExpired) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      const newAccessToken = credentials.access_token;
      if (!newAccessToken) throw new Error('No access_token returned');
      // Persist refreshed token
      await query(
        `UPDATE user_calendar_connections
         SET access_token_encrypted = $1, token_expires_at = $2
         WHERE id = $3`,
        [encryptToken(newAccessToken), credentials.expiry_date ? new Date(credentials.expiry_date) : null, conn.id],
      );
      return { accessToken: newAccessToken };
    }

    return { accessToken: decryptToken(conn.access_token_encrypted) };
  } catch (err) {
    logger.error({ err }, `[calendar] Google token refresh failed for connection ${conn.id}`);
    await query(
      `UPDATE user_calendar_connections SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
      [conn.id],
    );
    return null;
  }
}

async function createGoogleEvent(conn: CalendarConnection, booking: BookingDetails): Promise<string | null> {
  const tokens = await getValidGoogleTokens(conn);
  if (!tokens) return null;

  const oauth2Client = buildGoogleOAuth2Client();
  oauth2Client.setCredentials({ access_token: tokens.accessToken });
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const calendarId = conn.calendar_id || 'primary';
  const start = `${booking.date}T${booking.start_time}:00`;
  const end = `${booking.date}T${booking.end_time}:00`;

  const { data } = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: `${booking.desk_label} @ ${booking.floor_name}`,
      location: `${booking.building}, ${booking.floor_name}`,
      description: `Green Desk booking\nDesk: ${booking.desk_label}\nFloor: ${booking.floor_name}\nBuilding: ${booking.building}`,
      start: { dateTime: start },
      end: { dateTime: end },
    },
  });

  return data.id ?? null;
}

async function deleteGoogleEvent(conn: CalendarConnection, providerEventId: string): Promise<void> {
  const tokens = await getValidGoogleTokens(conn);
  if (!tokens) return;

  const oauth2Client = buildGoogleOAuth2Client();
  oauth2Client.setCredentials({ access_token: tokens.accessToken });
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const calendarId = conn.calendar_id || 'primary';
  try {
    await calendar.events.delete({ calendarId, eventId: providerEventId });
  } catch (err: unknown) {
    // 410 Gone = already deleted; ignore
    const status = (err as { code?: number })?.code;
    if (status !== 410) throw err;
  }
}

// ---------------------------------------------------------------------------
// Microsoft Graph helpers (manual OAuth, no MSAL dependency)
// ---------------------------------------------------------------------------

interface MSTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
}

async function refreshMicrosoftTokens(conn: CalendarConnection): Promise<MSTokens | null> {
  try {
    const refreshToken = decryptToken(conn.refresh_token_encrypted);
    const params = new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID ?? '',
      client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: 'Calendars.ReadWrite offline_access',
    });

    const resp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      body: params,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!resp.ok) throw new Error(`Token refresh HTTP ${resp.status}`);
    const data = await resp.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    const newRefresh = data.refresh_token ?? refreshToken;
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);

    await query(
      `UPDATE user_calendar_connections
       SET access_token_encrypted = $1, refresh_token_encrypted = $2, token_expires_at = $3
       WHERE id = $4`,
      [encryptToken(data.access_token), encryptToken(newRefresh), expiresAt, conn.id],
    );

    return { accessToken: data.access_token, refreshToken: newRefresh, expiresAt };
  } catch (err) {
    logger.error({ err }, `[calendar] Microsoft token refresh failed for connection ${conn.id}`);
    await query(
      `UPDATE user_calendar_connections SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
      [conn.id],
    );
    return null;
  }
}

async function getValidMicrosoftTokens(conn: CalendarConnection): Promise<{ accessToken: string } | null> {
  const isExpired = conn.token_expires_at && conn.token_expires_at.getTime() < Date.now() + 60_000;
  if (isExpired) {
    return refreshMicrosoftTokens(conn);
  }
  try {
    return { accessToken: decryptToken(conn.access_token_encrypted) };
  } catch {
    return refreshMicrosoftTokens(conn);
  }
}

async function createMicrosoftEvent(conn: CalendarConnection, booking: BookingDetails): Promise<string | null> {
  const tokens = await getValidMicrosoftTokens(conn);
  if (!tokens) return null;

  const start = `${booking.date}T${booking.start_time}:00`;
  const end = `${booking.date}T${booking.end_time}:00`;

  const resp = await fetch('https://graph.microsoft.com/v1.0/me/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subject: `${booking.desk_label} @ ${booking.floor_name}`,
      location: { displayName: `${booking.building}, ${booking.floor_name}` },
      body: {
        contentType: 'text',
        content: `Green Desk booking\nDesk: ${booking.desk_label}\nFloor: ${booking.floor_name}\nBuilding: ${booking.building}`,
      },
      start: { dateTime: start, timeZone: 'UTC' },
      end: { dateTime: end, timeZone: 'UTC' },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Microsoft Graph event create failed: ${resp.status} ${body}`);
  }

  const data = await resp.json() as { id: string };
  return data.id;
}

async function deleteMicrosoftEvent(conn: CalendarConnection, providerEventId: string): Promise<void> {
  const tokens = await getValidMicrosoftTokens(conn);
  if (!tokens) return;

  const resp = await fetch(`https://graph.microsoft.com/v1.0/me/events/${providerEventId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });

  if (!resp.ok && resp.status !== 404 && resp.status !== 410) {
    const body = await resp.text();
    throw new Error(`Microsoft Graph event delete failed: ${resp.status} ${body}`);
  }
}

// ---------------------------------------------------------------------------
// Public API — called from booking router (fire-and-forget, errors logged)
// ---------------------------------------------------------------------------

export async function syncBookingCreated(bookingId: string, userId: string): Promise<void> {
  const conns = await query<CalendarConnection>(
    `SELECT id, user_id, provider, access_token_encrypted, refresh_token_encrypted,
            token_expires_at, calendar_id
     FROM user_calendar_connections
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );

  if (conns.rows.length === 0) return;

  const bookingRes = await query<{
    id: string; date: string; start_time: string; end_time: string;
    desk_label: string; floor_name: string; building: string;
  }>(
    `SELECT b.id, b.date::text, b.start_time::text, b.end_time::text,
            d.label AS desk_label, f.name AS floor_name, f.building
     FROM bookings b
     JOIN desks d ON d.id = b.desk_id
     JOIN floors f ON f.id = d.floor_id
     WHERE b.id = $1`,
    [bookingId],
  );

  if (!bookingRes.rows[0]) return;
  const booking = bookingRes.rows[0];

  for (const conn of conns.rows) {
    try {
      let providerEventId: string | null = null;
      if (conn.provider === 'google') {
        providerEventId = await createGoogleEvent(conn, booking);
      } else if (conn.provider === 'microsoft') {
        providerEventId = await createMicrosoftEvent(conn, booking);
      }
      if (providerEventId) {
        await query(
          `INSERT INTO booking_calendar_events (booking_id, connection_id, provider_event_id)
           VALUES ($1, $2, $3)`,
          [bookingId, conn.id, providerEventId],
        );
      }
    } catch (err) {
      logger.error({ err }, `[calendar] sync create failed for connection ${conn.id}`);
    }
  }
}

export async function syncBookingCancelled(bookingId: string): Promise<void> {
  const events = await query<{
    id: string; connection_id: string; provider_event_id: string;
    provider: string;
    access_token_encrypted: string; refresh_token_encrypted: string;
    token_expires_at: Date | null; calendar_id: string | null; user_id: string;
  }>(
    `SELECT bce.id, bce.connection_id, bce.provider_event_id,
            ucc.provider, ucc.access_token_encrypted, ucc.refresh_token_encrypted,
            ucc.token_expires_at, ucc.calendar_id, ucc.user_id
     FROM booking_calendar_events bce
     JOIN user_calendar_connections ucc ON ucc.id = bce.connection_id
     WHERE bce.booking_id = $1 AND ucc.revoked_at IS NULL`,
    [bookingId],
  );

  for (const ev of events.rows) {
    try {
      const conn: CalendarConnection = {
        id: ev.connection_id,
        user_id: ev.user_id,
        provider: ev.provider as 'google' | 'microsoft',
        access_token_encrypted: ev.access_token_encrypted,
        refresh_token_encrypted: ev.refresh_token_encrypted,
        token_expires_at: ev.token_expires_at,
        calendar_id: ev.calendar_id,
      };

      if (conn.provider === 'google') {
        await deleteGoogleEvent(conn, ev.provider_event_id);
      } else if (conn.provider === 'microsoft') {
        await deleteMicrosoftEvent(conn, ev.provider_event_id);
      }

      await query('DELETE FROM booking_calendar_events WHERE id = $1', [ev.id]);
    } catch (err) {
      logger.error({ err }, `[calendar] sync cancel failed for event ${ev.id}`);
    }
  }
}

export { buildGoogleOAuth2Client };
