import { emailMetadata, emailPricing } from './apify-email';

// Same public metadata as the backend tests; never calls Apify or uses user keys.
export function emailPlan(overrides: Record<string, unknown> = {}) {
  return {
    planId: 'a'.repeat(64), actor: 'benthepythondev/google-maps-email-scraper', actorId: emailMetadata.id,
    blocked: false, blockedReason: null, unresolvedUrlCount: 0,
    coverage: { requireEmail: true, email: 'Email publié sur le site, non testé pour la délivrabilité' },
    pricing: { model: emailPricing.pricingModel, currency: 'USD', events: emailPricing.pricingPerEvent.actorChargeEvents, effectiveAt: emailPricing.startedAt, source: 'https://api.apify.com/v2/acts/benthepythondev~google-maps-email-scraper', accountTierVerified: false },
    ...overrides,
  };
}
