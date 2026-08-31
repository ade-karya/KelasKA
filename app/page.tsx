'use client';

import { useState, useEffect, useMemo, useRef, useDeferredValue } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Folder,
  FolderPlus,
  ImagePlus,
  Pencil,
  Trash2,
  Search,
  Settings,
  Sun,
  Moon,
  Monitor,
  ChevronUp,
  Upload,
  Sparkles,
  Atom,
  X,
  Presentation,
  Loader2,
  BookOpen,
  Users,
  Zap,
  Layers,
  GraduationCap,
  Play,
  CheckCircle2,
  Star,
  Quote,
  ArrowRight,
  Shield,
  Wand2,
  Mic,
  PenTool,
  BarChart3,
  Gamepad2,
  Lightbulb,
  Rocket,
  Globe,
  Smartphone,
  MonitorSmartphone,
  Award,
  HeartHandshake,
  Menu,
} from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { LanguageSwitcher } from '@/components/language-switcher';
import { createLogger } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupInput, InputGroupButton } from '@/components/ui/input-group';
import { Textarea as UITextarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { SettingsDialog } from '@/components/settings';
import { GenerationToolbar } from '@/components/generation/generation-toolbar';
import { AgentBar } from '@/components/agent/agent-bar';
import { useTheme } from '@/lib/hooks/use-theme';
import { nanoid } from 'nanoid';
import { deleteDocumentBlob, storeDocumentBlob } from '@/lib/utils/image-storage';
import { BrandLogo } from '@/components/brand-logo';
import { normalizeDocumentMimeType } from '@/lib/document/mime';
import {
  courseMaterialFingerprint,
  dedupeCourseMaterialFiles,
} from '@/lib/document/course-materials';
import type {
  SelectedCourseMaterial,
  SessionDocumentSource,
  UserRequirements,
} from '@/lib/types/generation';
import { useSettingsStore } from '@/lib/store/settings';
import { hasUsableLLMProvider } from '@/lib/store/settings-validation';
import { useUserProfileStore, AVATAR_OPTIONS } from '@/lib/store/user-profile';
import {
  StageListItem,
  listStages,
  deleteStageData,
  renameStage,
  getFirstSlideByStages,
  revokeThumbnailSlideMediaUrls,
  listFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  setStageFolder,
  FolderNameError,
  type DeleteFolderMode,
} from '@/lib/utils/stage-storage';
import type { FolderRecord } from '@/lib/utils/database';
import { displayNameWidth, FOLDER_NAME_MAX_WIDTH } from '@/lib/utils/folder-name-validation';
import { FolderCard } from '@/components/discovery/folder-card';
import { NewFolderDialog } from '@/components/discovery/folder-dialogs';
import { MoveToFolderMenu } from '@/components/discovery/move-to-folder-menu';
import { SlideThumbnail } from '@/components/slide-renderer/SlideThumbnail';
import type { Slide } from '@openmaic/dsl';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDraftCache } from '@/lib/hooks/use-draft-cache';
import { SpeechButton } from '@/components/audio/speech-button';
import { useImportClassroom } from '@/lib/import/use-import-classroom';
import {
  isProWorkbenchEnabled,
  isPptxImportEnabled,
  shouldShowVocationalTestUi,
} from '@/lib/config/feature-flags';
import { useImportPptx } from '@/lib/import/use-import-pptx';
import { InteractiveModeButton } from '@/components/generation/interactive-mode-button';
import { ProBadge } from '@/components/workbench/ProBadge';
import { arrivedByProSwap, startProSwap } from '@/lib/workbench/pro-swap';
import {
  readLastWorkspaceSessionId,
  workspaceResumeHref,
} from '@/lib/workbench/workspace-session-memory';
// ProBadge kept for workbench entry in hero when enabled

const log = createLogger('Home');

const WEB_SEARCH_STORAGE_KEY = 'webSearchEnabled';
const RECENT_OPEN_STORAGE_KEY = 'recentClassroomsOpen';
const INTERACTIVE_MODE_STORAGE_KEY = 'interactiveModeEnabled';

const PPTX_IMPORT_ENABLED = isPptxImportEnabled();

let workbenchRuntimeCache: boolean | null = null;

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

