import { query } from '../db';

export type BookingEventType = 'booking_confirmed' | 'booking_cancelled' | 'booking_reminder';

export interface WebhookBooking {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
}

export interface WebhookResource {
  label: string;        // desk label or room name
  resource_type: 'desk' | 'room';
}

export interface WebhookFloor {
  name: string;
  building: string;
}

export interface WebhookUser {
  name: string;
  email: string;
}

interface IntegrationRow {
  id: string;
  provider: 'slack' | 'teams';
  webhook_url: string;
  events: string[];
}

// ── Slack Block Kit ──────────────────────────────────────────────────────────

function slackIcon(event: BookingEventType): string {
  if (event === 'booking_confirmed') return ':white_check_mark:';
  if (event === 'booking_cancelled') return ':x:';
  return ':alarm_clock:';
}

function slackTitle(event: BookingEventType, resource: WebhookResource): string {
  const what = resource.resource_type === 'desk' ? `Desk ${resource.label}` : `Room ${resource.label}`;
  if (event === 'booking_confirmed') return `Booking confirmed — ${what}`;
  if (event === 'booking_cancelled') return `Booking cancelled — ${what}`;
  return `Reminder — ${what} in 30 min`;
}

function buildSlackPayload(
  event: BookingEventType,
  booking: WebhookBooking,
  resource: WebhookResource,
  floor: WebhookFloor,
  user: WebhookUser,
): unknown {
  const icon = slackIcon(event);
  const title = slackTitle(event, resource);
  return {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${icon} ${title}`, emoji: true },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*${resource.resource_type === 'desk' ? 'Desk' : 'Room'}:*\n${resource.label}` },
          { type: 'mrkdwn', text: `*Floor / Building:*\n${floor.name}, ${floor.building}` },
          { type: 'mrkdwn', text: `*Date:*\n${booking.date}` },
          { type: 'mrkdwn', text: `*Time:*\n${booking.start_time.slice(0, 5)} – ${booking.end_time.slice(0, 5)}` },
          { type: 'mrkdwn', text: `*Booked by:*\n${user.name}` },
        ],
      },
    ],
  };
}

// ── Teams Adaptive Card ──────────────────────────────────────────────────────

function teamsColor(event: BookingEventType): string {
  if (event === 'booking_confirmed') return 'Good';
  if (event === 'booking_cancelled') return 'Attention';
  return 'Accent';
}

function teamsTitle(event: BookingEventType, resource: WebhookResource): string {
  const what = resource.resource_type === 'desk' ? `Desk ${resource.label}` : `Room ${resource.label}`;
  if (event === 'booking_confirmed') return `Booking Confirmed — ${what}`;
  if (event === 'booking_cancelled') return `Booking Cancelled — ${what}`;
  return `Reminder — ${what} starting in 30 min`;
}

function buildTeamsPayload(
  event: BookingEventType,
  booking: WebhookBooking,
  resource: WebhookResource,
  floor: WebhookFloor,
  user: WebhookUser,
): unknown {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: teamsTitle(event, resource),
              weight: 'Bolder',
              size: 'Medium',
              color: teamsColor(event),
              wrap: true,
            },
            {
              type: 'FactSet',
              facts: [
                { title: resource.resource_type === 'desk' ? 'Desk' : 'Room', value: resource.label },
                { title: 'Floor / Building', value: `${floor.name}, ${floor.building}` },
                { title: 'Date', value: booking.date },
                { title: 'Time', value: `${booking.start_time.slice(0, 5)} – ${booking.end_time.slice(0, 5)}` },
                { title: 'Booked by', value: user.name },
              ],
            },
          ],
        },
      },
    ],
  };
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

async function postWebhook(url: string, payload: unknown): Promise<void> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`[webhook] POST to ${url} failed: HTTP ${res.status}`);
    }
  } catch (err) {
    console.error(`[webhook] POST to ${url} error:`, err);
  }
}

export async function notifyBookingEvent(
  event: BookingEventType,
  booking: WebhookBooking,
  resource: WebhookResource,
  floor: WebhookFloor,
  user: WebhookUser,
  tenantId: string,
): Promise<void> {
  let rows: IntegrationRow[] = [];
  try {
    const result = await query<IntegrationRow>(
      `SELECT id, provider, webhook_url, events FROM integrations WHERE enabled = true AND tenant_id = $1`,
      [tenantId],
    );
    rows = result.rows;
  } catch (err) {
    console.error('[webhook] Failed to fetch integrations:', err);
    return;
  }

  const relevant = rows.filter(r => {
    const evts = Array.isArray(r.events) ? r.events : [];
    return evts.includes(event);
  });

  await Promise.all(
    relevant.map(r => {
      const payload =
        r.provider === 'slack'
          ? buildSlackPayload(event, booking, resource, floor, user)
          : buildTeamsPayload(event, booking, resource, floor, user);
      return postWebhook(r.webhook_url, payload);
    }),
  );
}
