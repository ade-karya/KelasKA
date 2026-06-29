import { promises as fs } from 'fs';
import path from 'path';

export interface ProviderConfig {
  activeProviders: string[]; // e.g. ['openai', 'google', 'anthropic']
  featureToggles: {
    enableVideoGeneration: boolean;
    enableImageGeneration: boolean;
    enablePdfParsing: boolean;
    enableWebSearch: boolean;
  };
  apiKeys: Record<string, string>; // e.g. { openai: 'sk-...', google: 'AIza...' }
}

const DEFAULT_CONFIG: ProviderConfig = {
  activeProviders: ['google'], 
  featureToggles: {
    enableVideoGeneration: true,
    enableImageGeneration: true,
    enablePdfParsing: true,
    enableWebSearch: true,
  },
  apiKeys: {},
};

const DATA_FILE = path.join(process.cwd(), 'data', 'provider-config.json');

async function ensureDataFile(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    try {
      await fs.access(DATA_FILE);
    } catch {
      await fs.writeFile(DATA_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
    }
  } catch (err) {
    console.error('Failed to ensure provider-config.json:', err);
  }
}

export async function getProviderConfig(): Promise<ProviderConfig> {
  await ensureDataFile();
  try {
    const data = await fs.readFile(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(data) as Partial<ProviderConfig>;
    
    // Merge with defaults to ensure all fields exist
    return {
      activeProviders: parsed.activeProviders || DEFAULT_CONFIG.activeProviders,
      featureToggles: { ...DEFAULT_CONFIG.featureToggles, ...parsed.featureToggles },
      apiKeys: { ...DEFAULT_CONFIG.apiKeys, ...parsed.apiKeys },
    };
  } catch (err) {
    console.error('Error reading provider config:', err);
    return DEFAULT_CONFIG;
  }
}

export async function saveProviderConfig(config: ProviderConfig): Promise<void> {
  await ensureDataFile();
  await fs.writeFile(DATA_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Helper to get a specific API key (prefers store over process.env, or vice versa depending on logic)
 * Here, we prefer the config store. If empty, fallback to env.
 */
export async function getApiKey(provider: string, envFallbackKey?: string): Promise<string | undefined> {
  const config = await getProviderConfig();
  if (config.apiKeys[provider]) {
    return config.apiKeys[provider];
  }
  if (envFallbackKey && process.env[envFallbackKey]) {
    return process.env[envFallbackKey];
  }
  return undefined;
}
