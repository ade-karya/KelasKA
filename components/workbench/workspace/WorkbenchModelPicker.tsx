'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { KeyRound } from 'lucide-react';
import { ModelPicker } from '@/components/settings/model-picker';
import { useI18n } from '@/lib/hooks/use-i18n';
import { WorkbenchAuthDialog } from './WorkbenchAuthDialog';
import type { ThinkingCapability, ThinkingConfig } from '@/lib/types/provider';

interface AgentModelItem {
  provider: string;
  id: string;
  modelString: string;
  name: string;
  thinking?: ThinkingCapability;
  /** Display name/logo for chat models served by an HTTP provider. */
  providerName?: string;
  icon?: string;
  transport?: 'cli' | 'http';
}

interface AgentModelsResponse {
  success?: boolean;
  active?: string;
  thinking?: ThinkingConfig;
  source?: string;
  models?: AgentModelItem[];
}

const STORAGE_KEY = 'openmaic-workbench-model';
const STORAGE_THINKING_KEY = 'openmaic-workbench-model-thinking';

/** Per-conversation picks get their own cache slot so the global default is never clobbered. */
function storageKeys(sessionId: string | null): { model: string; thinking: string } {
  return sessionId
    ? {
        model: `openmaic-workbench-model:${sessionId}`,
        thinking: `openmaic-workbench-model-thinking:${sessionId}`,
      }
    : { model: STORAGE_KEY, thinking: STORAGE_THINKING_KEY };
}

const PROVIDER_GROUP_NAMES: Record<string, string> = {
  opencode: 'OpenCode',
  'opencode-go': 'OpenCode Go',
  codex: 'Codex',
  antigravity: 'Antigravity',
};

/** Local transports lead the picker; HTTP providers follow in settings order. */
const CLI_GROUP_ORDER: readonly string[] = [
  'opencode',
  'opencode-go',
  'codex',
  'antigravity',
] as const;

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

/** "google:gemini-3.5-flash-lite" -> { providerId: "google", modelId: "gemini-3.5-flash-lite" }. */
function splitModelString(modelString: string): { providerId: string; modelId: string } {
  const colon = modelString.indexOf(':');
  if (colon > 0 && colon < modelString.length - 1) {
    return { providerId: modelString.slice(0, colon), modelId: modelString.slice(colon + 1) };
  }
  const lower = modelString.toLowerCase();
  const cli = ['opencode-go', 'opencode'].find((p) => lower.startsWith(`${p}/`));
  const prefix = cli ?? 'opencode';
  return { providerId: prefix, modelId: modelString.replace(/^opencode[/:]/i, '') };
}

/**
 * Pemilih model Pro Workbench — memakai ulang `ModelPicker` chat classic
 * (Popover + kolom cari fixed + daftar scroll + ring violet) agar tampilan
 * dan perilaku identik.
 *
 * Hanya model yang benar-benar bisa dipakai akun yang login yang tampil:
 * model transport lokal selalu hasil penemuan live (`opencode models`,
 * `model/list` Codex, `agy models`), sehingga grup provider yang belum login
 * tampil kosong. Model HTTP dari pengaturan model (deployment + ruang kerja,
 * capability chat, wajib bisa tool calls) ikut tampil di bawah grup vendor-
 * nya; pemilihannya tersimpan per percakapan/global dan ditempuh lewat jalur
 * HTTP ber-key, seperti slot `agent`.
 *
 * Dua mode:
 * - tanpa `sessionId` (home composer): pilihan menjadi default untuk
 *   percakapan BARU — tersimpan global di data/agent-driver-model.json.
 * - dengan `sessionId` (chat pane): pilihan tersimpan PADA percakapan itu
 *   (agent_sessions.driver_model) dan tidak memengaruhi percakapan lain.
 *
 * Varian thinking per model dipilih lewat kontrol inline di baris terpilih.
 * Dipakai di home composer dan header chat pane — satu komponen untuk
 * seluruh halaman /workspace.
 *
 * Aksi login (OpenCode Console / Antigravity / Codex) dipasang sebagai aksi
 * footer di popover yang sama, tepat di bawah daftar model, sehingga pintu
 * masuk kredensial selalu berdampingan dengan provider yang dibukanya.
 */
