'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';
import { Download, ExternalLink, Loader2, LogIn, Plus, RotateCcw, X } from 'lucide-react';
import { ModelEditDialog } from './model-edit-dialog';
import {
  saveServiceProvider,
  type ServicePanelProps,
} from './server-settings';

/**
 * The Hugging Face walkthrough for gated models and token quotas: login →
 * token → license/space. The token itself goes in API Key; the hints only
 * point there. Shown for the Hugging Face image/video services.
 */
export function HuggingFaceHint({ kind }: { kind: 'image' | 'video' }) {
  const { t } = useI18n();
  const isVideo = kind === 'video';
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 space-y-2.5">
      <p className="text-sm text-amber-800 dark:text-amber-200">
        {t(isVideo ? 'settings.huggingfaceVideoHint' : 'settings.huggingfaceTokenHint')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild className="gap-1.5 bg-white dark:bg-transparent">
          <a href="https://huggingface.co/login" target="_blank" rel="noreferrer">
            <LogIn className="h-3.5 w-3.5" />
            {t('settings.huggingfaceLogin')}
          </a>
        </Button>
        <Button variant="outline" size="sm" asChild className="gap-1.5 bg-white dark:bg-transparent">
          <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">
            <ExternalLink className="h-3.5 w-3.5" />
            {t('settings.huggingfaceGetToken')}
          </a>
        </Button>
        <Button variant="outline" size="sm" asChild className="gap-1.5 bg-white dark:bg-transparent">
          <a
            href={
              isVideo
                ? 'https://huggingface.co/spaces/KlingTeam/LivePortrait'
                : 'https://huggingface.co/black-forest-labs/FLUX.1-dev'
            }
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t(isVideo ? 'settings.huggingfaceOpenSpace' : 'settings.huggingfaceAcceptLicense')}
          </a>
        </Button>
      </div>
    </div>
  );
}

type FluxNumbers = {
  seed?: number;
  numInferenceSteps?: number;
  width?: number;
  height?: number;
  guidanceScale?: number;
};

const FLUX_DEFAULTS = { seed: 42, randomizeSeed: true } as const;

/** Drop unset fields; null when nothing is set (clears the stored options). */
function cleanOptions(
  options: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean> | null {
  const next: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) next[key] = value;
  }
  return Object.keys(next).length ? next : null;
}

