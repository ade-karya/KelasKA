'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ModelPicker } from '@/components/settings/model-picker';
import { useI18n } from '@/lib/hooks/use-i18n';

interface AgentModelItem {
  id: string;
  modelString: string;
  name: string;
}

interface AgentModelsResponse {
  success?: boolean;
  active?: string;
  models?: AgentModelItem[];
}

const STORAGE_KEY = 'openmaic-workbench-model';

/** "Muse Spark 1.3 Free (Zen)" -> "Muse Spark 1.3 Free". */
function displayNameOf(model: Pick<AgentModelItem, 'id' | 'name'>): string {
  const name = (model.name || '').trim();
  if (name && name !== model.id) return name.replace(/\s*\(Zen\)\s*$/i, '').trim() || name;
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

function bareIdOf(modelString: string): string {
  return modelString.replace(/^opencode[/:]/, '');
}

/**
 * Pemilih model Pro Workbench — memakai ulang `ModelPicker` chat classic
 * (Popover + kolom cari fixed + daftar scroll + ring violet) agar tampilan
 * dan perilaku identik.
 *
 * Membaca SEMUA model free yang diaktifkan installer (OPENCODE_MODELS via
 * GET /api/agent/models) dan memilih aktif via POST (data/agent-driver-model.json,
 * berlaku untuk run berikutnya tanpa restart). Dipakai di header chat pane dan
 * home composer — satu komponen untuk seluruh halaman /workspace.
 */
export function WorkbenchModelPicker() {
  const { t } = useI18n();
  const [models, setModels] = useState<AgentModelItem[]>([]);
  const [active, setActive] = useState<string>('');
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
      if (list.length === 0) setLoadError('Daftar model kosong.');
    } catch {
      setLoadError('Gagal memuat daftar model.');
      try {
        const cached = localStorage.getItem(STORAGE_KEY);
        if (cached) setActive(cached);
      } catch {
        /* abaikan */
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Label instan dari cache agar header tidak berkedip, lalu sinkronkan.
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) setActive(cached);
    } catch {
      /* abaikan */
    }
    void load();
  }, [load]);

  const choose = useCallback(
    async (modelString: string) => {
      if (!modelString || modelString === active || saving) return;
      setSaving(true);
      try {
        const res = await fetch('/api/agent/models', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: modelString }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          active?: string;
          error?: string;
          message?: string;
        };
        if (!res.ok) {
          throw new Error(body.message ?? body.error ?? `Gagal memilih model (${res.status})`);
        }
        const next = typeof body.active === 'string' ? body.active : modelString;
        setActive(next);
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          /* abaikan */
        }
        const picked = models.find((m) => m.modelString === next);
        toast.success(
          `Model aktif: ${picked ? displayNameOf(picked) : next} (berlaku untuk run berikutnya)`,
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Gagal memilih model');
      } finally {
        setSaving(false);
      }
    },
    [active, saving, models],
  );

  const activeBare = active ? bareIdOf(active) : '';

  return (
    <ModelPicker
      groups={[
        {
          id: 'opencode',
          name: 'OpenCode CLI',
          models: models.map((m) => ({ id: m.id, name: displayNameOf(m) })),
        },
      ]}
      value={activeBare ? { providerId: 'opencode', modelId: activeBare } : null}
      onSelect={(_providerId, modelId) => void choose(`opencode:${modelId}`)}
      placeholder={loading ? 'Memuat…' : loadError ? 'Gagal memuat model' : 'Pilih model'}
      disabled={loading || saving}
      ariaLabel="Pilih model Pro Workbench"
      className="w-auto min-w-0 max-w-full shrink-0"
      t={t}
    />
  );
}
