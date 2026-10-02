'use client';

/**
 * Live OpenRouter model list for the image/video settings pickers.
 *
 * Every other media provider ships a fixed `models` array. OpenRouter's catalog
 * is large and moves, so the picker reads OpenRouter's public catalog directly
 * instead of a shortlist baked in here. The catalog supports browser CORS and
 * does not require authentication, so a server proxy would only add another
 * deployment function and another credential boundary. Returns `fallback`
 * untouched for every other provider, so callers use it as a drop-in for
 * `currentProvider.models`.
 *
 * On any failure the seeded registry list stays in place — a picker with three
 * usable entries beats an empty one.
 */
import { useEffect, useState } from 'react';

import { createLogger } from '@/lib/logger';

import { openRouterBaseUrl } from './adapters/openrouter-image-adapter';
import { isZeroCostPricingValue } from './openrouter-free';
import type { ImageModelInfo } from './types';

const log = createLogger('OpenRouterModels');

export function useOpenRouterModels(
  kind: 'image' | 'video',
  isOpenRouter: boolean,
  fallback: ImageModelInfo[],
  apiKey?: string,
  baseUrl?: string,
): { models: ImageModelInfo[] } {
  const [live, setLive] = useState<ImageModelInfo[] | null>(null);

  useEffect(() => {
    if (!isOpenRouter) return;
    let cancelled = false;
    const catalogBaseUrl = openRouterBaseUrl(baseUrl);
    const isOfficialCatalog = catalogBaseUrl === 'https://openrouter.ai/api/v1';
    const headers: Record<string, string> =
      !isOfficialCatalog && apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    // Image/video catalog (`/{kind}s/models`, `{ id, name }`) joined with the
    // unified pricing source (`/models?output_modalities={kind}`, decimal USD
    // strings per https://openrouter.ai/docs/api_reference/overview). Only $0
    // entries are kept; without pricing data the catalog is kept as-is so
    // custom gateways keep working.
    const load = async () => {
      try {
        const catalogRes = await fetch(`${catalogBaseUrl}/${kind}s/models`, { headers });
        const catalogData = await catalogRes.json().catch(() => null);
        if (cancelled) return;
        if (!catalogRes.ok || !Array.isArray(catalogData?.data)) {
          log.warn(`Could not load OpenRouter ${kind} models; keeping the seeded list`, catalogData);
          return;
        }
        let pricingById = new Map<string, Record<string, unknown>>();
        let pricingNameById = new Map<string, string>();
        try {
          const pricingRes = await fetch(
            `${catalogBaseUrl}/models?output_modalities=${kind}&limit=1000`,
            { headers },
          );
          const pricingData = await pricingRes.json().catch(() => null);
          if (!cancelled && pricingRes.ok && Array.isArray(pricingData?.data)) {
            for (const m of pricingData.data as Array<{
              id?: string;
              name?: string;
              pricing?: Record<string, string | number | null | undefined>;
            }>) {
              const id = (m.id || '').trim();
              if (!id) continue;
              if (m.pricing) pricingById.set(id, m.pricing);
              if (typeof m.name === 'string' && m.name.trim()) {
                pricingNameById.set(id, m.name.trim());
              }
            }
          }
        } catch {
          // Pricing lookup is best-effort; the catalog below stays unfiltered.
        }
        if (cancelled) return;
        const hasPricing = pricingById.size > 0;
        const models = (catalogData.data as Array<{ id?: string; slug?: string; name?: string }>)
          .map((model) => {
            const id = (model.id || model.slug || '').trim();
            const name = pricingNameById.get(id) || (model.name || '').trim() || id;
            return { id, name, pricing: pricingById.get(id) };
          })
          .filter((model) => model.id)
          .filter((model) =>
            !hasPricing || !model.pricing
              ? true
              : isZeroCostPricingValue(
                  model.pricing as Record<string, string | number | null | undefined>,
                ),
          )
          .map(({ id, name }) => ({ id, name }))
          .filter((model: ImageModelInfo) => model.id)
          .sort((a: ImageModelInfo, b: ImageModelInfo) => a.name.localeCompare(b.name));
        setLive(models);
      } catch (err) {
        if (!cancelled) log.warn(`OpenRouter ${kind} model fetch failed`, err);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [kind, isOpenRouter, apiKey, baseUrl]);

  return { models: isOpenRouter && live ? live : fallback };
}
