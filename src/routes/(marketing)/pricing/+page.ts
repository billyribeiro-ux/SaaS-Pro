// Pricing page pulls live Stripe data per request and exposes a form action.
// Actions can't be prerendered, and stale prices are a real risk if we tried,
// so SSR only.
export const prerender = false;
