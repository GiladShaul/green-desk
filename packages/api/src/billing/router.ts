import { Router, Response, NextFunction } from 'express';
import { query } from '../db';
import { requireAuth, AuthRequest } from '../auth/middleware';
import { getPlanLimits } from './plans';
import { stripe } from './stripe';

const router = Router();

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden: admin access required' });
    return;
  }
  next();
}

// GET /api/billing/status
router.get('/status', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;

  const tenantResult = await query<{
    plan: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    billing_email: string | null;
    plan_seats_limit: number | null;
    current_period_end: string | null;
  }>(
    'SELECT plan, stripe_customer_id, stripe_subscription_id, billing_email, plan_seats_limit, current_period_end FROM tenants WHERE id = $1',
    [tenantId]
  );

  if (tenantResult.rows.length === 0) {
    res.status(404).json({ error: 'Tenant not found' });
    return;
  }

  const tenant = tenantResult.rows[0];
  const limits = getPlanLimits(tenant.plan);

  const userCountResult = await query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM users WHERE tenant_id = $1',
    [tenantId]
  );
  const seatsUsed = parseInt(userCountResult.rows[0].count, 10);

  res.json({
    plan: tenant.plan,
    seatsUsed,
    seatsLimit: tenant.plan_seats_limit ?? limits.maxUsers,
    floorsLimit: limits.maxFloors,
    subscriptionStatus: tenant.stripe_subscription_id ? 'active' : 'none',
    currentPeriodEnd: tenant.current_period_end,
    billingEmail: tenant.billing_email,
    hasCustomer: !!tenant.stripe_customer_id,
  });
});

// POST /api/billing/checkout — create Stripe Checkout Session for plan upgrade
router.post('/checkout', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { planId } = req.body as { planId?: string };
  const tenantId = req.user!.tenantId;

  if (planId !== 'starter' && planId !== 'pro') {
    res.status(400).json({ error: 'planId must be "starter" or "pro"' });
    return;
  }

  const priceId = planId === 'starter'
    ? process.env.STRIPE_STARTER_PRICE_ID
    : process.env.STRIPE_PRO_PRICE_ID;

  if (!priceId) {
    res.status(500).json({ error: `STRIPE_${planId.toUpperCase()}_PRICE_ID not configured` });
    return;
  }

  const tenantResult = await query<{ plan: string; stripe_customer_id: string | null; billing_email: string | null }>(
    'SELECT plan, stripe_customer_id, billing_email FROM tenants WHERE id = $1',
    [tenantId]
  );
  const tenant = tenantResult.rows[0];

  if (!stripe) {
    res.status(503).json({ error: 'Billing not configured — set STRIPE_SECRET_KEY' });
    return;
  }

  let customerId = tenant.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: tenant.billing_email ?? undefined,
      metadata: { tenantId },
    });
    customerId = customer.id;
    await query('UPDATE tenants SET stripe_customer_id = $1 WHERE id = $2', [customerId, tenantId]);
  }

  const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/admin/billing?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/admin/billing`,
    metadata: { tenantId, planId },  // planId needed so webhook can update plan column
  });

  res.json({ url: session.url });
});

// POST /api/billing/portal — create Stripe Customer Portal session
router.post('/portal', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;

  const tenantResult = await query<{ stripe_customer_id: string | null }>(
    'SELECT stripe_customer_id FROM tenants WHERE id = $1',
    [tenantId]
  );
  const customerId = tenantResult.rows[0]?.stripe_customer_id;

  if (!customerId) {
    res.status(400).json({ error: 'No active Stripe customer. Please subscribe first.' });
    return;
  }

  if (!stripe) {
    res.status(503).json({ error: 'Billing not configured — set STRIPE_SECRET_KEY' });
    return;
  }

  const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/admin/billing`,
  });

  res.json({ url: portalSession.url });
});

export default router;
