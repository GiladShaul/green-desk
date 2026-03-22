import { Request, Response } from 'express';
import { stripe } from './stripe';
import { query } from '../db';

export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    res.status(503).json({ error: 'Billing not configured' });
    return;
  }

  let event: ReturnType<typeof stripe.webhooks.constructEvent>;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig as string, webhookSecret);
  } catch (err) {
    res.status(400).json({ error: `Webhook signature verification failed: ${(err as Error).message}` });
    return;
  }

  const data = event.data.object as unknown as Record<string, unknown>;

  switch (event.type) {
    case 'checkout.session.completed': {
      const meta = data.metadata as Record<string, string> | undefined;
      const tenantId = meta?.tenantId;
      const planId = meta?.planId;
      const subscriptionId = data.subscription as string;
      const customerId = data.customer as string;
      if (tenantId && planId) {
        await query(
          'UPDATE tenants SET stripe_subscription_id = $1, stripe_customer_id = $2, plan = $3 WHERE id = $4',
          [subscriptionId, customerId, planId, tenantId]
        );
      }
      break;
    }

    case 'invoice.paid': {
      const subscriptionId = data.subscription as string;
      const lines = data.lines as { data: Array<{ period: { end: number } }> } | undefined;
      const periodEnd = lines?.data[0]?.period?.end;
      if (subscriptionId && periodEnd) {
        const periodEndDate = new Date(periodEnd * 1000).toISOString();
        await query(
          'UPDATE tenants SET current_period_end = $1 WHERE stripe_subscription_id = $2',
          [periodEndDate, subscriptionId]
        );
      }
      break;
    }

    case 'invoice.payment_failed': {
      console.warn(`[billing] invoice.payment_failed for subscription: ${data.subscription}`);
      break;
    }

    case 'customer.subscription.deleted': {
      const tenantId = (data.metadata as Record<string, string>)?.tenantId;
      if (tenantId) {
        await query(
          "UPDATE tenants SET plan = 'free', stripe_subscription_id = NULL, current_period_end = NULL WHERE id = $1",
          [tenantId]
        );
      }
      break;
    }

    default:
      break;
  }

  res.json({ received: true });
}