export function WorkbenchModelPicker({ sessionId = null }: { sessionId?: string | null }) {
  const { t } = useI18n();
  const keys = useMemo(() => storageKeys(sessionId ?? null), [sessionId]);
  const [models, setModels] = useState<AgentModelItem[]>([]);
  const [active, setActive] = useState<string>('');
  const [thinking, setThinking] = useState<ThinkingConfig | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authConnected, setAuthConnected] = useState(false);

  // Green dot for the footer login action, seeded once on mount and kept in
  // sync by the dialog afterwards.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch('/api/agent/auth', { credentials: 'include' });
        if (!res.ok) return;
        const body = (await res.json().catch(() => ({}))) as {
          codex?: { loggedIn?: boolean };
          antigravity?: { authenticated?: boolean };
          opencode?: { authenticated?: boolean };
        };
        if (!active) return;
        setAuthConnected(
          Boolean(
            body?.antigravity?.authenticated ||
            body?.codex?.loggedIn ||
            body?.opencode?.authenticated,
          ),
        );
      } catch {
        // The login action is still reachable; the panels report real errors.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const url = sessionId
        ? `/api/agent/models?sessionId=${encodeURIComponent(sessionId)}`
        : '/api/agent/models';
      const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as AgentModelsResponse;
      const list = Array.isArray(body.models) ? body.models : [];
      setModels(list);
      const serverActive = typeof body.active === 'string' ? body.active : '';
      if (serverActive) {
        setActive(serverActive);
        try {
          localStorage.setItem(keys.model, serverActive);
        } catch {
          /* abaikan */
        }
      }
      if (body.thinking && typeof body.thinking === 'object') {
        setThinking(body.thinking);
        try {
          localStorage.setItem(keys.thinking, JSON.stringify(body.thinking));
        } catch {
          /* abaikan */
        }
      }
      if (list.length === 0) setLoadError(t('workspace.modelPicker.empty'));
    } catch {
      setLoadError(t('workspace.modelPicker.loadFailed'));
      try {
        const cached = localStorage.getItem(keys.model);
        if (cached) setActive(cached);
        const cachedThinking = localStorage.getItem(keys.thinking);
        if (cachedThinking) setThinking(JSON.parse(cachedThinking) as ThinkingConfig);
      } catch {
        /* abaikan */
      }
    } finally {
      setLoading(false);
    }
  }, [t, keys, sessionId]);

  useEffect(() => {
    // Label instan dari cache agar header tidak berkedip, lalu sinkronkan.
    try {
      const cached = localStorage.getItem(keys.model);
      if (cached) setActive(cached);
      const cachedThinking = localStorage.getItem(keys.thinking);
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
          body: JSON.stringify({
            model: modelString,
            thinking: nextThinking ?? undefined,
            ...(sessionId ? { sessionId } : {}),
          }),
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
          localStorage.setItem(keys.model, next);
        } catch {
          /* abaikan */
        }
        if (body.thinking && typeof body.thinking === 'object') {
          setThinking(body.thinking);
          try {
            localStorage.setItem(keys.thinking, JSON.stringify(body.thinking));
          } catch {
            /* abaikan */
          }
        } else if (nextThinking === undefined) {
          setThinking(undefined);
          try {
            localStorage.removeItem(keys.thinking);
          } catch {
            /* abaikan */
          }
        }
        return next;
      } finally {
        setSaving(false);
      }
    },
    [t, keys, sessionId],
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
          t(
            sessionId
              ? 'workspace.modelPicker.activeToastSession'
              : 'workspace.modelPicker.activeToast',
            {
              name: picked ? displayNameOf(picked) : next,
            },
          ),
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

  // Local CLI transports first (the order they always showed), then every HTTP
  // provider the model settings offer, in settings order.
  const groups = useMemo(() => {
    const order: string[] = [];
    const byProvider = new Map<string, AgentModelItem[]>();
    for (const model of models) {
      const providerId = model.provider || 'opencode';
      const bucket = byProvider.get(providerId);
      if (bucket) bucket.push(model);
      else {
        byProvider.set(providerId, [model]);
        order.push(providerId);
      }
    }
    const cliRank = (providerId: string) => {
      const index = CLI_GROUP_ORDER.indexOf(providerId);
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };
    return [...order]
      .sort((a, b) => cliRank(a) - cliRank(b))
      .map((providerId) => {
        const list = byProvider.get(providerId)!;
        const name =
          PROVIDER_GROUP_NAMES[providerId] ??
          list.find((model) => model.providerName)?.providerName ??
          providerId;
        const icon = list.find((model) => model.icon)?.icon;
        return {
          id: providerId,
          name,
          icon,
          models: list.map((m) => ({
            id: m.id,
            name: displayNameOf(m),
            thinking: m.thinking,
          })),
        };
      });
  }, [models]);

  return (
    <>
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
        footerAction={{
          label: authConnected
            ? t('workspace.modelPicker.footerConnected')
            : t('workspace.modelPicker.footerLabel'),
          description: t('workspace.modelPicker.footerDescription'),
          icon: <KeyRound className="size-4" />,
          connected: authConnected,
          onClick: () => setAuthOpen(true),
        }}
        className="w-auto min-w-0 max-w-full shrink-0"
        t={t}
      />
      <WorkbenchAuthDialog
        open={authOpen}
        onOpenChange={setAuthOpen}
        onStatusChange={setAuthConnected}
      />
    </>
  );
}
