import { getProvider, parseModelString } from '@/lib/ai/providers';
import { isServerConfiguredProvider } from '@/lib/server/provider-config';

/**
 * Validate a per-session driver model pin (`provider:model`, the Pro
 * workbench model pick). Returns the canonical string, or an error message
 * for a 400.
 *
 * Only server-managed providers are accepted: client secrets must never
 * travel into durable session rows, so a client-keyed provider cannot be
 * pinned per session (it stays usable through the operator routes and the
 * main-model headers of the single-shot generation routes).
 */
export function validateSessionModel(raw: unknown): { model?: string; error?: string } {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'string' || !raw.trim()) {
    return { error: 'model must be a "provider:model" string' };
  }
  const modelString = raw.trim();
  if (modelString.length > 256) {
    return { error: 'model is too long' };
  }
  let providerId: string;
  let modelId: string;
  try {
    ({ providerId, modelId } = parseModelString(modelString));
  } catch {
    return { error: `model ${JSON.stringify(modelString)} is not a valid "provider:model" string` };
  }
  // parseModelString defaults bare ids to openai — the driver must never route
  // to the wrong provider silently, so the prefix is mandatory here.
  if (!modelString.includes(':') || !modelId) {
    return { error: `model ${JSON.stringify(modelString)} needs an explicit provider prefix` };
  }
  if (!getProvider(providerId as Parameters<typeof getProvider>[0])) {
    return { error: `model provider ${JSON.stringify(providerId)} is not registered` };
  }
  if (!isServerConfiguredProvider('providers', providerId)) {
    return {
      error: `model provider ${JSON.stringify(providerId)} is not server-configured; per-session models need operator credentials`,
    };
  }
  return { model: `${providerId}:${modelId}` };
}
