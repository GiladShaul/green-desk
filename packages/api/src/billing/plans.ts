import { query } from '../db';

export interface PlanLimits {
  maxUsers: number | null;   // null = unlimited
  maxFloors: number | null;  // null = unlimited
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free:    { maxUsers: 5,    maxFloors: 1 },
  starter: { maxUsers: 25,   maxFloors: null },
  pro:     { maxUsers: null, maxFloors: null },
};

export function getPlanLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS['free'];
}

export async function getTenantPlanLimits(tenantId: string): Promise<{
  plan: string;
  limits: PlanLimits;
  seatsLimit: number | null;
}> {
  const result = await query<{ plan: string; plan_seats_limit: number | null }>(
    'SELECT plan, plan_seats_limit FROM tenants WHERE id = $1',
    [tenantId]
  );
  const row = result.rows[0];
  const plan = row?.plan ?? 'free';
  const limits = getPlanLimits(plan);
  return { plan, limits, seatsLimit: row?.plan_seats_limit ?? limits.maxUsers };
}
