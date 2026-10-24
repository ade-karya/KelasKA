/**
 * OpenRouter $0/free pricing check — client-safe (no server imports).
 *
 * Mirrors `isZeroCostPricing` in `lib/server/model-fetch.ts`. Per
 * https://openrouter.ai/docs/api_reference/overview → list-models every price
 * is a decimal USD string ("0" for free). `discount`/`overrides` are not costs
 * and are ignored. Missing pricing (custom gateways, mocks) returns true so
 * discovery keeps working off-catalog.
 */
export function isZeroCostPricingValue(
  pricing?: Record<string, string | number | null | undefined> | null,
): boolean {
  if (!pricing) return true;
  const entries = Object.entries(pricing).filter(([k]) => k !== 'discount' && k !== 'overrides');
  if (entries.length === 0) return true;
  return entries.every(([, v]) => {
    if (v === null || v === undefined || v === '') return true;
    const n = typeof v === 'number' ? v : Number(String(v).trim());
    return Number.isFinite(n) && n === 0;
  });
}

/**
 * Whether an OpenRouter image/video endpoint pricing list means $0.
 * Per `GET /{kind}/models/{id}/endpoints` each entry carries
 * `{ billable, unit, cost_usd }` — free when every `cost_usd` is 0.
 * Empty pricing (unknown shape) returns false so paid models are never
 * mistaken for free; callers that want leniency handle the empty case.
 */
export function isZeroCostEndpointPricing(
  pricing?: Array<{ cost_usd?: string | number | null }> | null,
): boolean {
  if (!pricing || pricing.length === 0) return false;
  return pricing.every((p) => {
    const v = p?.cost_usd;
    if (v === null || v === undefined || v === '') return true;
    const n = typeof v === 'number' ? v : Number(String(v).trim());
    return Number.isFinite(n) && n === 0;
  });
}
