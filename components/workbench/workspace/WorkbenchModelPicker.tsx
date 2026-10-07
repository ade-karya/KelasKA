'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ModelPicker } from '@/components/settings/model-picker';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { ThinkingCapability, ThinkingConfig } from '@/lib/types/provider';

interface AgentModelItem {
  provider: string;
  id: string;
  modelString: string;
  name: string;
  thinking?: ThinkingCapability;
}

interface AgentModelsResponse {
  success?: boolean;
  active?: string;
  thinking?: ThinkingConfig;
  models?: AgentModelItem[];
}

const STORAGE_KEY = 'openmaic-workbench-model';
const STORAGE_THINKING_KEY = 'openmaic-workbench-model-thinking';

const PROVIDER_GROUP_NAMES: Record<string, string> = {
  opencode: 'OpenCode CLI',
  'opencode-go': 'OpenCode Go',
};

/** "Muse Spark 1.3 Free (Zen)" -> "Muse Spark 1.3 Free". */
function displayNameOf(model: Pick<AgentModelItem, 'id' | 'name'>): string {
  const name = (model.name || '').trim();
  if (name && name !== model.id) return name.replace(/\s*\((Zen|Go)\)\s*$/i, '').trim() || name;
  return prettifyId(model.id);
}

/** "muse-spark-1.3-contributor-free" -> "Muse Spark 1.3 Contributor". */
function prettifyId(id: string): string {
  return id
    .replace(/-contributor-free$/i, '')
    .replace(/-free$/i, '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** "opencode-go:gpt-6-luna" -> { providerId: "opencode-go", modelId: "gpt-6-luna" }. */
function splitModelString(modelString: string): { providerId: string; modelId: string } {
  const lower = modelString.toLowerCase();
  if (lower.startsWith('opencode-go:') || lower.startsWith('opencode-go/')) {
    return { providerId: 'opencode-go', modelId: modelString.slice('opencode-go:'.length) };
  }
  return { providerId: 'opencode', modelId: modelString.replace(/^opencode[/:]/i, '') };
}

/**
 * Pemilih model Pro Workbench — memakai ulang `ModelPicker` chat classic
 * (Popover + kolom cari fixed + daftar scroll + ring violet) agar tampilan
 * dan perilaku identik.
 *
 * Membaca SEMUA model CLI yang diaktifkan installer (OPENCODE_MODELS +
 * OPENCODE_GO_MODELS via GET /api/agent/models, dua grup provider) dan
 * memilih aktif via POST (data/agent-driver-model.json, berlaku untuk run
 * berikutnya tanpa restart). Varian thinking per model dipilih lewat kontrol
 * inline di baris terpilih (POST {model, thinking}). Dipakai di header chat
 * pane dan home composer — satu komponen untuk seluruh halaman /workspace.
 */
export function WorkbenchModelPicker() {
  const { t } = useI18n();
  const [models, setModels] = useState<AgentModelItem[]>([]);
  const [active, setActive] = useState<string>('');
  const [thinking, setThinking] = useState<ThinkingConfig | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/agent/models', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as AgentModelsResponse;
      const list = Array.isArray(body.models) ? body.models : [];
      setModels(list);
      const serverActive = typeof body.active === 'string' ? body.active : '';
      if (serverActive) {
        setActive(serverActive);
        try {
          localStorage.setItem(STORAGE_KEY, serverActive);
        } catch {
          /* abaikan */
        }
      }
      if (body.thinking && typeof body.thinking === 'object') {
        setThinking(body.thinking);
        try {
          localStorage.setItem(STORAGE_THINKING_KEY, JSON.stringify(body.thinking));
        } catch {
          /* abaikan */
        }
      }
      if (list.length === 0) setLoadError(t('workspace.modelPicker.empty'));
    } catch {
      setLoadError(t('workspace.modelPicker.loadFailed'));
      try {
        const cached = localStorage.getItem(STORAGE_KEY);
        if (cached) setActive(cached);
        const cachedThinking = localStorage.getItem(STORAGE_THINKING_KEY);
        if (cachedThinking) setThinking(JSON.parse(cachedThinking) as ThinkingConfig);
      } catch {
        /* abaikan */
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // Label instan dari cache agar header tidak berkedip, lalu sinkronkan.
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) setActive(cached);
      const cachedThinking = localStorage.getItem(STORAGE_THINKING_KEY);
      if (cachedThinking) setThinking(JSON.parse(cachedThinking) as ThinkingConfig);
    } catch {
      /* abaikan */
    }
    void load();
  }, [load]);

  const save = useCallback(
    async (modelString: string, nextThinking: ThinkingConfig | undefined) => {
      setSaving(true);
      try {
        const res = await fetch('/api/agent/models', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: modelString, thinking: nextThinking ?? undefined }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          active?: string;
          thinking?: ThinkingConfig;
          error?: string;
          message?: string;
        };
        if (!res.ok) {
          throw new Error(
            body.message ??
              body.error ??
              t('workspace.modelPicker.selectFailed', { status: res.status }),
          );
        }
        const next = typeof body.active === 'string' ? body.active : modelString;
        setActive(next);
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          /* abaikan */
        }
        if (body.thinking && typeof body.thinking === 'object') {
          setThinking(body.thinking);
          try {
            localStorage.setItem(STORAGE_THINKING_KEY, JSON.stringify(body.thinking));
          } catch {
            /* abaikan */
          }
        } else if (nextThinking === undefined) {
          setThinking(undefined);
          try {
            localStorage.removeItem(STORAGE_THINKING_KEY);
          } catch {
            /* abaikan */
          }
        }
        return next;
      } finally {
        setSaving(false);
      }
    },
    [t],
  );

  const choose = useCallback(
    async (modelString: string) => {
      if (!modelString || modelString === active || saving) return;
      try {
        // Ganti model: pertahankan varian thinking saat ini (server
        // menormalkannya terhadap capability model baru).
        const next = await save(modelString, thinking);
        const picked = models.find((m) => m.modelString === next);
        toast.success(
          t('workspace.modelPicker.activeToast', {
            name: picked ? displayNameOf(picked) : next,
          }),
        );
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t('workspace.modelPicker.selectFailedFallback'),
        );
      }
    },
    [active, saving, models, thinking, save, t],
  );

  const changeThinking = useCallback(
    async (config: ThinkingConfig | undefined) => {
      if (!active || saving) return;
      try {
        await save(active, config);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t('workspace.modelPicker.thinkingSaveFailed'),
        );
      }
    },
    [active, saving, save, t],
  );

  const activeSplit = active ? splitModelString(active) : null;

  const groups = (['opencode', 'opencode-go'] as const)
    .map((providerId) => ({
      id: providerId,
      name: PROVIDER_GROUP_NAMES[providerId] ?? providerId,
      models: models
        .filter((m) => (m.provider || 'opencode') === providerId)
        .map((m) => ({ id: m.id, name: displayNameOf(m), thinking: m.thinking })),
    }))
    .filter((g) => g.models.length > 0);

  return (
    <ModelPicker
      groups={groups}
      // Resolusi nama/badge ditangani ModelPicker (grup provider eksak dulu,
      // lalu lintas-grup bila id sama di dua provider).
      value={activeSplit}
      onSelect={(providerId, modelId) => void choose(`${providerId}:${modelId}`)}
      placeholder={
        loading
          ? t('workspace.modelPicker.loading')
          : loadError
            ? t('workspace.modelPicker.loadError')
            : t('workspace.modelPicker.choose')
      }
      disabled={loading || saving}
      thinkingConfig={thinking}
      onThinkingChange={(config) => void changeThinking(config)}
      ariaLabel={t('workspace.modelPicker.ariaLabel')}
      className="w-auto min-w-0 max-w-full shrink-0"
      t={t}
    />
  );
}
