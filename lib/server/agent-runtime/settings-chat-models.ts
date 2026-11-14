/**
 * Chat models the model settings offer, as the Pro Workbench driver list.
 *
 * The workbench picker used to offer only the local CLI transports
 * (`opencode`, `opencode-go`, `codex`, `antigravity`), whose models are
 * discovered live from the signed-in CLIs. A deployment that configures an
 * HTTP provider in Settings (a keyed Gemini endpoint, Coarena, Ollama, a
 * workspace provider, …) could not choose any of those models for the
 * workbench, even though the agent runtime drives a configured chat model over
 * HTTP exactly like the `agent` slot does.
 *
 * This module lists those models from the same effective view Settings renders:
 * the deployment's providers (`openmaic.yml`) plus the request owner's
 * workspace providers, chat capability only, and only models that can call
 * tools (the driver contract). CLI providers stay out: they already come from
 * live discovery, and listing them twice would duplicate their groups.
 */
import { PROVIDERS } from '@/lib/ai/providers';
import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { readWorkspaceModelConfig } from '@/lib/persistence/workspace-model-config';
import { modelSettingsView, type ModelSettingsView } from '@/lib/server/model-config/settings';
import type { ProviderId } from '@/lib/types/provider';

import { DRIVER_PROVIDERS } from './opencode-models';

/** One HTTP chat model the settings offer, ready for the workbench picker. */
export interface SettingsChatModel {
  provider: string;
  id: string;
  providerName: string;
  /** The provider's logo, when the registry knows one. */
  icon?: string;
  name: string;
  modelString: string;
}

const CLI_PROVIDER_IDS = new Set<string>(DRIVER_PROVIDERS);

function iconFor(registryId: string | undefined): string | undefined {
  if (!registryId) return undefined;
  const icon = PROVIDERS[registryId as ProviderId]?.icon;
  return typeof icon === 'string' && icon ? icon : undefined;
}

/**
 * HTTP chat models in one settings view: one entry per provider/model, in the
 * provider order the settings show. A model the catalogue marks as unable to
 * call tools is left out — the agent slot's own requirement — and an unknown
 * capability is kept (the runtime reports a real refusal if the endpoint
 * agrees).
 */
export function settingsChatModelsFromView(view: ModelSettingsView): SettingsChatModel[] {
  const out: SettingsChatModel[] = [];
  const seen = new Set<string>();
  for (const provider of view.providers) {
    if (CLI_PROVIDER_IDS.has(provider.id)) continue;
    const chat = provider.capabilities.chat;
    if (!chat) continue;
    for (const model of chat.models) {
      if (!model.id || model.capabilities?.tools === false) continue;
      const modelString = `${provider.id}:${model.id}`;
      if (seen.has(modelString)) continue;
      seen.add(modelString);
      const item: SettingsChatModel = {
        provider: provider.id,
        id: model.id,
        providerName: provider.presetName,
        name: model.name || model.id,
        modelString,
      };
      const icon = iconFor(chat.registryId);
      if (icon) item.icon = icon;
      out.push(item);
    }
  }
  return out;
}

/**
 * The effective settings view for an owner: the deployment's providers plus the
 * owner's workspace providers. A missing owner or an unreadable row degrades to
 * the deployment view instead of failing the picker.
 */
export async function readSettingsModelView(ownerId: string | null): Promise<ModelSettingsView> {
  if (!ownerId || !isServerPersistenceConfigured()) return modelSettingsView(null);
  try {
    const pool = (await getServerPersistenceProvider(process.env.DATABASE_URL ?? '')).pool;
    return modelSettingsView(await readWorkspaceModelConfig(pool, ownerId));
  } catch {
    return modelSettingsView(null);
  }
}

/** {@link settingsChatModelsFromView} for one owner's effective settings. */
export async function listSettingsChatModels(
  ownerId: string | null = null,
): Promise<SettingsChatModel[]> {
  return settingsChatModelsFromView(await readSettingsModelView(ownerId));
}

/**
 * Whether a `provider:model` string is one of the settings' HTTP chat models.
 * CLI transport strings are refused: they belong to the live-discovery path,
 * which decides usability per signed-in account.
 */
export async function isSettingsChatModel(
  modelString: string,
  ownerId: string | null = null,
): Promise<boolean> {
  const colon = modelString.indexOf(':');
  if (colon <= 0 || colon === modelString.length - 1) return false;
  const provider = modelString.slice(0, colon);
  if (CLI_PROVIDER_IDS.has(provider)) return false;
  const models = await listSettingsChatModels(ownerId);
  return models.some((model) => model.modelString === modelString);
}