function numberOrUndefined(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * FLUX.1-dev `/infer` overrides for the Hugging Face image service
 * (seed, steps, size, guidance, seed randomization). Stored as the workspace
 * provider's non-secret `options`, so the image route's adapter options carry
 * them to the Space; a configured provider's options win over the request's.
 * Other providers ignore these fields.
 */
export function FluxOptionsEditor({ view, apply, entry }: ServicePanelProps) {
  const { t } = useI18n();
  const stored = entry.provider?.options ?? {};
  const [seed, setSeed] = useState(() =>
    typeof stored.seed === 'number' ? String(stored.seed) : '',
  );
  const [steps, setSteps] = useState(() =>
    typeof stored.numInferenceSteps === 'number' ? String(stored.numInferenceSteps) : '',
  );
  const [width, setWidth] = useState(() =>
    typeof stored.width === 'number' ? String(stored.width) : '',
  );
  const [height, setHeight] = useState(() =>
    typeof stored.height === 'number' ? String(stored.height) : '',
  );
  const [guidance, setGuidance] = useState(() =>
    typeof stored.guidanceScale === 'number' ? String(stored.guidanceScale) : '',
  );
  const [randomize, setRandomize] = useState(
    typeof stored.randomizeSeed === 'boolean' ? stored.randomizeSeed : FLUX_DEFAULTS.randomizeSeed,
  );
  const [saving, setSaving] = useState(false);

  const save = async (options: Record<string, string | number | boolean> | null) => {
    setSaving(true);
    try {
      await saveServiceProvider(view, apply, entry, { options }, t);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () =>
    void save(
      cleanOptions({
        ...stored,
        seed: numberOrUndefined(seed),
        numInferenceSteps: numberOrUndefined(steps),
        width: numberOrUndefined(width),
        height: numberOrUndefined(height),
        guidanceScale: numberOrUndefined(guidance),
        randomizeSeed: randomize,
      }),
    );
  const handleReset = () =>
    void save(
      cleanOptions({
        ...stored,
        seed: undefined,
        numInferenceSteps: undefined,
        width: undefined,
        height: undefined,
        guidanceScale: undefined,
        randomizeSeed: undefined,
      }),
    );

  const numberField = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    placeholder: string,
  ) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        inputMode="decimal"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 font-mono"
      />
    </div>
  );

  return (
    <div className="space-y-3 rounded-lg border border-border/50 bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">FLUX Parameters</div>
          <p className="text-xs text-muted-foreground">
            /infer — black-forest-labs/FLUX.1-dev (unset fields use the Space defaults)
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={handleReset} disabled={saving} className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" />
          {t('settings.reset')}
        </Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {numberField('Seed', seed, setSeed, String(FLUX_DEFAULTS.seed))}
        {numberField('Steps', steps, setSteps, '28')}
        {numberField('Guidance', guidance, setGuidance, '3.5')}
        {numberField('Width', width, setWidth, '1024')}
        {numberField('Height', height, setHeight, '1024')}
        <div className="space-y-1">
          <Label className="text-xs">Randomize seed</Label>
          <button
            type="button"
            role="switch"
            aria-checked={randomize}
            onClick={() => setRandomize(!randomize)}
            className={cn(
              'flex h-8 w-full items-center justify-between rounded-md border px-3 text-xs transition-colors',
              randomize
                ? 'border-primary bg-primary/5 text-foreground'
                : 'border-border/50 bg-muted/30 text-muted-foreground',
            )}
          >
            {randomize ? 'On (fresh seed)' : 'Off (use seed)'}
          </button>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {t('settings.save')}
      </Button>
    </div>
  );
}

/**
 * The workspace-saved model ids of an OpenRouter media service: fetch the
 * free ($0) catalog through the server (with the stored key) and add them,
 * add one by hand, or drop one. Mirrors the chat provider panel's model list
 * for the media services, whose catalogue alone never names the free tier.
 */
export function MediaModelsManager({
  view,
  apply,
  entry,
  kind,
}: ServicePanelProps & { kind: 'image' | 'video' }) {
  const { t } = useI18n();
  const provider = entry.provider;
  const current = provider?.models ?? [];
  const [fetchStatus, setFetchStatus] = useState<'idle' | 'fetching' | 'success' | 'error'>('idle');
  const [fetchMessage, setFetchMessage] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const saveModels = useCallback(
    async (ids: string[]) => {
      await saveServiceProvider(view, apply, entry, { models: ids.length ? ids : null }, t);
    },
    [view, apply, entry, t],
  );

  const handleFetch = useCallback(async () => {
    setFetchStatus('fetching');
    setFetchMessage('');
    try {
      const response = await fetch(`/api/provider/probe-${kind}-models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: entry.id }),
      });
      const data = await response.json();
      if (response.ok && Array.isArray(data.models)) {
        const ids = data.models.map((m: { id: string }) => m.id).filter(Boolean);
        const additions = ids.filter((id: string) => !current.includes(id));
        if (additions.length) await saveModels([...current, ...additions]);
        setFetchStatus('success');
        setFetchMessage(
          t('settings.fetchModelsResult')
            .replace('{total}', String(ids.length))
            .replace('{added}', String(additions.length)),
        );
      } else if (response.status === 404) {
        setFetchStatus('error');
        setFetchMessage(t('settings.fetchModelsNoEndpoint'));
      } else if (response.status === 401) {
        setFetchStatus('error');
        setFetchMessage(t('settings.fetchModelsAuthError'));
      } else {
        setFetchStatus('error');
        setFetchMessage(data.error || t('settings.fetchModelsFailed'));
      }
    } catch {
      setFetchStatus('error');
      setFetchMessage(t('settings.fetchModelsFailed'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id, kind, t]);

  const handleAdd = useCallback(
    (modelId: string) => {
      const id = modelId.trim();
      if (!id || current.includes(id)) return;
      void saveModels([...current, id]);
    },
    [current, saveModels],
  );

  const handleRemove = useCallback(
    (modelId: string) => void saveModels(current.filter((id) => id !== modelId)),
    [current, saveModels],
  );

  return (
    <div className="space-y-3 rounded-lg border border-border/50 bg-card p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Label className="text-sm">{t('settings.models')}</Label>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleFetch()}
            disabled={fetchStatus === 'fetching' || !provider}
            className="gap-1.5"
          >
            {fetchStatus === 'fetching' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {t('settings.fetchModels')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDialogOpen(true)}
            disabled={!provider}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('settings.addModel')}
          </Button>
        </div>
      </div>
      {fetchMessage && (
        <p
          className={cn(
            'text-xs',
            fetchStatus === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400',
          )}
        >
          {fetchMessage}
        </p>
      )}
      {current.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {current.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/30 px-2 py-1 font-mono text-xs"
            >
              {id}
              <button
                type="button"
                aria-label={`Remove ${id}`}
                onClick={() => handleRemove(id)}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <ModelEditDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        modelId=""
        isNew
        providerId={undefined}
        onSave={handleAdd}
      />
    </div>
  );
}
