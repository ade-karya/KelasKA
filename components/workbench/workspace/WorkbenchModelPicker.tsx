'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Check, ChevronDown, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils/cn';

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

function shortLabel(modelString: string): string {
  const bare = modelString.replace(/^opencode[/:]/, '');
  return bare.length > 28 ? `${bare.slice(0, 26)}…` : bare;
}

/**
 * Tombol pemilih model Pro Workbench.
 *
 * Membaca SEMUA model free yang diaktifkan installer (OPENCODE_MODELS via
 * GET /api/agent/models) dan memilih aktif via POST (data/agent-driver-model.json,
 * berlaku untuk run berikutnya tanpa restart). Dipakai di header chat pane dan
 * home composer — satu komponen untuk seluruh halaman /workspace.
 */
export function WorkbenchModelPicker() {
  const [models, setModels] = useState<AgentModelItem[]>([]);
  const [active, setActive] = useState<string>('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/agent/models', { credentials: 'include' });
        if (!res.ok) return;
        const body = (await res.json()) as AgentModelsResponse;
        if (cancelled) return;
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
        } else {
          try {
            const cached = localStorage.getItem(STORAGE_KEY);
            if (cached) setActive(cached);
          } catch {
            /* abaikan */
          }
        }
      } catch {
        try {
          const cached = localStorage.getItem(STORAGE_KEY);
          if (cached && !cancelled) setActive(cached);
        } catch {
          /* abaikan */
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = useCallback(
    async (modelString: string) => {
      if (!modelString || modelString === active || saving) {
        setOpen(false);
        return;
      }
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
        toast.success(`Model aktif: ${shortLabel(next)} (berlaku untuk run berikutnya)`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Gagal memilih model');
      } finally {
        setSaving(false);
        setOpen(false);
      }
    },
    [active, saving],
  );

  const label = loading ? 'Model…' : active ? shortLabel(active) : 'Pilih model';

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        data-testid="workbench-model-picker"
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        title="Pilih model free OpenCode yang diaktifkan (OPENCODE_MODELS)"
        aria-label="Pilih model Pro Workbench"
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'ws-quiet inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-md px-2 py-1 text-[12px]',
        )}
      >
        {loading || saving ? (
          <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
        ) : (
          <Bot aria-hidden="true" className="size-3.5 shrink-0" />
        )}
        <span data-testid="workbench-model-picker-label" className="truncate">
          {label}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn('size-3 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Daftar model aktif"
          data-testid="workbench-model-picker-list"
          className="ws-pop absolute right-0 z-50 mt-1 max-h-[320px] w-[300px] overflow-y-auto rounded-lg border p-1 shadow-lg"
        >
          <p className="px-2 pb-1 pt-1.5 text-[11px] text-muted-foreground">
            Model free OpenCode yang diaktifkan ({models.length}) — berlaku untuk run berikutnya.
          </p>
          {models.length === 0 ? (
            <p className="px-2 py-2 text-[12px] text-muted-foreground">
              Daftar model belum tersedia. Jalankan ulang install.sh atau cek /api/agent/models.
            </p>
          ) : (
            models.map((m) => {
              const selected = m.modelString === active;
              return (
                <button
                  key={m.modelString}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-testid={`workbench-model-option-${m.id}`}
                  onClick={() => void choose(m.modelString)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px]',
                    selected ? 'bg-violet-600/10' : 'hover:bg-muted',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{m.name || m.id}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {m.modelString}
                    </span>
                  </span>
                  {selected ? (
                    <Check aria-hidden="true" className="size-3.5 shrink-0 text-violet-600" />
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
