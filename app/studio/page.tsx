'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowUp,
  Loader2,
  Sparkles,
  ArrowLeft,
  ShieldCheck,
  GraduationCap,
} from 'lucide-react';
import { useStudentAuth } from '@/lib/contexts/student-auth-context';
import { useSupabaseAuth } from '@/lib/contexts/supabase-auth-context';
import { createLogger } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SettingsDialog } from '@/components/settings';
import { GenerationToolbar } from '@/components/generation/generation-toolbar';
import { AgentBar } from '@/components/agent/agent-bar';
import { nanoid } from 'nanoid';
import { deleteDocumentBlob, storeDocumentBlob } from '@/lib/utils/image-storage';
import { normalizeDocumentMimeType } from '@/lib/document/mime';
import { dedupeCourseMaterialFiles, courseMaterialFingerprint } from '@/lib/document/course-materials';
import type { SelectedCourseMaterial, SessionDocumentSource, UserRequirements } from '@/lib/types/generation';
import { useSettingsStore } from '@/lib/store/settings';
import { hasUsableLLMProvider } from '@/lib/store/settings-validation';
import { useUserProfileStore } from '@/lib/store/user-profile';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDraftCache } from '@/lib/hooks/use-draft-cache';
import { SpeechButton } from '@/components/audio/speech-button';
import { InteractiveModeButton } from '@/components/generation/interactive-mode-button';
import { shouldShowVocationalTestUi } from '@/lib/config/feature-flags';
import { useI18n } from '@/lib/hooks/use-i18n';

const log = createLogger('Studio');

const WEB_SEARCH_STORAGE_KEY = 'webSearchEnabled';
const INTERACTIVE_MODE_STORAGE_KEY = 'interactiveModeEnabled';

interface FormState {
  courseMaterials: SelectedCourseMaterial[];
  requirement: string;
  webSearch: boolean;
  interactiveMode: boolean;
  vocationalTestMode: boolean;
}
const initialFormState: FormState = {
  courseMaterials: [],
  requirement: '',
  webSearch: false,
  interactiveMode: false,
  vocationalTestMode: false,
};

