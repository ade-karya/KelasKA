'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';
import { Download, ExternalLink, Loader2, LogIn, Plus, X } from 'lucide-react';
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

/**
 * FLUX.1-dev `/infer` parameters for the Hugging Face image service, as the
 * deployment configured them (`options` in openmaic.yml): read-only here,
 * because provider options are the deployment's — workspace edits cannot set
 * them. A configured provider's options win over the request's; unset fields
 * use the Space defaults.
 */
export function FluxOptionsPanel({ entry }: Pick<ServicePanelProps, 'entry'>) {
  const options = entry.provider?.options ?? {};
  const fields: Array<[string, string]> = [
    ['Seed', typeof options.seed === 'number' ? String(options.seed) : '42 (Space default)'],
    [
      'Steps',
      typeof options.numInferenceSteps === 'number' ? String(options.numInferenceSteps) : '28 (Space default)',
    ],
    [
      'Guidance',
      typeof options.guidanceScale === 'number' ? String(options.guidanceScale) : '3.5 (Space default)',
    ],
    ['Width', typeof options.width === 'number' ? String(options.width) : '1024 (Space default)'],
    ['Height', typeof options.height === 'number' ? String(options.height) : '1024 (Space default)'],
    [
      'Randomize seed',
      typeof options.randomizeSeed === 'boolean'
        ? options.randomizeSeed
          ? 'On (fresh seed)'
          : 'Off (use seed)'
        : 'On (Space default)',
    ],
  ];
  return (
    <div className="space-y-3 rounded-lg border border-border/50 bg-card p-3">
      <div>
        <div className="text-sm font-medium">FLUX Parameters</div>
        <p className="text-xs text-muted-foreground">
          /infer — black-forest-labs/FLUX.1-dev. Set in openmaic.yml under the provider&apos;s{' '}
          <code className="font-mono">options</code>, e.g. <code className="font-mono">guidanceScale: 3.5</code>;
          the model settings show them but cannot change them.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {fields.map(([label, value]) => (
          <div key={label} className="space-y-1">
            <Label className="text-xs">{label}</Label>
            <div className="flex h-8 items-center rounded-md border border-border/50 bg-muted/30 px-3 font-mono text-xs">
              {value}
            </div>
          </div>
        ))}
      </div>
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
    async (ids: string[]): Promise<boolean> => {
      const next = await saveServiceProvider(view, apply, entry, { models: ids.length ? ids : null }, t);
      return next !== null;
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
        // Report models as added only once the server saved them; a refused
        // or lost write leaves a failure the user can retry.
        if (additions.length && !(await saveModels([...current, ...additions]))) {
          setFetchStatus('error');
          setFetchMessage(t('settings.serverConfig.fetchNotSaved'));
          return;
        }
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
