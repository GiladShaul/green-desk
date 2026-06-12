import { test, expect } from '@playwright/test';

const TEST_EMAIL = 'alice@greendesk.com';
const TEST_PASSWORD = 'password123';

/** Returns a YYYY-MM-DD date string N days from today. */
function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Cancel all of a user's confirmed desk bookings via the API so each test
 * starts clean without leftover bookings from prior runs.
 */
test.beforeEach(async ({ request }) => {
  const loginRes = await request.post('/api/auth/login', {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
  const { token } = await loginRes.json();
  const authHeader = { Authorization: `Bearer ${token}` };

  const bookingsRes = await request.get('/api/bookings/me', { headers: authHeader });
  const bookings: Array<{ id: string; status: string }> = await bookingsRes.json();
  for (const b of bookings) {
    if (b.status === 'confirmed') {
      await request.delete(`/api/bookings/${b.id}`, { headers: authHeader });
    }
  }
});

test.describe('Desk booking flow', () => {
  test('login → dashboard → book a desk → verify in My Bookings → cancel', async ({ page }) => {
    // ── 1. Login ────────────────────────────────────────────────────────────
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(TEST_EMAIL);
    await page.locator('input[type="password"]').fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();

    // ── 2. Dashboard: redirected, user greeting, floor listing ──────────────
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { level: 2 })).toContainText('Welcome, Alice Smith');

    const floorCard = page.getByRole('button', { name: /Ground Floor/i });
    await expect(floorCard).toBeVisible();

    // ── 3. FloorView: navigate and pick a conflict-free future date ──────────
    await floorCard.click();
    await expect(page).toHaveURL(/\/floors\//);

    const bookingDate = futureDate(30);
    await page.locator('input[type="date"]').fill(bookingDate);

    // Wait for desks to reload after date change
    const deskA01 = page.locator('button[title="Book A-01"]');
    await expect(deskA01).toBeVisible({ timeout: 10_000 });

    // ── 4. Open booking modal and confirm ───────────────────────────────────
    await deskA01.click();
    await expect(page.getByText('Book Desk: A-01')).toBeVisible();

    await page.getByRole('button', { name: 'Confirm Booking' }).click();
    await expect(page.getByText('Booking confirmed!')).toBeVisible();

    // Modal auto-closes after 1 s; wait for it to disappear before navigating
    await expect(page.getByText('Book Desk: A-01')).not.toBeVisible({ timeout: 5_000 });

    // ── 5. My Bookings: new booking appears in Upcoming ──────────────────────
    await page.getByRole('link', { name: 'My Bookings' }).click();
    await expect(page).toHaveURL(/\/bookings/);
    await expect(page.getByRole('heading', { level: 2 })).toContainText('My Bookings');

    // Wait for loading to complete
    await expect(page.getByText('Loading bookings…')).not.toBeVisible({ timeout: 10_000 });

    // Upcoming section exists and shows the A-01 booking
    const upcomingSection = page.locator('section').filter({ hasText: /^Upcoming/ });
    await expect(upcomingSection).toBeVisible();
    // After beforeEach cleanup, only one booking was confirmed → exactly one Cancel button
    const cancelBtns = upcomingSection.getByRole('button', { name: 'Cancel' });
    await expect(cancelBtns).toHaveCount(1);

    // Verify it's the A-01 booking (the heading text nearby)
    await expect(upcomingSection.getByText('A-01').first()).toBeVisible();

    // ── 6. Cancel: click Cancel → confirm dialog → Yes, Cancel ──────────────
    await cancelBtns.click();

    await expect(page.getByText('Cancel this booking?')).toBeVisible();
    await page.getByRole('button', { name: 'Yes, Cancel' }).click();

    // ── 7. Verify booking is now cancelled ──────────────────────────────────
    await expect(page.getByText('Cancel this booking?')).not.toBeVisible();

    // No more Cancel buttons — the booking can no longer be cancelled
    await expect(upcomingSection.getByRole('button', { name: 'Cancel' })).toHaveCount(0);

    // A-01 is still visible in the section (as cancelled)
    await expect(upcomingSection.getByText('A-01').first()).toBeVisible();
  });
});