export default function StudioPage() {
  const router = useRouter();
  const { t } = useI18n();
  const { student, loading: loadingStudent } = useStudentAuth();
  const { user, loading: loadingSupabase } = useSupabaseAuth();
  const authLoading = loadingStudent || loadingSupabase;
  const isStudentAuthed = !!student;
  const isGuruAuthed = !!user && !student;

  const showVocationalTestUi = shouldShowVocationalTestUi();

  // redirect siswa or unauthenticated
  useEffect(() => {
    if (authLoading) return;
    if (isStudentAuthed) {
      toast.error('Hanya guru yang dapat membuka Studio');
      router.replace('/dashboard');
      return;
    }
    if (!isGuruAuthed) {
      router.replace('/masuk?next=/studio');
    }
  }, [authLoading, isStudentAuthed, isGuruAuthed, router]);

  const [form, setForm] = useState<FormState>(initialFormState);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<import('@/lib/types/settings').SettingsSection | undefined>(undefined);
  const { cachedValue: cachedRequirement, updateCache: updateRequirementCache } = useDraftCache<string>({ key: 'requirementDraft' });
  const providersConfig = useSettingsStore((s) => s.providersConfig);
  const hasUsableProvider = hasUsableLLMProvider(providersConfig);
  const [error, setError] = useState<string | null>(null);
  const [preparingGenerate, setPreparingGenerate] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const savedWebSearch = localStorage.getItem(WEB_SEARCH_STORAGE_KEY);
      const savedInteractiveMode = localStorage.getItem(INTERACTIVE_MODE_STORAGE_KEY);
      const updates: Partial<FormState> = {};
      if (savedWebSearch === 'true') updates.webSearch = true;
      if (savedInteractiveMode === 'true') updates.interactiveMode = true;
      if (Object.keys(updates).length > 0) setForm((prev) => ({ ...prev, ...updates }));
    } catch {}
  }, []);

  const draftRestoredRef = useRef(false);
  useEffect(() => {
    if (draftRestoredRef.current) return;
    if (!cachedRequirement) return;
    draftRestoredRef.current = true;
    setForm((prev) => (prev.requirement ? prev : { ...prev, requirement: cachedRequirement }));
  }, [cachedRequirement]);

  const updateForm = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    try {
      if (field === 'webSearch') localStorage.setItem(WEB_SEARCH_STORAGE_KEY, String(value));
      if (field === 'interactiveMode') localStorage.setItem(INTERACTIVE_MODE_STORAGE_KEY, String(value));
      if (field === 'requirement') updateRequirementCache(value as string);
    } catch {}
  };

  const addCourseMaterials = (files: File[]) => {
    if (preparingGenerate) return;
    const dedupedFiles = dedupeCourseMaterialFiles(form.courseMaterials, files);
    const startOrder = form.courseMaterials.length + 1;
    const additions = dedupedFiles.map((file, index) => ({
      id: nanoid(8),
      file,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      type: file.type,
      order: startOrder + index,
    }));
    if (additions.length === 0) return;
    setForm((prev) => {
      const missing = additions.filter((addition) => {
        if (prev.courseMaterials.some((item) => item.id === addition.id)) return false;
        return !prev.courseMaterials.some((item) => courseMaterialFingerprint(item) === courseMaterialFingerprint(addition));
      });
      if (missing.length === 0) return prev;
      return { ...prev, courseMaterials: [...prev.courseMaterials, ...missing] };
    });
  };

  const removeCourseMaterial = (id: string) => {
    if (preparingGenerate) return;
    setForm((prev) => ({
      ...prev,
      courseMaterials: prev.courseMaterials.filter((item) => item.id !== id).map((item, index) => ({ ...item, order: index + 1 })),
    }));
  };

  const handleGenerate = async () => {
    if (preparingGenerate) return;
    if (!form.requirement.trim()) {
      setError(t('upload.requirementRequired'));
      return;
    }
    setError(null);
    const frozenMaterials = [...form.courseMaterials].sort((a, b) => a.order - b.order);
    const settingsSnapshot = useSettingsStore.getState();
    const frozenPdfProviderId = settingsSnapshot.pdfProviderId;
    const frozenPdfProviderConfig = settingsSnapshot.pdfProvidersConfig?.[settingsSnapshot.pdfProviderId]
      ? {
          apiKey: settingsSnapshot.pdfProvidersConfig[settingsSnapshot.pdfProviderId].apiKey,
          baseUrl: settingsSnapshot.pdfProvidersConfig[settingsSnapshot.pdfProviderId].baseUrl,
          accessKeyId: settingsSnapshot.pdfProvidersConfig[settingsSnapshot.pdfProviderId].accessKeyId,
          accessKeySecret: settingsSnapshot.pdfProvidersConfig[settingsSnapshot.pdfProviderId].accessKeySecret,
        }
      : undefined;
    setPreparingGenerate(true);
    try {
      const userProfile = useUserProfileStore.getState();
      const requirements: UserRequirements = {
        requirement: form.requirement,
        userNickname: userProfile.nickname || undefined,
        userBio: userProfile.bio || undefined,
        webSearch: form.webSearch || undefined,
        interactiveMode: form.vocationalTestMode ? true : form.interactiveMode,
        ...(form.vocationalTestMode ? { taskEngineMode: true } : {}),
      };
      let documentSources: SessionDocumentSource[] | undefined;
      let pdfProviderId: string | undefined;
      let pdfProviderConfig: { apiKey?: string; baseUrl?: string; accessKeyId?: string; accessKeySecret?: string } | undefined;
      if (frozenMaterials.length > 0) {
        pdfProviderId = frozenPdfProviderId;
        pdfProviderConfig = frozenPdfProviderConfig;
        const storedDocumentKeys: string[] = [];
        try {
          documentSources = [];
          for (const [index, item] of frozenMaterials.entries()) {
            const storageKey = await storeDocumentBlob(item.file);
            storedDocumentKeys.push(storageKey);
            documentSources.push({
              id: item.id,
              name: item.name,
              size: item.size,
              lastModified: item.lastModified,
              mimeType: normalizeDocumentMimeType({ mimeType: item.file.type, fileName: item.file.name }),
              order: index + 1,
              storageKey,
              providerId: pdfProviderId,
            });
          }
        } catch (error) {
          await Promise.allSettled(storedDocumentKeys.map((key) => deleteDocumentBlob(key)));
          throw error;
        }
      }
      const sessionState = {
        sessionId: nanoid(),
        requirements,
        pdfText: '',
        pdfImages: [],
        imageStorageIds: [],
        documentSources,
        pdfStorageKey: documentSources?.[0]?.storageKey,
        pdfFileName: documentSources?.[0]?.name,
        documentMimeType: documentSources?.[0]?.mimeType,
        pdfProviderId,
        pdfProviderConfig,
        sceneOutlines: null,
        currentStep: 'generating' as const,
      };
      sessionStorage.setItem('generationSession', JSON.stringify(sessionState));
      router.push('/generation-preview');
    } catch (err) {
      log.error('Error preparing generation:', err);
      setError(err instanceof Error ? err.message : t('upload.generateFailed'));
    } finally {
      setPreparingGenerate(false);
    }
  };

  const canGenerate = !!form.requirement.trim() && hasUsableProvider;
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (canGenerate && !preparingGenerate) handleGenerate();
    }
  };

  useEffect(() => {
    useMediaGenerationStore.getState().revokeObjectUrls();
    useMediaGenerationStore.setState({ tasks: {} });
  }, []);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }
  if (!isGuruAuthed) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 grid place-items-center p-6 text-center">
        <div>
          <ShieldCheck className="w-8 h-8 mx-auto text-slate-400 mb-3" />
          <p className="text-sm text-slate-600 dark:text-slate-300">Mengalihkan ke halaman masuk…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="sticky top-0 z-30 bg-white/80 dark:bg-slate-900/80 backdrop-blur border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto max-w-[900px] px-4 h-[56px] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/dashboard')} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h1 className="text-sm font-bold text-slate-900 dark:text-white">Studio KelasKA</h1>
              <p className="text-[11px] text-slate-500">Buat kelas interaktif dari prompt atau dokumen</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AgentBar />
            <Button variant="outline" size="sm" className="rounded-full hidden sm:inline-flex" onClick={() => router.push('/materi')}>Materi Saya</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[900px] px-4 py-6 md:py-8">
        <div className="rounded-[24px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
          <div className="px-4 pt-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-violet-500" /> Composer</span>
              <span className="w-px h-3 bg-slate-200 dark:bg-slate-700" />
              <span className="text-[11px] font-normal">Draft → Review → Publish → Assign</span>
            </div>
          </div>

          <div className="p-4">
            <textarea
              ref={textareaRef}
              placeholder={t('upload.requirementPlaceholder')}
              className="w-full resize-none border-0 bg-transparent px-1 pt-1 pb-2 text-[14px] leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none min-h-[140px] max-h-[320px] text-slate-900 dark:text-slate-100"
              value={form.requirement}
              onChange={(e) => updateForm('requirement', e.target.value)}
              onKeyDown={handleKeyDown}
              rows={5}
            />
            <div className="flex items-end gap-2 mt-2">
              <div className="flex-1 min-w-0">
                <GenerationToolbar
                  webSearch={form.webSearch}
                  onWebSearchChange={(v) => updateForm('webSearch', v)}
                  onSettingsOpen={(section) => {
                    setSettingsSection(section);
                    setSettingsOpen(true);
                  }}
                  courseMaterials={form.courseMaterials ?? []}
                  onCourseMaterialsAdd={addCourseMaterials}
                  onCourseMaterialRemove={removeCourseMaterial}
                  onPdfError={setError}
                  materialsLocked={preparingGenerate}
                />
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <InteractiveModeButton pressed={form.interactiveMode} label={t('toolbar.interactiveModeLabel')} onPressedChange={(pressed) => updateForm('interactiveMode', pressed)} />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">{t('toolbar.interactiveModeHint')}</TooltipContent>
              </Tooltip>
              <SpeechButton
                size="md"
                onTranscription={(text) => {
                  setForm((prev) => {
                    const next = prev.requirement + (prev.requirement ? ' ' : '') + text;
                    updateRequirementCache(next);
                    return { ...prev, requirement: next };
                  });
                }}
              />
              <button
                onClick={handleGenerate}
                disabled={!canGenerate || preparingGenerate}
                className={cn(
                  'shrink-0 h-9 rounded-xl flex items-center justify-center gap-1.5 transition-all px-4 text-sm font-medium',
                  canGenerate && !preparingGenerate ? 'bg-primary text-primary-foreground hover:opacity-90 shadow-sm cursor-pointer' : 'bg-muted text-muted-foreground/40 cursor-not-allowed',
                )}
              >
                <span>{preparingGenerate ? t('stage.generating') : t('toolbar.enterClassroom')}</span>
                {preparingGenerate ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />}
              </button>
            </div>

            {showVocationalTestUi && (
              <div className="mt-3 flex w-full justify-start">
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.vocationalTestMode}
                  onClick={() => updateForm('vocationalTestMode', !form.vocationalTestMode)}
                  className={cn(
                    'inline-flex h-7 items-center gap-2 rounded-full border px-2.5 text-[11px] font-medium transition-colors',
                    form.vocationalTestMode ? 'border-cyan-400/70 bg-cyan-50 text-cyan-700 shadow-[0_0_10px_rgba(6,182,212,0.16)] dark:bg-cyan-950/40 dark:text-cyan-300' : 'border-border/70 bg-background/70 text-muted-foreground hover:border-cyan-300/60 hover:text-cyan-700 dark:hover:text-cyan-300',
                  )}
                >
                  <span className="rounded-full bg-cyan-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-normal text-cyan-700 dark:bg-cyan-900/45 dark:text-cyan-300">
                    {t('vocational.testFeature')}
                  </span>
                  <Sparkles className="size-3.5" />
                  <span>{t('vocational.vocationalTask')}</span>
                  <span className={cn('relative h-3.5 w-6 rounded-full transition-colors', form.vocationalTestMode ? 'bg-cyan-500' : 'bg-muted-foreground/25')}>
                    <span className={cn('absolute left-0.5 top-0.5 size-2.5 rounded-full bg-white transition-transform', form.vocationalTestMode ? 'translate-x-2.5' : 'translate-x-0')} />
                  </span>
                </button>
              </div>
            )}

            <AnimatePresence>
              {error && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-3 w-full p-3 bg-destructive/10 border border-destructive/20 rounded-xl">
                  <p className="text-sm text-destructive">{error}</p>
                </motion.div>
              )}
            </AnimatePresence>
            <p className="mt-3 text-[11px] text-slate-400 dark:text-slate-500">Tekan <span className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-[10px]">⌘ + Enter</span> untuk buat kelas • Mendukung PDF, Word, PPTX, gambar, audio &amp; video • Web Search &amp; Interactive Mode opsional</p>
          </div>

          <div className="px-4 py-2.5 bg-slate-50/80 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Server siap</span>
              <span className="w-px h-3 bg-slate-200 dark:bg-slate-700 hidden sm:inline" />
              <span className="hidden sm:inline">Outline editable sebelum full generate • Hasil draft milik Anda</span>
            </span>
            <span className="hidden sm:inline">Vercel + Supabase</span>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 flex gap-3">
          <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed text-amber-900 dark:text-amber-200">
            <span className="font-semibold">Siklus wajib:</span> hasil generate berstatus <span className="font-mono px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900 border border-amber-200 dark:border-amber-800">draft</span> → review di Classroom → <span className="font-semibold">Publish</span> → <span className="font-semibold">Assign</span> ke KA-101..103. Siswa hanya melihat yang <span className="font-semibold">published + assigned</span> ke kelasnya.
          </div>
        </div>

        <div className="mt-6 flex gap-2">
          <Button variant="outline" className="rounded-full" onClick={() => router.push('/materi')}>
            <GraduationCap className="w-4 h-4" /> Lihat Materi Saya
          </Button>
          <Button variant="ghost" className="rounded-full" onClick={() => router.push('/dashboard')}>Kembali ke Dashboard</Button>
        </div>
      </main>

      <SettingsDialog open={settingsOpen} onOpenChange={(open) => { setSettingsOpen(open); if (!open) setSettingsSection(undefined); }} initialSection={settingsSection} />
    </div>
  );
}
