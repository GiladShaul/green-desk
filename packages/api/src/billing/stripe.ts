import Stripe from 'stripe';
import { logger } from '../logger';

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret && process.env.NODE_ENV !== 'test') {
  logger.warn('STRIPE_SECRET_KEY not set — billing endpoints will return 503');
}

export const stripe = secret
  ? new Stripe(secret, { apiVersion: '2026-02-25.clover' })
  : null;
