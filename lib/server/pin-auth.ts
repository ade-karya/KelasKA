/**
 * Server-side PIN Authentication
 *
 * Loads PIN users from env vars (PIN_1_* through PIN_20_*).
 * Validates PINs, creates/verifies HMAC-signed session tokens,
 * and resolves per-PIN provider configs for each service.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { createLogger } from '@/lib/logger';

const log = createLogger('PinAuth');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PinServiceType = 'llm' | 'image' | 'video' | 'tts' | 'asr' | 'web_search';

export interface PinServiceConfig {
  provider: string;
  model?: string;
  apiKey: string;
  baseUrl?: string;
}

export interface PinUser {
  index: number;
  code: string;
  name: string;
  /** Default UI language (locale code, e.g. 'id-ID', 'en-US', 'ar-SA') */
  defaultLanguage?: string;
  /**
   * Service configs per type. LLM supports multiple providers (array).
   * Other services currently have at most one entry.
   */
  services: Record<PinServiceType, PinServiceConfig[]>;
}

export interface PinSession {
  index: number;
  name: string;
}

// ---------------------------------------------------------------------------
// ENV loading
// ---------------------------------------------------------------------------

const SERVICE_KEYS: { service: PinServiceType; envKey: string }[] = [
  { service: 'llm', envKey: 'LLM' },
  { service: 'image', envKey: 'IMAGE' },
  { service: 'video', envKey: 'VIDEO' },
  { service: 'tts', envKey: 'TTS' },
  { service: 'asr', envKey: 'ASR' },
  { service: 'web_search', envKey: 'WEB_SEARCH' },
];

/** Max number of additional provider slots per service (LLM2, LLM3, …) */
const MAX_EXTRA_SLOTS = 5;

function loadPinUser(index: number): PinUser | null {
  const prefix = `PIN_${index}`;
  const code = process.env[`${prefix}_CODE`];
  if (!code) return null;

  const name = process.env[`${prefix}_NAME`] || `User ${index}`;
  const defaultLanguage = process.env[`${prefix}_DEFAULT_LANGUAGE`] || undefined;

  const services = {} as Record<PinServiceType, PinServiceConfig[]>;
  for (const { service, envKey } of SERVICE_KEYS) {
    const configs: PinServiceConfig[] = [];

    // Primary slot: PIN_X_LLM_PROVIDER, PIN_X_IMAGE_PROVIDER, etc.
    const primaryProvider = process.env[`${prefix}_${envKey}_PROVIDER`] || '';
    const primaryApiKey = process.env[`${prefix}_${envKey}_API_KEY`] || '';
    if (primaryProvider || primaryApiKey) {
      configs.push({
        provider: primaryProvider,
        model: process.env[`${prefix}_${envKey}_MODEL`] || undefined,
        apiKey: primaryApiKey,
        baseUrl: process.env[`${prefix}_${envKey}_BASE_URL`] || undefined,
      });
    }

    // Extra slots: PIN_X_LLM2_PROVIDER, PIN_X_LLM3_PROVIDER, etc.
    for (let slot = 2; slot <= MAX_EXTRA_SLOTS + 1; slot++) {
      const slotKey = `${envKey}${slot}`;
      const slotProvider = process.env[`${prefix}_${slotKey}_PROVIDER`] || '';
      const slotApiKey = process.env[`${prefix}_${slotKey}_API_KEY`] || '';
      if (!slotProvider && !slotApiKey) continue;
      configs.push({
        provider: slotProvider,
        model: process.env[`${prefix}_${slotKey}_MODEL`] || undefined,
        apiKey: slotApiKey,
        baseUrl: process.env[`${prefix}_${slotKey}_BASE_URL`] || undefined,
      });
    }

    services[service] = configs;
  }

  return { index, code, name, defaultLanguage, services };
}

let _pinUsers: PinUser[] | null = null;

function getPinUsers(): PinUser[] {
  if (_pinUsers) return _pinUsers;
  _pinUsers = [];
  for (let i = 1; i <= 20; i++) {
    const user = loadPinUser(i);
    if (user) _pinUsers.push(user);
  }
  log.info(`Loaded ${_pinUsers.length} PIN user(s)`);
  return _pinUsers;
}

// ---------------------------------------------------------------------------
// Token signing (HMAC-SHA256)
// ---------------------------------------------------------------------------

function getSecret(): string {
  return process.env.DATA_ENCRYPTION_KEY || 'default-pin-secret-change-me';
}

