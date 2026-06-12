import nodemailer, { Transporter, SendMailOptions } from 'nodemailer';
import { logger } from '../logger';

export interface EmailUser {
  id: string;
  email: string;
  name: string;
}

export interface EmailBooking {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
}

export interface EmailDesk {
  id: string;
  label: string;
}

export interface EmailFloor {
  id: string;
  name: string;
  building: string;
}

function createTransport(): Transporter {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
        : undefined,
    });
  }

  // Dev: log emails to console instead of sending
  return nodemailer.createTransport({
    jsonTransport: true,
  });
}

let _transport: Transporter | null = null;

export function getTransport(): Transporter {
  if (!_transport) {
    _transport = createTransport();
  }
  return _transport;
}

// Exposed for testing only
export function setTransport(t: Transporter): void {
  _transport = t;
}

export function resetTransport(): void {
  _transport = null;
}

const FROM = process.env.EMAIL_FROM || 'Green Desk <noreply@greendesk.local>';

async function send(options: SendMailOptions): Promise<void> {
  const transport = getTransport();
  try {
    const info = await transport.sendMail(options);
    if (!process.env.SMTP_HOST) {
      // jsonTransport — log to console in dev
      logger.debug({ message: (info as { message?: string }).message ?? JSON.stringify(info) }, '[email] dev transport');
    }
  } catch (err) {
    logger.error({ err }, '[email] Failed to send email');
    // Non-blocking: swallow error so caller is unaffected
  }
}

export async function sendBookingConfirmation(
  user: EmailUser,
  booking: EmailBooking,
  desk: EmailDesk,
  floor: EmailFloor
): Promise<void> {
  const subject = `Booking confirmed – Desk ${desk.label} on ${booking.date}`;
  const text = [
    `Hi ${user.name},`,
    '',
    'Your desk booking has been confirmed.',
    '',
    `  Desk:       ${desk.label}`,
    `  Floor:      ${floor.name}`,
    `  Building:   ${floor.building}`,
    `  Date:       ${booking.date}`,
    `  Time:       ${booking.start_time} – ${booking.end_time}`,
    '',
    'See you there!',
    '',
    '– The Green Desk Team',
  ].join('\n');

  await send({ from: FROM, to: user.email, subject, text });
}

export async function sendBookingCancellation(
  user: EmailUser,
  booking: EmailBooking,
  desk: EmailDesk,
  floor: EmailFloor
): Promise<void> {
  const subject = `Booking cancelled – Desk ${desk.label} on ${booking.date}`;
  const text = [
    `Hi ${user.name},`,
    '',
    'Your desk booking has been cancelled. Your desk is now available for others.',
    '',
    `  Desk:       ${desk.label}`,
    `  Floor:      ${floor.name}`,
    `  Building:   ${floor.building}`,
    `  Date:       ${booking.date}`,
    `  Time:       ${booking.start_time} – ${booking.end_time}`,
    '',
    'If this was a mistake, you can rebook any available desk.',
    '',
    '– The Green Desk Team',
  ].join('\n');

  await send({ from: FROM, to: user.email, subject, text });
}