function HomePage() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [swapped] = useState(arrivedByProSwap);
  const heroEnter = (from: Record<string, number>) => (swapped ? false : from);
  const showVocationalTestUi = shouldShowVocationalTestUi();
  const workbenchBuildEnabled = isProWorkbenchEnabled();
  const [workbenchRuntimeEnabled, setWorkbenchRuntimeEnabled] = useState(
    workbenchRuntimeCache === true,
  );
  useEffect(() => {
    if (!workbenchBuildEnabled || workbenchRuntimeCache !== null) return;
    let cancelled = false;
    fetch('/api/agent/runtime')
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        workbenchRuntimeCache = body?.enabled === true;
        if (!cancelled) setWorkbenchRuntimeEnabled(workbenchRuntimeCache);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workbenchBuildEnabled]);
  const workbenchEntryEnabled = workbenchBuildEnabled && workbenchRuntimeEnabled;
  const enterWorkbench = () => {
    const href = workspaceResumeHref(readLastWorkspaceSessionId());
    startProSwap(href, (next) => router.push(next));
  };
  useEffect(() => {
    if (workbenchEntryEnabled) router.prefetch('/workspace');
  }, [router, workbenchEntryEnabled]);
  const [form, setForm] = useState<FormState>(initialFormState);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<
    import('@/lib/types/settings').SettingsSection | undefined
  >(undefined);

  const { cachedValue: cachedRequirement, updateCache: updateRequirementCache } =
    useDraftCache<string>({ key: 'requirementDraft' });

  const providersConfig = useSettingsStore((s) => s.providersConfig);
  const hasUsableProvider = hasUsableLLMProvider(providersConfig);
  const [recentOpen, setRecentOpen] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const persistRecentOpen = (next: boolean) => {
    setRecentOpen(next);
    try {
      localStorage.setItem(RECENT_OPEN_STORAGE_KEY, String(next));
    } catch {}
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_OPEN_STORAGE_KEY);
      if (saved !== null) setRecentOpen(saved !== 'false');
    } catch {}
    try {
      const savedWebSearch = localStorage.getItem(WEB_SEARCH_STORAGE_KEY);
      const savedInteractiveMode = localStorage.getItem(INTERACTIVE_MODE_STORAGE_KEY);
      const updates: Partial<FormState> = {};
      if (savedWebSearch === 'true') updates.webSearch = true;
      if (savedInteractiveMode === 'true') updates.interactiveMode = true;
      if (Object.keys(updates).length > 0) {
        setForm((prev) => ({ ...prev, ...updates }));
      }
    } catch {}
  }, []);

  const draftRestoredRef = useRef(false);
  useEffect(() => {
    if (draftRestoredRef.current) return;
    if (!cachedRequirement) return;
    draftRestoredRef.current = true;
    setForm((prev) => (prev.requirement ? prev : { ...prev, requirement: cachedRequirement }));
  }, [cachedRequirement]);

  const [themeOpen, setThemeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preparingGenerate, setPreparingGenerate] = useState(false);
  const [classrooms, setClassrooms] = useState<StageListItem[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, Slide>>({});
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(undefined);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [createAndMoveTarget, setCreateAndMoveTarget] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const thumbnailsRef = useRef<Record<string, Slide>>({});
  const composerRef = useRef<HTMLDivElement>(null);

  const scrollToComposer = () => {
    router.push('/masuk');
  };
  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMobileNavOpen(false);
  };

  const replaceThumbnails = (slides: Record<string, Slide>) => {
    const previous = thumbnailsRef.current;
    thumbnailsRef.current = slides;
    setThumbnails(slides);
    window.setTimeout(() => revokeThumbnailSlideMediaUrls(previous), 0);
  };

  useEffect(() => {
    if (!themeOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setThemeOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [themeOpen]);

  const loadClassrooms = async () => {
    try {
      const list = await listStages();
      setClassrooms(list);
      if (list.length > 0) {
        const slides = await getFirstSlideByStages(list.map((c) => c.id));
        replaceThumbnails(slides);
      } else {
        replaceThumbnails({});
      }
    } catch (err) {
      log.error('Failed to load classrooms:', err);
      toast.error('Persistence is unavailable. Saved classrooms could not be loaded.');
    }
  };

  const loadFolders = async () => {
    try {
      setFolders(await listFolders());
    } catch (err) {
      log.error('Failed to load folders:', err);
    }
  };

  const importFolderRef = useRef<string | undefined>(undefined);
  const handleImportSuccess = async (importedStageId: string) => {
    const folderId = importFolderRef.current;
    importFolderRef.current = undefined;
    if (folderId) {
      try {
        await setStageFolder(importedStageId, folderId);
      } catch (err) {
        log.error('Failed to assign imported course to folder:', err);
        toast.error(t('classroom.moveFailed'));
      }
    }
    await loadClassrooms();
  };
  const { importing, fileInputRef, triggerFileSelect, handleFileChange } =
    useImportClassroom(handleImportSuccess);
  const triggerImport = () => {
    importFolderRef.current = currentFolderId;
    triggerFileSelect();
  };

  const {
    importing: pptxImporting,
    fileInputRef: pptxFileInputRef,
    triggerFileSelect: triggerPptxFileSelect,
    handleFileChange: handlePptxFileChange,
  } = useImportPptx();

  useEffect(() => {
    useMediaGenerationStore.getState().revokeObjectUrls();
    useMediaGenerationStore.setState({ tasks: {} });
    void Promise.all([loadClassrooms(), loadFolders()]).finally(() => setHydrated(true));
    return () => {
      revokeThumbnailSlideMediaUrls(thumbnailsRef.current);
      thumbnailsRef.current = {};
    };
  }, []);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingDeleteId(id);
  };

  const confirmDelete = async (id: string) => {
    setPendingDeleteId(null);
    try {
      await deleteStageData(id);
      await loadClassrooms();
    } catch (err) {
      log.error('Failed to delete classroom:', err);
      toast.error('Failed to delete classroom');
    }
  };

  const handleRename = async (id: string, newName: string) => {
    try {
      await renameStage(id, newName);
      setClassrooms((prev) => prev.map((c) => (c.id === id ? { ...c, name: newName } : c)));
    } catch (err) {
      log.error('Failed to rename classroom:', err);
      toast.error(t('classroom.renameFailed'));
    }
  };

  const handleCreateFolder = async (name: string) => {
    const folder = await createFolder(name);
    setFolders((prev) => [...prev, folder]);
    if (createAndMoveTarget) {
      await handleMoveCourse(createAndMoveTarget, folder.id);
      setCreateAndMoveTarget(null);
    }
  };

  const handleRenameFolder =
    (folder: FolderRecord) =>
    async (newName: string): Promise<string | null> => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed === folder.name) return null;
      try {
        await renameFolder(folder.id, newName);
        setFolders((prev) => prev.map((f) => (f.id === folder.id ? { ...f, name: trimmed } : f)));
        return null;
      } catch (err) {
        if (err instanceof FolderNameError) {
          if (err.kind === 'duplicate') return t('classroom.folderNameExists');
          if (err.kind === 'tooLong')
            return t('classroom.folderWidth', {
              width: displayNameWidth(trimmed),
              max: FOLDER_NAME_MAX_WIDTH,
            });
          return t('classroom.folderNameHint');
        }
        log.error('Failed to rename folder:', err);
        return t('classroom.folderRenameFailed');
      }
    };

  const confirmDeleteFolder = async (folder: FolderRecord, mode: DeleteFolderMode) => {
    try {
      await deleteFolder(folder.id, mode);
      if (currentFolderId === folder.id) setCurrentFolderId(undefined);
    } catch (err) {
      log.error('Failed to delete folder:', err);
      toast.error(t('classroom.folderDeleteFailed'));
    } finally {
      await Promise.all([loadFolders(), loadClassrooms()]);
    }
  };

  const handleMoveCourse = async (stageId: string, folderId: string | undefined) => {
    setClassrooms((prev) => prev.map((c) => (c.id === stageId ? { ...c, folderId } : c)));
    try {
      await setStageFolder(stageId, folderId);
    } catch (err) {
      log.error('Failed to move course:', err);
      toast.error(t('classroom.moveFailed'));
      await loadClassrooms();
    }
  };

  const handleCreateAndMove = (stageId: string) => () => {
    setCreateAndMoveTarget(stageId);
    setNewFolderOpen(true);
  };

  const deferredSearchQuery = useDeferredValue(searchQuery);
  const filteredClassrooms = useMemo(() => {
    const q = deferredSearchQuery.trim().toLowerCase();
    if (!q) return classrooms;
    return classrooms.filter((c) => {
      const name = c.name?.toLowerCase() ?? '';
      const desc = c.description?.toLowerCase() ?? '';
      return name.includes(q) || desc.includes(q);
    });
  }, [classrooms, deferredSearchQuery]);

  const folderNameById = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders]);
  const isSearching = deferredSearchQuery.trim().length > 0;
  const visibleClassrooms = useMemo(() => {
    if (isSearching) return filteredClassrooms;
    if (currentFolderId) return filteredClassrooms.filter((c) => c.folderId === currentFolderId);
    return filteredClassrooms.filter(
      (c) => c.folderId === undefined || !folderNameById.has(c.folderId),
    );
  }, [filteredClassrooms, isSearching, currentFolderId, folderNameById]);
  const currentFolderClassrooms = useMemo(
    () => (currentFolderId ? classrooms.filter((c) => c.folderId === currentFolderId) : []),
    [classrooms, currentFolderId],
  );
  const courseCountByFolder = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of classrooms) {
      if (c.folderId) counts.set(c.folderId, (counts.get(c.folderId) ?? 0) + 1);
    }
    return counts;
  }, [classrooms]);
  const coverSlidesByFolder = useMemo(() => {
    const byFolder = new Map<string, Slide[]>();
    for (const c of [...classrooms].sort((a, b) => b.updatedAt - a.updatedAt)) {
      if (!c.folderId) continue;
      const slide = thumbnails[c.id];
      if (!slide) continue;
      const list = byFolder.get(c.folderId) ?? [];
      if (list.length < 3) list.push(slide);
      byFolder.set(c.folderId, list);
    }
    return byFolder;
  }, [classrooms, thumbnails]);
  const currentFolder = folders.find((f) => f.id === currentFolderId);

  const updateForm = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    try {
      if (field === 'webSearch') localStorage.setItem(WEB_SEARCH_STORAGE_KEY, String(value));
      if (field === 'interactiveMode')
        localStorage.setItem(INTERACTIVE_MODE_STORAGE_KEY, String(value));
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
        return !prev.courseMaterials.some(
          (item) => courseMaterialFingerprint(item) === courseMaterialFingerprint(addition),
        );
      });
      if (missing.length === 0) return prev;
      return { ...prev, courseMaterials: [...prev.courseMaterials, ...missing] };
    });
  };

  const removeCourseMaterial = (id: string) => {
    if (preparingGenerate) return;
    setForm((prev) => ({
      ...prev,
      courseMaterials: prev.courseMaterials
        .filter((item) => item.id !== id)
        .map((item, index) => ({ ...item, order: index + 1 })),
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
    const frozenPdfProviderConfig = settingsSnapshot.pdfProvidersConfig?.[
      settingsSnapshot.pdfProviderId
    ]
      ? {
          apiKey: settingsSnapshot.pdfProvidersConfig[settingsSnapshot.pdfProviderId].apiKey,
          baseUrl: settingsSnapshot.pdfProvidersConfig[settingsSnapshot.pdfProviderId].baseUrl,
          accessKeyId:
            settingsSnapshot.pdfProvidersConfig[settingsSnapshot.pdfProviderId].accessKeyId,
          accessKeySecret:
            settingsSnapshot.pdfProvidersConfig[settingsSnapshot.pdfProviderId].accessKeySecret,
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
      let pdfProviderConfig:
        | { apiKey?: string; baseUrl?: string; accessKeyId?: string; accessKeySecret?: string }
        | undefined;
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
              mimeType: normalizeDocumentMimeType({
                mimeType: item.file.type,
                fileName: item.file.name,
              }),
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

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return t('classroom.today');
    if (diffDays === 1) return t('classroom.yesterday');
    if (diffDays < 7) return `${diffDays} ${t('classroom.daysAgo')}`;
    return date.toLocaleDateString('id-ID');
  };

  const canGenerate = !!form.requirement.trim() && hasUsableProvider;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (canGenerate && !preparingGenerate) handleGenerate();
    }
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 overflow-x-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        onChange={handleFileChange}
        className="hidden"
      />
      {PPTX_IMPORT_ENABLED && (
        <input
          ref={pptxFileInputRef}
          type="file"
          accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          onChange={handlePptxFileChange}
          className="hidden"
        />
      )}

      {/* ==================== NAVBAR (Landing) ==================== */}
      <header className="sticky top-0 z-40 w-full border-b border-slate-200/60 dark:border-slate-800/60 bg-white/70 dark:bg-slate-950/60 backdrop-blur-xl">
        <div className="mx-auto max-w-[1280px] px-4 md:px-6 h-[64px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex items-center gap-2.5">
              <BrandLogo size="sm" />
            </button>
            <nav className="hidden lg:flex items-center gap-1 text-[13px] font-medium">
              {[
                { label: 'Fitur', id: 'fitur' },
                { label: 'Cara Kerja', id: 'cara-kerja' },
                { label: 'Untuk Siapa', id: 'untuk-siapa' },
                { label: 'Kontak', id: 'cta' },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => scrollToSection(item.id)}
                  className="px-3 py-2 rounded-full text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="hidden md:flex items-center gap-1.5 mr-1">
              <LanguageSwitcher onOpen={() => setThemeOpen(false)} />
              <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />
              <div className="relative" ref={toolbarRef}>
                <button
                  onClick={() => setThemeOpen(!themeOpen)}
                  className="p-2 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                  aria-label="Theme"
                >
                  {theme === 'light' && <Sun className="w-4 h-4" />}
                  {theme === 'dark' && <Moon className="w-4 h-4" />}
                  {theme === 'system' && <Monitor className="w-4 h-4" />}
                </button>
                {themeOpen && (
                  <div className="absolute top-full mt-2 right-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden z-50 min-w-[160px] p-1">
                    {[
                      { v: 'light' as const, icon: Sun, label: t('settings.themeOptions.light') },
                      { v: 'dark' as const, icon: Moon, label: t('settings.themeOptions.dark') },
                      { v: 'system' as const, icon: Monitor, label: t('settings.themeOptions.system') },
                    ].map(({ v, icon: Icon, label }) => (
                      <button
                        key={v}
                        onClick={() => {
                          setTheme(v);
                          setThemeOpen(false);
                        }}
                        className={cn(
                          'w-full px-3 py-2 text-left text-sm rounded-lg flex items-center gap-2 transition-colors',
                          theme === v
                            ? 'bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-700/50',
                        )}
                      >
                        <Icon className="w-4 h-4" /> {label}
                        {theme === v && <Check className="w-3 h-3 ml-auto" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => setSettingsOpen(true)}
                className="p-2 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="hidden md:inline-flex rounded-full"
              onClick={() => router.push('/masuk')}
            >
              Masuk
            </Button>
            <Button
              onClick={() => router.push('/masuk')}
              size="sm"
              className="hidden md:inline-flex rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-md shadow-violet-500/20 px-5"
            >
              Mulai
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
            <button
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
              className="lg:hidden p-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
            >
              {mobileNavOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <AnimatePresence>
          {mobileNavOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="lg:hidden border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur-xl overflow-hidden"
            >
              <div className="px-4 py-4 space-y-1">
                {[
                  { label: 'Fitur', id: 'fitur' },
                  { label: 'Cara Kerja', id: 'cara-kerja' },
                  { label: 'Untuk Siapa', id: 'untuk-siapa' },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => scrollToSection(item.id)}
                    className="w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {item.label}
                  </button>
                ))}
                <div className="pt-3 flex gap-2">
                  <Button variant="outline" className="flex-1 rounded-full" onClick={() => router.push('/masuk')}>
                    Masuk
                  </Button>
                  <Button className="flex-1 rounded-full bg-violet-600 hover:bg-violet-500" onClick={() => router.push('/masuk')}>
                    Mulai
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (!open) setSettingsSection(undefined);
        }}
        initialSection={settingsSection}
      />

      {/* ==================== HERO ==================== */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-b from-violet-50/80 via-indigo-50/40 to-transparent dark:from-violet-950/20 dark:via-indigo-950/10" />
          <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-violet-300/20 dark:bg-violet-600/10 rounded-full blur-[100px] -translate-y-1/2" />
          <div className="absolute top-20 right-1/4 w-[500px] h-[500px] bg-blue-300/20 dark:bg-blue-600/10 rounded-full blur-[100px]" />
          <div className="absolute bottom-0 left-1/3 w-[700px] h-[400px] bg-indigo-200/20 dark:bg-indigo-600/10 rounded-full blur-[90px]" />
        </div>

        <div className="mx-auto max-w-[1280px] px-4 md:px-6 pt-8 md:pt-14 pb-6">
          {/* Top badge + social proof */}
          <motion.div
            initial={heroEnter({ opacity: 0, y: 10 })}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col items-center text-center"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-100 dark:bg-violet-900/30 border border-violet-200 dark:border-violet-800 text-[11px] font-semibold tracking-wide text-violet-700 dark:text-violet-300">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                PLATFORM PEMBELAJARAN AI GENERATIF
              </span>
            </div>

            <motion.h1
              initial={heroEnter({ opacity: 0, y: 12 })}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.6 }}
              className="mt-5 max-w-4xl text-[30px] md:text-[48px] lg:text-[56px] font-black tracking-tight leading-[0.95] text-slate-900 dark:text-white"
            >
              Satu prompt,{' '}
              <span className="bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-600 bg-clip-text text-transparent">
                satu kelas utuh
              </span>{' '}
              langsung jadi.
            </motion.h1>

            <motion.p
              initial={heroEnter({ opacity: 0 })}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="mt-4 max-w-2xl text-[15px] md:text-[17px] leading-relaxed text-slate-600 dark:text-slate-300"
            >
              {t('home.slogan')} — ubah topik atau dokumen apa pun menjadi pengalaman kelas interaktif
              dengan slide, kuis, simulasi, dan tutor AI yang mengajar layaknya kelas nyata.
            </motion.p>

            <motion.div
              initial={heroEnter({ opacity: 0, y: 8 })}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="mt-6 flex flex-wrap items-center justify-center gap-3 text-xs"
            >
              <button
                onClick={() => router.push('/masuk')}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold shadow-lg shadow-slate-900/20 hover:shadow-xl hover:-translate-y-px transition-all"
              >
                <Wand2 className="w-4 h-4" />
                Masuk untuk Membuat Kelas
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => router.push('/masuk')}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                <LayoutDashboardIcon />
                Masuk
              </button>
              <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-600 dark:text-slate-400">
                <Shield className="w-3 h-3 text-violet-500" /> Aman untuk sekolah • Review wajib sebelum publish
              </span>
            </motion.div>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-4 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Tanpa kartu kredit</span>
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Ekspor PPTX & HTML</span>
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Bisa offline</span>
              <span className="inline-flex items-center gap-1.5"><Shield className="w-3.5 h-3.5 text-violet-500" /> Aman untuk sekolah</span>
            </div>
          </motion.div>

          {/* Studio preview — non-interactive; CTA ke /masuk */}
          <motion.div
            initial={heroEnter({ opacity: 0, scale: 0.98 })}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.35 }}
            className="mx-auto mt-10 max-w-[800px]"
          >
            <div className="rounded-[24px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.15)] overflow-hidden">
              <div className="p-5 md:p-6">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                  <Sparkles className="w-3.5 h-3.5 text-violet-500" /> CONTOH COMPOSER STUDIO
                  <span className="ml-auto px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 text-[10px]">Hanya di /studio setelah login guru</span>
                </div>
                <div className="mt-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Tulis kebutuhan mengajar, unggah RPP/PDF, aktifkan Web Search bila perlu.</p>
                  <p className="text-xs text-slate-500 mt-1">Contoh: “Buatkan kelas Komputer Akuntansi dasar untuk KA-101: jurnal umum dan buku besar dengan simulasi interaktif”</p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button onClick={() => router.push('/masuk')} className="rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900">
                    <Wand2 className="w-4 h-4" /> Masuk untuk Membuat Kelas
                  </Button>
                  <Button variant="outline" onClick={() => router.push('/masuk')} className="rounded-full">Lihat Studio</Button>
                </div>
              </div>
              <div className="px-4 py-2.5 bg-slate-50/80 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span>Satu prompt → outline editable → draft → review → publish → assign</span>
                <span className="hidden sm:inline">Vercel + Supabase</span>
              </div>
            </div>
            <p className="mt-3 text-center text-[11px] text-slate-400 dark:text-slate-500">Composer tidak ada di landing. Masuk sebagai guru di <button onClick={() => router.push('/masuk')} className="underline hover:text-slate-600">/masuk</button> untuk membuka Studio.</p>
          </motion.div>

          <div className="mx-auto mt-10 max-w-5xl flex flex-col items-center gap-4">
            <p className="text-[11px] font-semibold tracking-widest text-slate-400 dark:text-slate-500 uppercase">Dibuat untuk SMK</p>
            <div className="flex flex-wrap items-center justify-center gap-6 md:gap-10 opacity-60">
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300"><GraduationCap className="w-4 h-4" /> KA-101</span>
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300"><BookOpen className="w-4 h-4" /> KA-102</span>
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300"><Users className="w-4 h-4" /> KA-103</span>
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300"><Award className="w-4 h-4" /> Komputer Akuntansi</span>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== CHIP INTRO — kejujuran metrik ==================== */}
      <section className="mx-auto max-w-[1280px] px-4 md:px-6 mt-6">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-center gap-6 text-xs text-slate-600 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Tanpa rating fiktif</span>
          <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Jam belajar jujur (dari sesi, bukan rumus)</span>
          <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Ekspor PPTX & HTML/ZIP</span>
          <span className="inline-flex items-center gap-1.5"><Shield className="w-3.5 h-3.5 text-violet-500" /> Tenant terisolasi</span>
        </div>
      </section>
      <section className="mx-auto max-w-[1280px] px-4 md:px-6 mt-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {[
            { value: '<2 mnt', label: 'Dari ide ke kelas', sub: 'satu prompt jadi', icon: Zap },
            { value: '4 tipe', label: 'Scene (slide/kuis/interaktif/PBL)', sub: 'pipeline tetap', icon: Layers },
            { value: 'Vercel', label: '+ Supabase saja', sub: 'tanpa Docker prod', icon: Shield },
            { value: 'KA-101–103', label: 'Seed kelas vokasi', sub: 'Komputer Akuntansi', icon: GraduationCap },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 grid place-items-center">
                <s.icon className="w-5 h-5" />
              </div>
              <div>
                <div className="text-lg font-bold leading-none text-slate-900 dark:text-white">{s.value}</div>
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">{s.label}</div>
                <div className="text-[11px] text-slate-500">{s.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ==================== FEATURES ==================== */}
      <section id="fitur" className="mx-auto max-w-[1280px] px-4 md:px-6 pt-16 md:pt-24">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
            <Sparkles className="w-3.5 h-3.5" /> FITUR UNGGULAN
          </div>
          <h2 className="mt-3 text-[28px] md:text-[36px] font-black tracking-tight leading-none text-slate-900 dark:text-white">
            Semua yang dibutuhkan untuk
            <span className="bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent"> kelas interaktif</span>
          </h2>
          <p className="mt-3 text-sm md:text-[15px] leading-relaxed text-slate-600 dark:text-slate-300">
            Tidak hanya slide. Kelas KA menghadirkan ruang kelas multi-agen yang bisa mengajar, berdiskusi, menulis di papan tulis, dan menguji pemahaman secara real-time.
          </p>
        </div>

        <div className="mt-8 grid md:grid-cols-3 gap-4 md:gap-5">
          {[
            {
              icon: Wand2,
              title: 'Satu Prompt Jadi Kelas',
              desc: 'Tulis topik atau unggah PDF, Word, PPTX, gambar, audio, video — AI menyusun outline dan membangun kelas lengkap dalam menit.',
              accent: 'from-violet-500 to-indigo-500',
            },
            {
              icon: Users,
              title: 'Kelas Multi-Agen',
              desc: 'Guru AI dan teman sekelas AI berdiskusi, memandu, dan menjawab pertanyaanmu secara alami.',
              accent: 'from-blue-500 to-cyan-500',
            },
            {
              icon: Layers,
              title: 'Slide, Kuis, PBL & Interaktif',
              desc: 'Empat format adegan: kuliah, kuis dengan penilaian AI, simulasi HTML interaktif, dan Project-Based Learning.',
              accent: 'from-emerald-500 to-teal-500',
            },
            {
              icon: PenTool,
              title: 'Papan Tulis & Penjelasan Hidup',
              desc: 'Agen menggambar diagram, rumus LaTeX, tabel, dan grafik langsung di papan tulis sambil menjelaskan dengan suara.',
              accent: 'from-amber-500 to-orange-500',
            },
            {
              icon: Mic,
              title: 'Suara & Bahasa Alami',
              desc: 'TTS multi-provider, voice cloning, dan ASR untuk tanya jawab dengan suara. Mendukung 12 bahasa.',
              accent: 'from-fuchsia-500 to-pink-500',
            },
            {
              icon: Globe,
              title: 'Cari Web & Ekspor Fleksibel',
              desc: 'Cari informasi terbaru sebelum generate, lalu ekspor ke PPTX yang bisa diedit, HTML interaktif, atau ZIP untuk intranet (MP4 out of scope Vercel).',
              accent: 'from-indigo-500 to-violet-500',
            },
          ].map((f) => (
            <div
              key={f.title}
              className="group relative rounded-[20px] bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 p-5 md:p-6 hover:shadow-xl hover:shadow-slate-900/5 hover:-translate-y-1 transition-all"
            >
              <div className={cn('w-10 h-10 rounded-xl bg-gradient-to-br text-white grid place-items-center shadow-md', f.accent)}>
                <f.icon className="w-5 h-5" />
              </div>
              <h3 className="mt-4 font-bold text-slate-900 dark:text-white leading-tight">{f.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">{f.desc}</p>
              <div className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-violet-600 dark:text-violet-400 opacity-0 group-hover:opacity-100 transition-opacity">
                Pelajari <ChevronRight className="w-3 h-3" />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ==================== HOW IT WORKS ==================== */}
      <section id="cara-kerja" className="mx-auto max-w-[1280px] px-4 md:px-6 pt-16 md:pt-20">
        <div className="rounded-[24px] bg-slate-900 dark:bg-slate-900 border border-slate-800 p-6 md:p-10 overflow-hidden relative">
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-violet-600/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />
          <div className="relative">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-xs font-semibold text-white">
                <Rocket className="w-3.5 h-3.5" /> CARA KERJA
              </div>
              <h2 className="mt-3 text-[26px] md:text-[32px] font-black tracking-tight leading-none text-white">
                Dari ide ke kelas dalam 3 langkah
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">
                Tidak perlu menata slide manual. Cukup beri tahu apa yang ingin dipelajari.
              </p>
            </div>

            <div className="mt-8 grid md:grid-cols-3 gap-4 md:gap-6">
              {[
                {
                  step: '01',
                  title: 'Tulis atau Unggah',
                  desc: 'Ketik topik seperti "Ajari saya Python 30 menit" atau unggah PDF, Word, PPTX, gambar.',
                  icon: Upload,
                },
                {
                  step: '02',
                  title: 'AI Menyusun & Membangun',
                  desc: 'AI membuat outline terstruktur, lalu membangun setiap adegan dengan narasi, visual, dan interaksi.',
                  icon: Sparkles,
                },
                {
                  step: '03',
                  title: 'Belajar Interaktif',
                  desc: 'Masuk kelas: ikuti kuliah, jawab kuis, eksplor simulasi, dan diskusi langsung dengan agen.',
                  icon: Play,
                },
              ].map((s) => (
                <div key={s.step} className="relative rounded-2xl bg-white/[0.06] border border-white/10 p-5 backdrop-blur">
                  <div className="flex items-start justify-between">
                    <div className="w-9 h-9 rounded-xl bg-white text-slate-900 grid place-items-center">
                      <s.icon className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-black tracking-widest text-white/40">{s.step}</span>
                  </div>
                  <h3 className="mt-4 font-bold text-white">{s.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-slate-300">{s.desc}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => router.push('/masuk')} className="rounded-full bg-white text-slate-900 hover:bg-slate-100 px-6">
                <Wand2 className="w-4 h-4" /> Buat Kelas Pertamamu
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push('/masuk')}
                className="rounded-full bg-transparent border-white/20 text-white hover:bg-white/10 hover:text-white"
              >
                Lihat Contoh Kelas <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== INTERACTIVE HIGHLIGHT ==================== */}
      <section className="mx-auto max-w-[1280px] px-4 md:px-6 pt-16">
        <div className="grid lg:grid-cols-2 gap-6 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-50 dark:bg-cyan-900/30 border border-cyan-200 dark:border-cyan-800 text-xs font-semibold text-cyan-700 dark:text-cyan-300">
              <Gamepad2 className="w-3.5 h-3.5" /> MODE INTERAKTIF MENDALAM
            </div>
            <h2 className="mt-3 text-[26px] md:text-[30px] font-black tracking-tight leading-none text-slate-900 dark:text-white">
              Bukan menonton. <span className="text-cyan-600 dark:text-cyan-400">Mencoba langsung.</span>
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              Mode interaktif mengubah penonton pasif menjadi penjelajah aktif: visualisasi 3D, simulasi lab, game edukasi, peta konsep, dan coding langsung di browser.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
              {[
                { icon: Layers, label: 'Visualisasi 3D' },
                { icon: BarChart3, label: 'Simulasi & Eksperimen' },
                { icon: Gamepad2, label: 'Game Edukasi' },
                { icon: Lightbulb, label: 'Peta Konsep & Coding' },
              ].map((i) => (
                <div key={i.label} className="flex items-center gap-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2.5">
                  <i.icon className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                  <span className="font-medium text-slate-700 dark:text-slate-200">{i.label}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 flex gap-3">
              <Button onClick={() => router.push('/masuk')} size="sm" className="rounded-full">
                Aktifkan Mode Interaktif
              </Button>
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <Smartphone className="w-3.5 h-3.5" /> Responsif di HP & tablet
              </span>
            </div>
          </div>
          <div className="relative rounded-[20px] bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 p-[1px]">
            <div className="rounded-[19px] bg-white dark:bg-slate-950 p-4 md:p-6">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold tracking-widest text-slate-400">PREVIEW KELAS</span>
                <span className="px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold border border-emerald-200 dark:border-emerald-800">Live Demo</span>
              </div>
              <div className="mt-4 aspect-[16/10] rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden grid place-items-center">
                <div className="text-center p-6">
                  <div className="mx-auto w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 grid place-items-center text-white">
                    <Play className="w-6 h-6 ml-0.5" />
                  </div>
                  <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">Pratinjau Simulasi Interaktif</p>
                  <p className="text-xs text-slate-500">Seret parameter, lihat perubahan real-time</p>
                  <Button size="sm" variant="outline" className="mt-4 rounded-full" onClick={() => router.push('/masuk')}>
                    Buka di Kelas
                  </Button>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1.5 text-slate-500"><MonitorSmartphone className="w-3.5 h-3.5" /> Desktop · Tablet · HP</span>
                <span className="font-medium text-slate-700 dark:text-slate-300">Coba ubah nilai & lihat hasil</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== ROLES ==================== */}
      <section id="untuk-siapa" className="mx-auto max-w-[1280px] px-4 md:px-6 pt-16">
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-[26px] md:text-[32px] font-black tracking-tight text-slate-900 dark:text-white">Untuk siswa & guru</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Satu platform, dua pengalaman yang dirancang khusus.</p>
        </div>
        <div className="mt-8 grid md:grid-cols-2 gap-5">
          <div className="rounded-[20px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white grid place-items-center">
              <GraduationCap className="w-5 h-5" />
            </div>
            <h3 className="mt-4 font-bold text-slate-900 dark:text-white">Untuk Siswa</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">
              Belajar dengan tutor AI yang sabar, dapatkan umpan balik instan, lacak progres, dan lanjutkan kapan saja. Masuk dengan NISN.
            </p>
            <ul className="mt-4 space-y-2 text-xs">
              {['Kuis dengan penilaian AI', 'Aktivitas harian & laporan', 'Belajar offline via ekspor'].map((li) => (
                <li key={li} className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> {li}
                </li>
              ))}
            </ul>
            <Button onClick={() => router.push('/login-siswa')} className="mt-5 w-full rounded-full">
              Masuk sebagai Siswa <ArrowRight className="w-4 h-4" />
            </Button>
            <button onClick={() => router.push('/dashboard')} className="mt-2 w-full text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline">
              Lihat demo dashboard siswa →
            </button>
          </div>

          <div className="rounded-[20px] bg-slate-900 border border-slate-800 p-6 text-white relative overflow-hidden">
            <div className="absolute -top-20 -right-20 w-64 h-64 bg-indigo-600/20 rounded-full blur-2xl" />
            <div className="relative">
              <div className="w-10 h-10 rounded-xl bg-white text-slate-900 grid place-items-center">
                <Users className="w-5 h-5" />
              </div>
              <h3 className="mt-4 font-bold">Untuk Guru</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-300">
                Buat materi ajar berkualitas dalam menit, pantau kelas, nilai otomatis, dan kelola kurikulum di Studio (dalam app).
              </p>
              <ul className="mt-4 space-y-2 text-xs">
                {['Buat scene AI & kelola kelas', 'Nilai 23+ submission sekaligus', 'Rapor & analitik kelas'].map((li) => (
                  <li key={li} className="flex items-center gap-2 text-slate-200">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> {li}
                  </li>
                ))}
              </ul>
              <Button onClick={() => router.push('/dashboard')} className="mt-5 w-full rounded-full bg-white text-slate-900 hover:bg-slate-100">
                Masuk sebagai Guru <ArrowRight className="w-4 h-4" />
              </Button>
              <button onClick={() => router.push('/login')} className="mt-2 w-full text-xs font-medium text-indigo-300 hover:underline">
                Login admin / staf →
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Recent classrooms moved to /studio — landing has no composer history */}

      {/* ==================== CTA — honest ==================== */}
      <section id="cta" className="mx-auto max-w-[1280px] px-4 md:px-6 pt-16 pb-8">
        <div className="rounded-[24px] bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 p-[1px]">
          <div className="rounded-[23px] bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 p-6 md:p-10 text-white relative overflow-hidden">
            <div className="absolute -top-20 -right-20 w-80 h-80 bg-white/10 rounded-full blur-2xl" />
            <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-blue-300/20 rounded-full blur-2xl" />
            <div className="relative grid lg:grid-cols-2 gap-8 items-center">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 border border-white/20 text-xs font-semibold">
                  <Rocket className="w-3.5 h-3.5" /> SIAP MEMULAI?
                </div>
                <h2 className="mt-4 text-[22px] md:text-[28px] font-black leading-tight">
                  Satu prompt, satu kelas utuh. Review, publish, assign.
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-white/80">
                  Studio ada di dalam aplikasi setelah login guru. Outline bisa diedit sebelum full generate. Siswa hanya melihat materi yang sudah Anda publish dan assign.
                </p>
                <div className="mt-4 flex items-center gap-2 text-xs text-white/70">
                  <CheckCircle2 className="w-4 h-4 text-emerald-300" /> Tanpa rating fiktif • Metrik jujur dari data nyata
                </div>
              </div>
              <div className="bg-white rounded-2xl p-6 text-slate-900">
                <h3 className="text-lg font-black tracking-tight">Siap mengubah cara mengajar?</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                  Buat kelas pertamamu dalam 2 menit setelah masuk. Ekspor PPTX/HTML/ZIP untuk intranet. Tidak ada MP4 di Vercel produksi.
                </p>
                <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                    <div className="font-black text-slate-900">Draft</div>
                    <div className="text-slate-500">Review wajib</div>
                  </div>
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                    <div className="font-black text-slate-900">Publish</div>
                    <div className="text-slate-500">+ Assign</div>
                  </div>
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                    <div className="font-black text-slate-900">Offline</div>
                    <div className="text-slate-500">PPTX/HTML/ZIP</div>
                  </div>
                </div>
                <div className="mt-5 flex gap-2">
                  <Button onClick={() => router.push('/masuk')} className="flex-1 rounded-full bg-slate-900 hover:bg-slate-800 text-white">
                    <Rocket className="w-4 h-4" /> Masuk
                  </Button>
                  <Button variant="outline" onClick={() => router.push('/masuk')} className="rounded-full">
                    Lihat Studio
                  </Button>
                </div>
                <p className="mt-3 text-center text-[11px] text-slate-500">Masuk sebagai guru untuk membuat kelas. Siswa login dengan NISN.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== FOOTER ==================== */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-950/40 backdrop-blur">
        <div className="mx-auto max-w-[1280px] px-4 md:px-6 py-8">
          <div className="grid md:grid-cols-4 gap-8">
            <div className="md:col-span-2">
              <BrandLogo size="sm" />
              <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400 max-w-md">
                Kelas KA — Platform pembelajaran generatif multi-agen. Ubah topik apa pun menjadi pengalaman kelas interaktif yang imersif.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">MIT License</span>
                <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">THU-MAIC Open Source</span>
                <span className="px-2.5 py-1 rounded-full bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800">v1.0.0</span>
              </div>
            </div>
            <div>
              <h4 className="text-xs font-bold tracking-widest text-slate-900 dark:text-white uppercase">Produk</h4>
              <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-400">
                <li><button onClick={() => router.push('/masuk')} className="hover:text-slate-900 dark:hover:text-white">Buat Kelas (Studio)</button></li>
                <li><button onClick={() => router.push('/masuk')} className="hover:text-slate-900 dark:hover:text-white">Dashboard</button></li>
                <li><button onClick={() => router.push('/materi')} className="hover:text-slate-900 dark:hover:text-white">Materi Saya</button></li>
                <li><button onClick={() => router.push('/masuk')} className="hover:text-slate-900 dark:hover:text-white">Masuk</button></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-bold tracking-widest text-slate-900 dark:text-white uppercase">Bantuan</h4>
              <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-400">
                <li><button onClick={() => setSettingsOpen(true)} className="hover:text-slate-900 dark:hover:text-white">Pengaturan Model</button></li>
                <li><button onClick={() => router.push('/login-siswa')} className="hover:text-slate-900 dark:hover:text-white">Login Siswa (NISN)</button></li>
                <li><button onClick={() => router.push('/login')} className="hover:text-slate-900 dark:hover:text-white">Login Admin</button></li>
                <li><a href="https://github.com/THU-MAIC/OpenMAIC" target="_blank" rel="noreferrer" className="hover:text-slate-900 dark:hover:text-white">Dokumentasi →</a></li>
              </ul>
            </div>
          </div>
          <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-800 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-slate-500">
            <span>© {new Date().getFullYear()} Kelas KA — Dibuat dengan ♥ untuk pendidikan Indonesia.</span>
            <span className="inline-flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Semua sistem berjalan normal
            </span>
          </div>
        </div>
      </footer>

      <NewFolderDialog
        open={newFolderOpen}
        onOpenChange={(open) => {
          setNewFolderOpen(open);
          if (!open) setCreateAndMoveTarget(null);
        }}
        folders={folders}
        onCreate={handleCreateFolder}
      />
    </div>
  );
}

function LayoutDashboardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </svg>
  );
}

// ─── Greeting Bar ───
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

function isCustomAvatar(src: string) {
  return src.startsWith('data:');
}

function GreetingBar() {
  const { t } = useI18n();
  const avatar = useUserProfileStore((s) => s.avatar);
  const nickname = useUserProfileStore((s) => s.nickname);
  const bio = useUserProfileStore((s) => s.bio);
  const setAvatar = useUserProfileStore((s) => s.setAvatar);
  const setNickname = useUserProfileStore((s) => s.setNickname);
  const setBio = useUserProfileStore((s) => s.setBio);

  const [open, setOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayName = nickname || t('profile.defaultNickname');

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingName(false);
        setAvatarPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const startEditName = () => {
    setNameDraft(nickname);
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  const commitName = () => {
    setNickname(nameDraft.trim());
    setEditingName(false);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_AVATAR_SIZE) {
      toast.error(t('profile.fileTooLarge'));
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error(t('profile.invalidFileType'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        const scale = Math.max(128 / img.width, 128 / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (128 - w) / 2, (128 - h) / 2, w, h);
        setAvatar(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div ref={containerRef} className="relative pl-4 pr-2 pt-3.5 pb-1 w-auto">
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAvatarUpload}
      />
      {!open && (
        <div
          className="flex items-center gap-2.5 cursor-pointer transition-all duration-200 group rounded-full px-2.5 py-1.5 border border-border/50 text-muted-foreground/70 hover:text-foreground hover:bg-muted/60 active:scale-[0.97]"
          onClick={() => setOpen(true)}
        >
          <div className="shrink-0 relative">
            <div className="size-8 rounded-full overflow-hidden ring-[1.5px] ring-border/30 group-hover:ring-violet-400/60 dark:group-hover:ring-violet-400/40 transition-all duration-300">
              <img src={avatar} alt="" className="size-full object-cover" />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-white dark:bg-slate-800 border border-border/40 flex items-center justify-center opacity-60 group-hover:opacity-100 transition-opacity">
              <Pencil className="size-[7px] text-muted-foreground/70" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="leading-none select-none flex items-center gap-1">
                  <span className="text-[13px] font-semibold text-foreground/85 group-hover:text-foreground transition-colors">
                    {t('home.greetingWithName', { name: displayName })}
                  </span>
                  <ChevronDown className="size-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4}>
                {t('profile.editTooltip')}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="absolute left-4 top-3.5 z-50 w-64"
          >
            <div className="rounded-2xl bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06] shadow-[0_1px_8px_-2px_rgba(0,0,0,0.06)] dark:shadow-[0_1px_8px_-2px_rgba(0,0,0,0.3)] px-2.5 py-2">
              <div
                className="flex items-center gap-2.5 cursor-pointer transition-all duration-200"
                onClick={() => {
                  setOpen(false);
                  setEditingName(false);
                  setAvatarPickerOpen(false);
                }}
              >
                <div
                  className="shrink-0 relative cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAvatarPickerOpen(!avatarPickerOpen);
                  }}
                >
                  <div className="size-8 rounded-full overflow-hidden ring-[1.5px] ring-violet-300/70 dark:ring-violet-500/40 transition-all duration-300">
                    <img src={avatar} alt="" className="size-full object-cover" />
                  </div>
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-white dark:bg-slate-800 border border-border/60 flex items-center justify-center"
                  >
                    <ChevronDown
                      className={cn(
                        'size-2 text-muted-foreground/70 transition-transform duration-200',
                        avatarPickerOpen && 'rotate-180',
                      )}
                    />
                  </motion.div>
                </div>
                <div className="flex-1 min-w-0">
                  {editingName ? (
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        ref={nameInputRef}
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitName();
                          if (e.key === 'Escape') {
                            setEditingName(false);
                          }
                        }}
                        onBlur={commitName}
                        maxLength={20}
                        placeholder={t('profile.defaultNickname')}
                        className="flex-1 min-w-0 h-6 bg-transparent border-b border-border/80 text-[13px] font-semibold text-foreground outline-none placeholder:text-muted-foreground/40"
                      />
                      <button
                        onClick={commitName}
                        className="shrink-0 size-5 rounded flex items-center justify-center text-violet-500 hover:bg-violet-100 dark:hover:bg-violet-900/30"
                      >
                        <Check className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditName();
                      }}
                      className="group/name inline-flex items-center gap-1 cursor-pointer"
                    >
                      <span className="text-[13px] font-semibold text-foreground/85 group-hover/name:text-foreground transition-colors">
                        {displayName}
                      </span>
                      <Pencil className="size-2.5 text-muted-foreground/30 opacity-0 group-hover/name:opacity-100 transition-opacity" />
                    </span>
                  )}
                </div>
                <motion.div
                  initial={{ opacity: 0, y: -2 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="shrink-0 size-6 rounded-full flex items-center justify-center hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
                >
                  <ChevronUp className="size-3.5 text-muted-foreground/50" />
                </motion.div>
              </div>
              <div className="pt-2" onClick={(e) => e.stopPropagation()}>
                <AnimatePresence>
                  {avatarPickerOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="p-1 pb-2.5 flex items-center gap-1.5 flex-wrap">
                        {AVATAR_OPTIONS.map((url) => (
                          <button
                            key={url}
                            onClick={() => setAvatar(url)}
                            className={cn(
                              'size-7 rounded-full overflow-hidden bg-gray-50 dark:bg-gray-800 cursor-pointer transition-all duration-150',
                              'hover:scale-110 active:scale-95',
                              avatar === url
                                ? 'ring-2 ring-violet-400 dark:ring-violet-500 ring-offset-0'
                                : 'hover:ring-1 hover:ring-muted-foreground/30',
                            )}
                          >
                            <img src={url} alt="" className="size-full" />
                          </button>
                        ))}
                        <label
                          className={cn(
                            'size-7 rounded-full flex items-center justify-center cursor-pointer transition-all duration-150 border border-dashed',
                            'hover:scale-110 active:scale-95',
                            isCustomAvatar(avatar)
                              ? 'ring-2 ring-violet-400 dark:ring-violet-500 ring-offset-0 border-violet-300 dark:border-violet-600 bg-violet-50 dark:bg-violet-900/30'
                              : 'border-muted-foreground/30 text-muted-foreground/50 hover:border-muted-foreground/50',
                          )}
                          onClick={() => avatarInputRef.current?.click()}
                          title={t('profile.uploadAvatar')}
                        >
                          <ImagePlus className="size-3" />
                        </label>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <UITextarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder={t('profile.bioPlaceholder')}
                  maxLength={200}
                  rows={2}
                  className="resize-none border-border/40 bg-transparent min-h-[72px] !text-[13px] !leading-relaxed placeholder:!text-[11px] placeholder:!leading-relaxed focus-visible:ring-1 focus-visible:ring-border/60"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ClassroomCard({
  classroom,
  slide,
  formatDate,
  overlay,
  onDelete,
  onRename,
  confirmingDelete,
  onConfirmDelete,
  onCancelDelete,
  onClick,
}: {
  classroom: StageListItem;
  slide?: Slide;
  formatDate: (ts: number) => string;
  overlay?: React.ReactNode;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onRename: (id: string, newName: string) => void;
  confirmingDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const thumbRef = useRef<HTMLDivElement>(null);
  const [thumbWidth, setThumbWidth] = useState(0);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = thumbRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setThumbWidth(Math.round(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (editing) nameInputRef.current?.focus();
  }, [editing]);

  const isTaskEngineMode = classroom.taskEngineMode === true;
  const showModeBadge = classroom.interactiveMode || isTaskEngineMode;
  const ModeBadgeIcon = isTaskEngineMode ? Sparkles : Atom;
  const modeBadgeLabel = isTaskEngineMode ? 'Vocational Mode' : t('toolbar.interactiveModeLabel');

  const startRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNameDraft(classroom.name);
    setEditing(true);
  };

  const commitRename = () => {
    if (!editing) return;
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== classroom.name) {
      onRename(classroom.id, trimmed);
    }
    setEditing(false);
  };

  return (
    <div
      className="group cursor-pointer"
      onClick={confirmingDelete ? undefined : onClick}
      draggable={!confirmingDelete && !editing}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/stage-id', classroom.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => {
        window.dispatchEvent(new CustomEvent('course-drag-end'));
      }}
    >
      <div
        ref={thumbRef}
        className="relative w-full aspect-[16/9] rounded-2xl bg-slate-100 dark:bg-slate-800/80 overflow-hidden transition-transform duration-200 group-hover:scale-[1.02] border border-slate-200/60 dark:border-slate-700/60"
      >
        {slide && thumbWidth > 0 ? (
          <SlideThumbnail
            slide={slide}
            size={thumbWidth}
            viewportSize={slide.viewportSize ?? 1000}
            viewportRatio={slide.viewportRatio ?? 0.5625}
          />
        ) : !slide ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="size-12 rounded-2xl bg-gradient-to-br from-violet-100 to-blue-100 dark:from-violet-900/30 dark:to-blue-900/30 flex items-center justify-center">
              <span className="text-xl opacity-50">📄</span>
            </div>
          </div>
        ) : null}
        {showModeBadge && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                aria-label={modeBadgeLabel}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  'absolute bottom-2 left-2 inline-flex items-center justify-center size-5 rounded-full bg-white/80 dark:bg-slate-900/60 backdrop-blur-sm shadow-sm z-10',
                  isTaskEngineMode
                    ? 'text-amber-600 dark:text-amber-300 ring-1 ring-amber-500/35'
                    : 'text-cyan-600 dark:text-cyan-300 ring-1 ring-cyan-500/30',
                )}
              >
                <ModeBadgeIcon className="size-3" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" align="start" sideOffset={-4} collisionPadding={0} className="text-xs">
              {modeBadgeLabel}
            </TooltipContent>
          </Tooltip>
        )}
        <AnimatePresence>
          {!confirmingDelete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 right-2 size-7 opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 hover:bg-destructive/80 text-white hover:text-white backdrop-blur-sm rounded-full"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(classroom.id, e);
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 right-11 size-7 opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 hover:bg-black/50 text-white hover:text-white backdrop-blur-sm rounded-full"
                onClick={startRename}
              >
                <Pencil className="size-3.5" />
              </Button>
              {overlay}
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {confirmingDelete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/50 backdrop-blur-[6px]"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-[13px] font-medium text-white/90">
                {t('classroom.deleteConfirmTitle')}?
              </span>
              <div className="flex gap-2">
                <button
                  className="px-3.5 py-1 rounded-lg text-[12px] font-medium bg-white/15 text-white/80 hover:bg-white/25 backdrop-blur-sm transition-colors"
                  onClick={onCancelDelete}
                >
                  {t('common.cancel')}
                </button>
                <button
                  className="px-3.5 py-1 rounded-lg text-[12px] font-medium bg-red-500/90 text-white hover:bg-red-500 transition-colors"
                  onClick={onConfirmDelete}
                >
                  {t('classroom.delete')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="mt-2.5 px-1 flex items-center gap-2">
        <span className="shrink-0 inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-900/30 px-2 py-0.5 text-[11px] font-medium text-violet-600 dark:text-violet-400">
          {classroom.sceneCount} {t('classroom.slides')} · {formatDate(classroom.updatedAt)}
        </span>
        {editing ? (
          <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
            <input
              ref={nameInputRef}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setEditing(false);
              }}
              onBlur={commitRename}
              maxLength={100}
              placeholder={t('classroom.renamePlaceholder')}
              className="w-full bg-transparent border-b border-violet-400/60 text-[15px] font-medium text-foreground/90 outline-none placeholder:text-muted-foreground/40"
            />
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <p
                className="font-medium text-[15px] truncate text-foreground/90 min-w-0 cursor-text"
                onDoubleClick={startRename}
              >
                {classroom.name}
              </p>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4} className="!max-w-[min(90vw,32rem)] break-words whitespace-normal">
              <div className="flex items-center gap-1.5">
                <span className="break-all">{classroom.name}</span>
                <button
                  className="shrink-0 p-0.5 rounded hover:bg-foreground/10 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(classroom.name);
                    toast.success(t('classroom.nameCopied'));
                  }}
                >
                  <Copy className="size-3 opacity-60" />
                </button>
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return <HomePage />;
}