/**
 * Create a signed session token for a PIN user.
 * Format: `{index}:{name}:{timestamp}:{signature}`
 */
export function createPinToken(user: PinUser): string {
  const ts = Date.now().toString(36);
  const payload = `${user.index}:${user.name}:${ts}`;
  const sig = createHmac('sha256', getSecret()).update(payload).digest('hex').slice(0, 16);
  return `${payload}:${sig}`;
}

/**
 * Verify a signed session token. Returns the PinSession or null.
 */
export function verifyPinToken(token: string): PinSession | null {
  try {
    const parts = token.split(':');
    if (parts.length < 4) return null;

    const sig = parts[parts.length - 1];
    const payload = parts.slice(0, -1).join(':');
    const expectedSig = createHmac('sha256', getSecret()).update(payload).digest('hex').slice(0, 16);

    // Timing-safe comparison
    const sigBuf = Buffer.from(sig, 'utf-8');
    const expectedBuf = Buffer.from(expectedSig, 'utf-8');
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    const index = parseInt(parts[0], 10);
    const name = parts.slice(1, -2).join(':');

    if (isNaN(index) || index < 1 || index > 20) return null;

    return { index, name };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Cookie name used for the PIN session */
export const PIN_COOKIE_NAME = 'pin_session';

/** Validate a PIN code. Returns the PinUser or null. */
export function validatePin(code: string): PinUser | null {
  const users = getPinUsers();
  return users.find((u) => u.code === code) || null;
}

/** Check if any PIN users are configured */
export function hasPinUsers(): boolean {
  return getPinUsers().length > 0;
}

/** Get a PIN user by session token */
export function getPinUserFromToken(token: string): PinUser | null {
  const session = verifyPinToken(token);
  if (!session) return null;
  const users = getPinUsers();
  return users.find((u) => u.index === session.index) || null;
}

/**
 * Get the service config for a PIN user.
 *
 * When `providerId` is supplied, returns the config whose `provider` field
 * matches that ID.  Otherwise returns the first config that has an API key.
 */
export function getPinServiceConfig(
  token: string,
  service: PinServiceType,
  providerId?: string,
): PinServiceConfig | null {
  const user = getPinUserFromToken(token);
  if (!user) return null;
  const configs = user.services[service];
  if (!configs || configs.length === 0) return null;

  if (providerId) {
    return configs.find((c) => c.provider === providerId) || null;
  }
  // Return first config with an apiKey, or just the first one
  return configs.find((c) => !!c.apiKey) || configs[0] || null;
}

/** Get all configured services info for a PIN user (no API keys exposed) */
export function getPinUserServicesPublic(token: string): Record<string, {
  provider: string;
  model?: string;
  hasApiKey: boolean;
  baseUrl?: string;
} | Array<{
  provider: string;
  model?: string;
  hasApiKey: boolean;
  baseUrl?: string;
}>> | null {
  const user = getPinUserFromToken(token);
  if (!user) return null;

  const result: Record<string, unknown> = {};
  for (const { service } of SERVICE_KEYS) {
    const configs = user.services[service];
    if (!configs || configs.length === 0) {
      result[service] = { provider: '', hasApiKey: false };
      continue;
    }
    if (configs.length === 1) {
      const cfg = configs[0];
      result[service] = {
        provider: cfg.provider,
        model: cfg.model,
        hasApiKey: !!cfg.apiKey,
        baseUrl: cfg.baseUrl,
      };
    } else {
      // Multiple configs — return as array
      result[service] = configs.map((cfg) => ({
        provider: cfg.provider,
        model: cfg.model,
        hasApiKey: !!cfg.apiKey,
        baseUrl: cfg.baseUrl,
      }));
    }
  }
  return result as Record<string, {
    provider: string;
    model?: string;
    hasApiKey: boolean;
    baseUrl?: string;
  } | Array<{
    provider: string;
    model?: string;
    hasApiKey: boolean;
    baseUrl?: string;
  }>>;
}

/** Get default language for a PIN user (if configured) */
export function getPinUserDefaultLanguage(token: string): string | undefined {
  const user = getPinUserFromToken(token);
  return user?.defaultLanguage;
}

/** List all PIN users (public info only) */
export function listPinUsersPublic(): { index: number; name: string }[] {
  return getPinUsers().map((u) => ({ index: u.index, name: u.name }));
}

/**
 * Read the PIN token from a request's cookies.
 */
export function getPinTokenFromRequest(req: Request): string | null {
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${PIN_COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}
