import { businessMetadata, businessPricing } from './apify-business';

// Anonymous official GET snapshot shared with backend tests; no account or paid runs.
export function businessPlan(overrides: Record<string, unknown> = {}) {
  return {
    planId: 'a'.repeat(64), actor: 'benthepythondev/google-maps-business-scraper', actorId: businessMetadata.id,
    blocked: false, blockedReason: null, unresolvedUrlCount: 0,
    coverage: { requireEmail: false, scrapeContacts: true, email: 'Email publié selon disponibilité, non testé pour la délivrabilité' },
    pricing: { model: businessPricing.pricingModel, currency: 'USD', events: businessPricing.pricingPerEvent.actorChargeEvents, effectiveAt: businessPricing.startedAt, source: 'https://api.apify.com/v2/acts/benthepythondev~google-maps-business-scraper', accountTierVerified: false },
    ...overrides,
  };
}
