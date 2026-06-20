/**
 * Admin Dashboard Type Definitions
 */

/** Provider categories that can be configured per user */
export type ProviderCategory =
  | 'llm'
  | 'image'
  | 'video'
  | 'tts'
  | 'asr'
  | 'pdf'
  | 'web_search';

/** User managed by admin */
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Per-user provider configuration */
export interface UserProviderConfig {
  id: string;
  user_id: string;
  category: ProviderCategory;
  provider_id: string;
  api_key: string;
  base_url: string;
  models: string[];
  is_enabled: boolean;
  extra_config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Create/update user payload */
export interface AdminUserPayload {
  email: string;
  name: string;
  role?: 'admin' | 'user';
  is_active?: boolean;
}

/** Create/update provider config payload */
export interface ProviderConfigPayload {
  category: ProviderCategory;
  provider_id: string;
  api_key?: string;
  base_url?: string;
  models?: string[];
  is_enabled?: boolean;
  extra_config?: Record<string, unknown>;
}

/** User with provider config count summary */
export interface AdminUserWithStats extends AdminUser {
  config_count: number;
}

/** Category display metadata */
export const PROVIDER_CATEGORIES: {
  id: ProviderCategory;
  label: string;
  icon: string;
}[] = [
  { id: 'llm', label: 'LLM', icon: 'Box' },
  { id: 'image', label: 'Pembuatan Gambar', icon: 'Image' },
  { id: 'video', label: 'Pembuatan Video', icon: 'Film' },
  { id: 'tts', label: 'Teks ke Suara', icon: 'Volume2' },
  { id: 'asr', label: 'Pengenalan Suara', icon: 'Mic' },
  { id: 'pdf', label: 'Penguraian PDF', icon: 'FileText' },
  { id: 'web_search', label: 'Pencarian Web', icon: 'Search' },
];
