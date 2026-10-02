'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import { useOpenRouterModels } from '@/lib/media/use-openrouter-models';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  Zap,
  Plus,
  Settings2,
  Trash2,
  RefreshCw,
  Download,
  RotateCcw,
  LogIn,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ImageProviderId } from '@/lib/media/types';

interface ImageSettingsProps {
  selectedProviderId: ImageProviderId;
}

interface WorkflowEntry {
  id: string;
  name: string;
}

export function ImageSettings({ selectedProviderId }: ImageSettingsProps) {
  const { t } = useI18n();

  const imageModelId = useSettingsStore((state) => state.imageModelId);
  const imageProvidersConfig = useSettingsStore((state) => state.imageProvidersConfig);
  const _setImageModelId = useSettingsStore((state) => state.setImageModelId);
  const setImageProvider = useSettingsStore((state) => state.setImageProvider);
  const setImageProviderConfig = useSettingsStore((state) => state.setImageProviderConfig);

  const [showApiKey, setShowApiKey] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  // Model dialog state
  const [showModelDialog, setShowModelDialog] = useState(false);
  const [editingModelIndex, setEditingModelIndex] = useState<number | null>(null);
  const [modelForm, setModelForm] = useState({ id: '', name: '' });

  // ComfyUI workflow list state
  const [workflows, setWorkflows] = useState<WorkflowEntry[]>([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(false);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);

  // OpenRouter free-model fetch state (tombol "Ambil model" $0)
  const [fetchStatus, setFetchStatus] = useState<'idle' | 'fetching' | 'success' | 'error'>('idle');
  const [fetchMessage, setFetchMessage] = useState('');

  const isComfyUI = selectedProviderId === 'comfyui-image';
  const isOpenRouterImage = selectedProviderId === 'openrouter-image';
  const isHuggingFaceImage = selectedProviderId === 'huggingface-image';

  // Reset test/fetch state when provider changes (derived state pattern)
  const [prevSelectedProviderId, setPrevSelectedProviderId] = useState(selectedProviderId);
  if (selectedProviderId !== prevSelectedProviderId) {
    setPrevSelectedProviderId(selectedProviderId);
    setTestStatus('idle');
    setTestMessage('');
    setFetchStatus('idle');
    setFetchMessage('');
  }

  // Fetch ComfyUI workflows when the provider is selected
  const fetchWorkflows = useCallback(async () => {
    setWorkflowsLoading(true);
    setWorkflowsError(null);
    try {
      const res = await fetch('/api/comfyui-workflows');
      const data = await res.json();
      setWorkflows(data.workflows || []);
    } catch (err) {
      setWorkflowsError(t('settings.comfyuiLoadError').replace('{error}', String(err)));
      setWorkflows([]);
    } finally {
      setWorkflowsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (isComfyUI) {
      fetchWorkflows();
    }
  }, [isComfyUI, fetchWorkflows]);

  const currentConfig = imageProvidersConfig[selectedProviderId];
  const currentProvider = IMAGE_PROVIDERS[selectedProviderId];
  // OpenRouter's catalog is fetched live so the picker is never a curated
  // shortlist; every other provider keeps its registry list.
  const { models: builtInModels } = useOpenRouterModels(
    'image',
    selectedProviderId === 'openrouter-image',
    currentProvider?.models || [],
    currentConfig?.apiKey,
    currentConfig?.baseUrl,
  );
  const customModels = useMemo(
    () => currentConfig?.customModels || [],
    [currentConfig?.customModels],
  );
  const isServerConfigured = !!currentConfig?.isServerConfigured;
  const requiresApiKey = currentProvider?.requiresApiKey ?? true;

  // FLUX.1-dev `/infer` overrides (Hugging Face FLUX provider only).
  // Defaults mirror the Space's API docs; an unset field falls back there.
  const fluxParams = currentConfig?.fluxParams ?? {};
  const handleFluxParamsChange = (
    patch: Partial<{
      seed: number | undefined;
      randomizeSeed: boolean;
      width: number | undefined;
      height: number | undefined;
      guidanceScale: number | undefined;
      numInferenceSteps: number | undefined;
    }>,
  ) => {
    setImageProviderConfig(selectedProviderId, {
      fluxParams: { ...fluxParams, ...patch },
    });
  };
  const handleFluxParamsReset = () => {
    setImageProviderConfig(selectedProviderId, {
      fluxParams: {},
    });
  };

  const handleApiKeyChange = (apiKey: string) => {
    setImageProviderConfig(selectedProviderId, {
      apiKey,
      ...(apiKey.trim() ? { enabled: true } : {}),
    });
  };

  const handleBaseUrlChange = (baseUrl: string) => {
    setImageProviderConfig(selectedProviderId, {
      baseUrl,
      ...(baseUrl.trim() ? { enabled: true } : {}),
    });
  };

  const handleTest = async () => {
    setTestLoading(true);
    setTestStatus('idle');
    setTestMessage('');
    try {
      // Same fallback as the video panel: browsing here does not activate a
      // provider, so the global imageModelId may be empty on fresh clients.
      // The probe only validates credentials — use this provider's first
      // catalog model instead of failing with MISSING_MODEL.
      const probeModelId = imageModelId || builtInModels[0]?.id || '';
      const response = await fetch('/api/verify-image-provider', {
        method: 'POST',
        headers: {
          'x-image-provider': selectedProviderId,
          'x-image-model': probeModelId,
          'x-api-key': currentConfig?.apiKey || '',
          'x-base-url': currentConfig?.baseUrl || '',
        },
      });
      const data = await response.json();
      if (data.success) {
        setTestStatus('success');
        setTestMessage(t('settings.imageConnectivitySuccess'));
      } else {
        setTestStatus('error');
        setTestMessage(`${t('settings.imageConnectivityFailed')}: ${data.error}`);
      }
    } catch (err) {
      setTestStatus('error');
      setTestMessage(`${t('settings.imageConnectivityFailed')}: ${err}`);
    } finally {
      setTestLoading(false);
    }
  };

  // Ambil model gratis ($0) OpenRouter Image via server probe.
  // Hasilnya disimpan sebagai customModels dengan replaceBuiltInModels agar
  // langsung tampil di pemilih model kursus (yang tidak membaca live hook).
  const handleFetchFreeModels = useCallback(async () => {
    setFetchStatus('fetching');
    setFetchMessage('');
    try {
      const effectiveBaseUrl = currentConfig?.baseUrl || currentProvider?.defaultBaseUrl || '';
      const response = await fetch('/api/provider/probe-image-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: effectiveBaseUrl,
          apiKey: currentConfig?.apiKey || '',
        }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        const fetched: Array<{ id: string; name: string }> = (data.models || [])
          .filter((m: { id?: unknown }) => typeof m?.id === 'string' && m.id.trim())
          .map((m: { id: string; name?: unknown }) => ({
            id: m.id.trim(),
            name: typeof m.name === 'string' && m.name.trim() ? m.name.trim() : m.id.trim(),
          }));
        const prevIds = new Set(customModels.map((m) => m.id));
        const added = fetched.filter((m) => !prevIds.has(m.id)).length;
        setImageProviderConfig(selectedProviderId, {
          customModels: fetched,
          replaceBuiltInModels: true,
        });
        // Seleksi basi (mis. model image-to-image yang kini dikecualikan)
        // menunjuk ke id yang tak lagi ada — arahkan ke entri gratis pertama
        // agar generate berikutnya tidak 404.
        if (fetched.length > 0 && !fetched.some((m) => m.id === imageModelId)) {
          setImageProvider(selectedProviderId);
          _setImageModelId(fetched[0].id);
        }
        setFetchStatus('success');
        setFetchMessage(
          t('settings.fetchModelsResult')
            .replace('{added}', String(added))
            .replace('{total}', String(fetched.length)),
        );
      } else if (response.status === 404) {
        setFetchStatus('error');
        setFetchMessage(t('settings.fetchModelsNoEndpoint'));
      } else {
        setFetchStatus('error');
        setFetchMessage(data.error || t('settings.fetchModelsFailed'));
      }
    } catch {
      setFetchStatus('error');
      setFetchMessage(t('settings.fetchModelsFailed'));
    }
  }, [
    currentConfig?.apiKey,
    currentConfig?.baseUrl,
    currentProvider?.defaultBaseUrl,
    customModels,
    imageModelId,
    selectedProviderId,
    setImageProvider,
    setImageProviderConfig,
    _setImageModelId,
    t,
  ]);

  const handleResetFreeModels = useCallback(() => {
    setImageProviderConfig(selectedProviderId, {
      customModels: [],
      replaceBuiltInModels: false,
    });
    setFetchStatus('idle');
    setFetchMessage('');
  }, [selectedProviderId, setImageProviderConfig]);

  // Model CRUD
  const handleOpenAddModel = () => {
    setEditingModelIndex(null);
    setModelForm({ id: '', name: '' });
    setShowModelDialog(true);
  };

  const handleOpenEditModel = (index: number) => {
    setEditingModelIndex(index);
    setModelForm({ ...customModels[index] });
    setShowModelDialog(true);
  };

  const handleSaveModel = useCallback(() => {
    if (!modelForm.id.trim()) return;
    const newCustomModels = [...customModels];
    if (editingModelIndex !== null) {
      newCustomModels[editingModelIndex] = {
        id: modelForm.id.trim(),
        name: modelForm.name.trim() || modelForm.id.trim(),
      };
    } else {
      newCustomModels.push({
        id: modelForm.id.trim(),
        name: modelForm.name.trim() || modelForm.id.trim(),
      });
    }
    setImageProviderConfig(selectedProviderId, {
      customModels: newCustomModels,
    });
    setShowModelDialog(false);
  }, [modelForm, editingModelIndex, customModels, selectedProviderId, setImageProviderConfig]);

  const handleDeleteModel = (index: number) => {
    const newCustomModels = customModels.filter((_, i) => i !== index);
    setImageProviderConfig(selectedProviderId, {
      customModels: newCustomModels,
    });
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Server-configured notice */}
      {isServerConfigured && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 p-3 text-sm text-blue-700 dark:text-blue-300">
          {t('settings.serverConfiguredNotice')}
        </div>
      )}

      {/* Managed providers are admin-owned: the operator's key and base URL
          are authoritative and not overridable here, so the editing inputs
          are hidden (server ignores client-sent overrides for these). */}
      {!isServerConfigured && (
        <>
          {/* Hugging Face login: FLUX.1-dev is a gated model, so generation
              needs a user access token (hf_...) whose account accepted the
              model license. This entry point walks the user through login →
              token → license acceptance; the token itself goes in API Key
              below and "Test Connection" validates it via whoami. */}
          {isHuggingFaceImage && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 space-y-2.5">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                {t('settings.huggingfaceTokenHint')}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="gap-1.5 bg-white dark:bg-transparent"
                >
                  <a href="https://huggingface.co/login" target="_blank" rel="noreferrer">
                    <LogIn className="h-3.5 w-3.5" />
                    {t('settings.huggingfaceLogin')}
                  </a>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="gap-1.5 bg-white dark:bg-transparent"
                >
                  <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t('settings.huggingfaceGetToken')}
                  </a>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="gap-1.5 bg-white dark:bg-transparent"
                >
                  <a
                    href="https://huggingface.co/black-forest-labs/FLUX.1-dev"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t('settings.huggingfaceAcceptLicense')}
                  </a>
                </Button>
              </div>
            </div>
          )}

          {/* API Key + Test inline — for Hugging Face FLUX paste the
              access token (hf_...) here; the field label stays API Key
              because the server reads it via x-api-key. */}
          <div className="space-y-2">
            <Label>API Key</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  name={`image-api-key-${selectedProviderId}`}
                  type={showApiKey ? 'text' : 'password'}
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={isHuggingFaceImage ? 'hf_...' : t('settings.enterApiKey')}
                  value={currentConfig?.apiKey || ''}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  className="h-8 pr-8"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testLoading || (requiresApiKey && !currentConfig?.apiKey)}
                className="gap-1.5"
              >
                {testLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <Zap className="h-3.5 w-3.5" />
                    {t('settings.testConnection')}
                  </>
                )}
              </Button>
            </div>
            {testMessage && (
              <div
                className={cn(
                  'rounded-lg p-3 text-sm overflow-hidden',
                  testStatus === 'success' &&
                    'bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/50 dark:text-green-400 dark:border-green-800',
                  testStatus === 'error' &&
                    'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800',
                )}
              >
                <div className="flex items-start gap-2 min-w-0">
                  {testStatus === 'success' && <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />}
                  {testStatus === 'error' && <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
                  <p className="flex-1 min-w-0 break-all">{testMessage}</p>
                </div>
              </div>
            )}
          </div>

          {/* Base URL */}
          <div className="space-y-2">
            <Label>Base URL</Label>
            <Input
              name={`image-base-url-${selectedProviderId}`}
              type="url"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={currentConfig?.baseUrl || ''}
              onChange={(e) => handleBaseUrlChange(e.target.value)}
              placeholder={
                currentConfig?.baseUrl ||
                currentProvider?.defaultBaseUrl ||
                t('settings.enterCustomBaseUrl')
              }
              className="h-8"
            />
            {(() => {
              const effectiveBaseUrl =
                currentConfig?.baseUrl || currentProvider?.defaultBaseUrl || '';
              if (!effectiveBaseUrl) return null;
              return (
                <p className="text-xs text-muted-foreground break-all">
                  {t('settings.requestUrl')}: {effectiveBaseUrl}
                </p>
              );
            })()}
          </div>

          {/* FLUX.1-dev `/infer` parameters — mirrors the Space's API docs
              (prompt comes from the generation request itself; the other six
              inputs are editable here, blank = API default). */}
          {isHuggingFaceImage && (
            <div className="space-y-3 rounded-lg border border-border/50 bg-card p-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="text-sm font-medium">FLUX Parameters</div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">
                    /infer — black-forest-labs/FLUX.1-dev
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleFluxParamsReset}
                  className="gap-1.5"
                  title="Reset to the API defaults (seed 0, randomize on, 1024×1024, guidance 3.5, 28 steps)"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t('settings.reset')}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="font-mono text-xs">seed</Label>
                  <Input
                    name={`image-flux-seed-${selectedProviderId}`}
                    type="number"
                    min={0}
                    step={1}
                    placeholder="0"
                    value={fluxParams.seed ?? ''}
                    onChange={(e) =>
                      handleFluxParamsChange({
                        seed: e.target.value === '' ? undefined : Math.max(0, Math.floor(Number(e.target.value) || 0)),
                      })
                    }
                    className="h-8"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-mono text-xs">num_inference_steps</Label>
                  <Input
                    name={`image-flux-steps-${selectedProviderId}`}
                    type="number"
                    min={1}
                    step={1}
                    placeholder="28"
                    value={fluxParams.numInferenceSteps ?? ''}
                    onChange={(e) =>
                      handleFluxParamsChange({
                        numInferenceSteps:
                          e.target.value === '' ? undefined : Math.max(1, Math.floor(Number(e.target.value) || 0)),
                      })
                    }
                    className="h-8"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-mono text-xs">width</Label>
                  <Input
                    name={`image-flux-width-${selectedProviderId}`}
                    type="number"
                    min={256}
                    step={8}
                    placeholder="1024"
                    value={fluxParams.width ?? ''}
                    onChange={(e) =>
                      handleFluxParamsChange({
                        width: e.target.value === '' ? undefined : Math.max(1, Math.floor(Number(e.target.value) || 0)),
                      })
                    }
                    className="h-8"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-mono text-xs">height</Label>
                  <Input
                    name={`image-flux-height-${selectedProviderId}`}
                    type="number"
                    min={256}
                    step={8}
                    placeholder="1024"
                    value={fluxParams.height ?? ''}
                    onChange={(e) =>
                      handleFluxParamsChange({
                        height: e.target.value === '' ? undefined : Math.max(1, Math.floor(Number(e.target.value) || 0)),
                      })
                    }
                    className="h-8"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-mono text-xs">guidance_scale</Label>
                  <Input
                    name={`image-flux-guidance-${selectedProviderId}`}
                    type="number"
                    min={0}
                    step={0.1}
                    placeholder="3.5"
                    value={fluxParams.guidanceScale ?? ''}
                    onChange={(e) =>
                      handleFluxParamsChange({
                        guidanceScale: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                    className="h-8"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-mono text-xs">randomize_seed</Label>
                  <label className="flex h-8 items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      name={`image-flux-randomize-${selectedProviderId}`}
                      checked={fluxParams.randomizeSeed ?? true}
                      onChange={(e) => handleFluxParamsChange({ randomizeSeed: e.target.checked })}
                      className="h-4 w-4 accent-current"
                    />
                    <span className="text-muted-foreground">
                      {fluxParams.randomizeSeed ?? true ? 'On (fresh seed)' : 'Off (use seed)'}
                    </span>
                  </label>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Blank fields use the API defaults. Returns an image plus the seed used.
              </p>
            </div>
          )}
        </>
      )}

      {/* ── ComfyUI: Workflow list ── */}
      {isComfyUI ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Label className="text-base">{t('settings.comfyuiWorkflows')}</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchWorkflows}
              disabled={workflowsLoading}
              className="gap-1.5"
            >
              {workflowsLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {t('settings.comfyuiRefresh')}
            </Button>
          </div>

          {workflowsError && (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
              {workflowsError}
            </div>
          )}

          {!workflowsLoading && !workflowsError && workflows.length === 0 && (
            <div className="rounded-lg border border-border/50 bg-muted/30 p-4 text-sm text-muted-foreground text-center">
              {t('settings.comfyuiNoWorkflowsFoundPrefix')}{' '}
              <code className="font-mono text-xs">public/</code>.
              <br />
              {t('settings.comfyuiAddWorkflowPrefix')}{' '}
              <code className="font-mono text-xs">comfyui-*.json</code>{' '}
              {t('settings.comfyuiAddWorkflowSuffix')}
            </div>
          )}

          <div className="space-y-1.5">
            {workflows.map((workflow) => (
              <div
                key={workflow.id}
                className={cn(
                  'flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors',
                  imageModelId === workflow.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border/50 bg-card hover:border-border hover:bg-accent/30',
                )}
                onClick={() => {
                  // Selecting a workflow here must also make ComfyUI the
                  // active image provider — otherwise the workflow filename
                  // gets written into imageModelId while a different
                  // provider (e.g. Seedream) stays active, and that
                  // provider's next generation call sends this filename as
                  // its model id. Mirrors the atomic setImageProvider +
                  // setImageModelId pairing used in media-popover.tsx.
                  setImageProvider(selectedProviderId);
                  _setImageModelId(workflow.id);
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{workflow.name}</div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">
                    {workflow.id}
                  </div>
                </div>
                {imageModelId === workflow.id && (
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0 ml-2" />
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            {t('settings.comfyuiFolderHintPrefix')} <code className="font-mono">public/</code>{' '}
            {t('settings.comfyuiFolderHintMiddle')}{' '}
            <code className="font-mono">comfyui-anime-style.json</code> → &quot;Anime Style&quot;.
          </p>
        </div>
      ) : (
        /* ── All other providers: standard model list ── */
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Label className="text-base">{t('settings.models')}</Label>
              {isOpenRouterImage &&
                currentConfig?.replaceBuiltInModels &&
                customModels.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-200 dark:bg-green-950/50 dark:text-green-400 dark:border-green-800">
                    $0
                  </span>
                )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {isOpenRouterImage && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleFetchFreeModels}
                    disabled={fetchStatus === 'fetching'}
                    className="gap-1.5"
                    title="Ambil model gratis ($0) dari katalog OpenRouter"
                  >
                    {fetchStatus === 'fetching' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    {t('settings.fetchModels')}
                  </Button>
                  {currentConfig?.replaceBuiltInModels && customModels.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleResetFreeModels}
                      className="gap-1.5"
                      title={t('settings.reset')}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {t('settings.reset')}
                    </Button>
                  )}
                </>
              )}
              <Button variant="outline" size="sm" onClick={handleOpenAddModel} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                {t('settings.addNewModel')}
              </Button>
            </div>
          </div>

          {/* Fetch-models result message */}
          {isOpenRouterImage && fetchMessage && (
            <div
              className={cn(
                'rounded-lg p-2.5 text-xs',
                fetchStatus === 'success' && 'bg-green-50 text-green-700 border border-green-200',
                fetchStatus === 'error' && 'bg-amber-50 text-amber-700 border border-amber-200',
              )}
            >
              {fetchMessage}
            </div>
          )}

          <div className="space-y-1.5">
            {/* Built-in models — disembunyikan saat daftar gratis $0 hasil fetch
                menggantikannya, agar tidak duplikat dan picker kursus konsisten
                (pemilih memakai customModels saat replaceBuiltInModels). */}
            {!(
              isOpenRouterImage &&
              currentConfig?.replaceBuiltInModels &&
              customModels.length > 0
            ) &&
              builtInModels.map((model) => (
                <div
                  key={model.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{model.name}</div>
                    {model.name !== model.id && (
                      <div className="text-xs text-muted-foreground font-mono mt-0.5 break-all">
                        {model.id}
                      </div>
                    )}
                  </div>
                </div>
              ))}

            {/* Custom models */}
            {customModels.map((model, index) => (
              <div
                key={`custom-${index}`}
                className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{model.name}</div>
                  {model.name !== model.id && (
                    <div className="text-xs text-muted-foreground font-mono mt-0.5 break-all">
                      {model.id}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2"
                    onClick={() => handleOpenEditModel(index)}
                    title={t('settings.editModel')}
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDeleteModel(index)}
                    title={t('settings.deleteModel')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add/Edit Model Dialog — only used for non-ComfyUI providers */}
      <Dialog open={showModelDialog} onOpenChange={setShowModelDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>
            {editingModelIndex !== null ? t('settings.editModel') : t('settings.addNewModel')}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {editingModelIndex !== null ? t('settings.editModel') : t('settings.addNewModel')}
          </DialogDescription>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>{t('settings.modelId')}</Label>
              <Input
                value={modelForm.id}
                onChange={(e) => setModelForm((prev) => ({ ...prev, id: e.target.value }))}
                placeholder="e.g. my-custom-model-v1"
                className="h-8 font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('settings.modelName')}</Label>
              <Input
                value={modelForm.name}
                onChange={(e) => setModelForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. My Custom Model"
                className="h-8 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowModelDialog(false)}>
                {t('settings.cancelEdit')}
              </Button>
              <Button size="sm" onClick={handleSaveModel} disabled={!modelForm.id.trim()}>
                {t('settings.saveModel')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
