/**
 * The providers a new account is guided through in the bring-your-own-key
 * onboarding (`/onboarding/api-key`) and in the admin console's "set key"
 * dialog. Plain data, client-safe: the wizard renders it and the admin route
 * validates against it, so the two can never drift apart.
 *
 * `preset` doubles as the workspace provider id the onboarding stores the key
 * under (`google`, `openrouter`, `coarena`, `crowllm`), which keeps repeated
 * onboarding runs idempotent: the same account ends up with one provider per
 * preset instead of an ever-growing pile of `openrouter-2`, `openrouter-3`…
 *
 * Model ids must exist in `PROVIDERS[registryId].models` (lib/ai/providers.ts)
 * and, for `llm`/`agent`, support tool calling — every id below does.
 */
export interface OnboardingProvider {
  /**
   * The workspace provider id the key is stored under. Deployments declare
   * their own provider ids (`google` on every Colab/Kaggle preset, for one),
   * and a workspace provider may not reuse one of those, so onboarding keys
   * live under their own stable ids instead of colliding with — or shadowing
   * — the deployment's providers. Stable per preset, which keeps repeated
   * onboarding runs idempotent.
   */
  readonly id: string;
  /** The preset (and registry entry) serving the calls; the id stays free-form. */
  readonly preset: string;
  /** The product's display name. */
  readonly name: string;
  /** Logo under /public/logos. */
  readonly logo: string;
  /** Where a person creates the key. */
  readonly signupUrl: string;
  /** Extra documentation worth linking under the steps. */
  readonly docsUrl: string;
  /** The chat model verified and assigned to `llm`/`agent` by default. */
  readonly defaultModel: string;
}

export const ONBOARDING_PROVIDERS: readonly OnboardingProvider[] = [
  {
    id: 'onboarding-google',
    preset: 'google',
    name: 'Gemini',
    logo: '/logos/gemini.svg',
    signupUrl: 'https://aistudio.google.com/apikey',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/api-key',
    // 500 requests/day on the free tier; the flash models with 20/day are a
    // poorer fit for a classroom, so this is the deliberate default.
    defaultModel: 'gemini-3.5-flash-lite',
  },
  {
    id: 'onboarding-openrouter',
    preset: 'openrouter',
    name: 'OpenRouter',
    logo: '/logos/openrouter.svg',
    signupUrl: 'https://openrouter.ai/keys',
    docsUrl: 'https://openrouter.ai/models?max_price=0',
    defaultModel: 'deepseek/deepseek-v4-flash',
  },
  {
    id: 'onboarding-coarena',
    preset: 'coarena',
    name: 'Coarena',
    logo: '/logos/coarena.svg',
    signupUrl: 'https://coarena.ai',
    docsUrl: 'https://coarena.ai/api',
    defaultModel: 'deepseek-v4-1-flash-1017',
  },
  {
    id: 'onboarding-crowllm',
    preset: 'crowllm',
    name: 'CrowLLM',
    logo: '/logos/crowllm.svg',
    signupUrl: 'https://crowllm.com',
    docsUrl: 'https://crowllm.com/v1/models',
    defaultModel: 'gpt-5.6-sol:free',
  },
];

const BY_PRESET = new Map(ONBOARDING_PROVIDERS.map((provider) => [provider.preset, provider]));

export function onboardingProvider(preset: string): OnboardingProvider | undefined {
  return BY_PRESET.get(preset);
}

/** Whether a preset may carry the user's (or the admin's) chat key. */
export function isOnboardingPreset(preset: unknown): preset is string {
  return typeof preset === 'string' && BY_PRESET.has(preset);
}

/** The default chat model for an onboarding preset, or undefined for an unknown one. */
export function onboardingDefaultModel(preset: string): string | undefined {
  return BY_PRESET.get(preset)?.defaultModel;
}
