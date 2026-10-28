// PayKit plan definitions — Free / Basic / Pro
// Prices are stored in cents; the PayKit instance in paykit.js converts them to whole units and
// syncs the resulting products to Stripe (`npx paykitjs push`), so no price id is hard-coded here.
export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    description: 'Basic access',
    price: 0,
    currency: 'usd',
    interval: 'month',
    default: true,
    features: ['Basic support', 'Community access'],
  },
  basic: {
    id: 'basic',
    name: 'Basic',
    description: 'For individuals',
    price: 1900, // $19.00 in cents
    currency: 'usd',
    interval: 'month',
    features: ['Email support', 'Up to 3 projects'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    description: 'For teams',
    price: 4900, // $49.00 in cents
    currency: 'usd',
    interval: 'month',
    features: ['Priority support', 'Unlimited projects', 'API access'],
  },
};

export function getPlan(planId) {
  return PLANS[planId] || null;
}

export function listPlans() {
  return Object.values(PLANS);
}
