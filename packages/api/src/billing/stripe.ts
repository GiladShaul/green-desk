import Stripe from 'stripe';

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret && process.env.NODE_ENV !== 'test') {
  throw new Error('STRIPE_SECRET_KEY is required');
}

export const stripe = new Stripe(secret ?? 'sk_test_placeholder', {
  apiVersion: '2024-06-20',
});
