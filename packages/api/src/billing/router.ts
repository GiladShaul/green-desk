import { Router, Response, NextFunction } from 'express';
import { query } from '../db';
import { requireAuth, AuthRequest } from '../auth/middleware';
import { getPlanLimits } from './plans';

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

export default router;
