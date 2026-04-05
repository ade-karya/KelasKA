'use client';

import { useState, useMemo, useCallback } from 'react';
import { GraduationCap, ChevronRight, Check, X, ChevronLeft, BookOpen } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  JENJANG_PENDIDIKAN,
  KURIKULUM_SD,
  KURIKULUM_SMP,
  KURIKULUM_SMA,
  type Jenjang,
  type StrukturKurikulumKelas,
} from '@/lib/data/kurikulum-merdeka';
import {
  hasCapaianPembelajaran,
  getFaseFromKelas,
} from '@/lib/data/capaian-pembelajaran';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CurriculumSelection {
  jenjang: Jenjang | null;
  kelas: string | null;
  mataPelajaran: string | null;
}

export interface CurriculumPickerProps {
  value: CurriculumSelection;
  onChange: (value: CurriculumSelection) => void;
}

type Step = 'jenjang' | 'kelas' | 'mapel';

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

const JENJANG_OPTIONS: { id: Jenjang; label: string; emoji: string; desc: string }[] = [
  { id: 'SD', label: 'SD / MI', emoji: '🏫', desc: 'Kelas I – VI' },
  { id: 'SMP', label: 'SMP / MTs', emoji: '📚', desc: 'Kelas VII – IX' },
  { id: 'SMA', label: 'SMA / MA', emoji: '🎓', desc: 'Kelas X – XII' },
];

function getKurikulumByJenjang(jenjang: Jenjang): StrukturKurikulumKelas[] {
  switch (jenjang) {
    case 'SD':
      return KURIKULUM_SD;
    case 'SMP':
      return KURIKULUM_SMP;
    case 'SMA':
      return KURIKULUM_SMA;
    default:
      return [];
  }
}

function getMataPelajaranForKelas(
  jenjang: Jenjang,
  kelas: string,
): string[] {
  const struktur = getKurikulumByJenjang(jenjang);
  const found = struktur.find((s) => s.kelas === kelas);
  if (!found) return [];
  const wajib = found.mataPelajaranWajib
    .filter((m) => m.nama !== 'Muatan Lokal')
    .map((m) => m.nama);
  const pilihan = found.mataPelajaranPilihan ?? [];
  return [...wajib, ...pilihan];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const pillCls =
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all cursor-pointer select-none whitespace-nowrap border';
const pillMuted = `${pillCls} border-border/50 text-muted-foreground/70 hover:text-foreground hover:bg-muted/60`;
const pillActive = `${pillCls} border-emerald-200/60 dark:border-emerald-700/50 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300`;

export function CurriculumPicker({ value, onChange }: CurriculumPickerProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('jenjang');

  const handleOpen = useCallback((isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      // Start at the first uncompleted step
      if (!value.jenjang) setStep('jenjang');
      else if (!value.kelas) setStep('kelas');
      else setStep('mapel');
    }
  }, [value]);

  const selectJenjang = (j: Jenjang) => {
    onChange({ jenjang: j, kelas: null, mataPelajaran: null });
    setStep('kelas');
  };

  const selectKelas = (k: string) => {
    onChange({ ...value, kelas: k, mataPelajaran: null });
    setStep('mapel');
  };

  const selectMapel = (m: string) => {
    onChange({ ...value, mataPelajaran: m });
    setOpen(false);
  };

  const clearSelection = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange({ jenjang: null, kelas: null, mataPelajaran: null });
    setStep('jenjang');
  };

  // Current kelas options
  const kelasOptions = useMemo(() => {
    if (!value.jenjang) return [];
    return getKurikulumByJenjang(value.jenjang).map((s) => s.kelas);
  }, [value.jenjang]);

  // Current mapel options
  const mapelOptions = useMemo(() => {
    if (!value.jenjang || !value.kelas) return [];
    return getMataPelajaranForKelas(value.jenjang, value.kelas);
  }, [value.jenjang, value.kelas]);

  // Summary label
  const summaryLabel = useMemo(() => {
    const parts: string[] = [];
    if (value.jenjang) parts.push(value.jenjang);
    if (value.kelas) parts.push(`Kelas ${value.kelas}`);
    if (value.mataPelajaran) {
      // Truncate long names
      const name = value.mataPelajaran.length > 20
        ? value.mataPelajaran.slice(0, 18) + '…'
        : value.mataPelajaran;
      parts.push(name);
    }
    return parts.join(' · ');
  }, [value]);

  const hasSelection = value.jenjang || value.kelas || value.mataPelajaran;

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button className={hasSelection ? pillActive : pillMuted}>
              <GraduationCap className="size-3.5" />
              {hasSelection ? (
                <>
                  <span className="max-w-[180px] truncate">{summaryLabel}</span>
                  <span
                    role="button"
                    className="size-4 rounded-full inline-flex items-center justify-center hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors"
                    onClick={clearSelection}
                  >
                    <X className="size-2.5" />
                  </span>
                </>
              ) : (
                <span>Kurikulum</span>
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Pilih jenjang, kelas, dan mata pelajaran</TooltipContent>
      </Tooltip>

      <PopoverContent align="start" className="w-72 p-0 overflow-hidden">
        {/* ─── Step 1: Jenjang ─── */}
        {step === 'jenjang' && (
          <div className="animate-in fade-in-0 slide-in-from-left-2 duration-200">
            <div className="px-3 py-2.5 border-b bg-gradient-to-r from-emerald-50/80 to-teal-50/80 dark:from-emerald-950/30 dark:to-teal-950/30">
              <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">Pilih Jenjang Pendidikan</p>
              <p className="text-[10px] text-emerald-600/70 dark:text-emerald-400/60 mt-0.5">Permendikdasmen No. 13/2025</p>
            </div>
            <div className="p-1.5">
              {JENJANG_OPTIONS.map((opt) => {
                const isActive = value.jenjang === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => selectJenjang(opt.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all group',
                      isActive
                        ? 'bg-emerald-50 dark:bg-emerald-950/30 ring-1 ring-emerald-200 dark:ring-emerald-800'
                        : 'hover:bg-muted/60',
                    )}
                  >
                    <span className="text-lg shrink-0">{opt.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{opt.label}</p>
                      <p className="text-[10px] text-muted-foreground/70">{opt.desc}</p>
                    </div>
                    <ChevronRight className="size-3.5 text-muted-foreground/40 group-hover:text-foreground/60 transition-colors" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── Step 2: Kelas ─── */}
        {step === 'kelas' && value.jenjang && (
          <div className="animate-in fade-in-0 slide-in-from-right-2 duration-200">
            <button
              onClick={() => setStep('jenjang')}
              className="w-full flex items-center gap-2 px-3 py-2 border-b bg-muted/40 hover:bg-muted/60 transition-colors"
            >
              <ChevronLeft className="size-3.5 text-muted-foreground" />
              <span className="text-lg">
                {JENJANG_OPTIONS.find((o) => o.id === value.jenjang)?.emoji}
              </span>
              <span className="text-xs font-semibold">
                {JENJANG_OPTIONS.find((o) => o.id === value.jenjang)?.label}
              </span>
              <span className="text-[10px] text-muted-foreground ml-auto">Pilih Kelas</span>
            </button>
            <div className="p-1.5 max-h-64 overflow-y-auto">
              {kelasOptions.map((kelas) => {
                const isActive = value.kelas === kelas;
                return (
                  <button
                    key={kelas}
                    onClick={() => selectKelas(kelas)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all group',
                      isActive
                        ? 'bg-emerald-50 dark:bg-emerald-950/30 ring-1 ring-emerald-200 dark:ring-emerald-800'
                        : 'hover:bg-muted/60',
                    )}
                  >
                    <div className="size-7 rounded-md bg-gradient-to-br from-emerald-100 to-teal-100 dark:from-emerald-900/40 dark:to-teal-900/40 flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">{kelas}</span>
                    </div>
                    <span className="text-sm font-medium flex-1">Kelas {kelas}</span>
                    <ChevronRight className="size-3.5 text-muted-foreground/40 group-hover:text-foreground/60 transition-colors" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── Step 3: Mata Pelajaran ─── */}
        {step === 'mapel' && value.jenjang && value.kelas && (
          <div className="animate-in fade-in-0 slide-in-from-right-2 duration-200">
            <button
              onClick={() => setStep('kelas')}
              className="w-full flex items-center gap-2 px-3 py-2 border-b bg-muted/40 hover:bg-muted/60 transition-colors"
            >
              <ChevronLeft className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold">
                {value.jenjang} · Kelas {value.kelas}
              </span>
              <span className="text-[10px] text-muted-foreground ml-auto">Pilih Mapel</span>
            </button>
            <div className="p-1.5 max-h-72 overflow-y-auto">
              {mapelOptions.map((mapel) => {
                const isActive = value.mataPelajaran === mapel;
                const fase = value.kelas ? getFaseFromKelas(value.kelas) : null;
                const hasCP = fase ? hasCapaianPembelajaran(mapel, fase) : false;
                return (
                  <button
                    key={mapel}
                    onClick={() => selectMapel(mapel)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left transition-all',
                      isActive
                        ? 'bg-emerald-50 dark:bg-emerald-950/30 ring-1 ring-emerald-200 dark:ring-emerald-800'
                        : 'hover:bg-muted/60',
                    )}
                  >
                    <span className="flex-1 text-xs font-medium leading-tight">{mapel}</span>
                    {hasCP && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/30 text-[9px] font-semibold text-blue-600 dark:text-blue-400">
                            <BookOpen className="size-2.5" />
                            CP
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-[200px]">
                          Capaian Pembelajaran tersedia untuk Fase {fase}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {isActive && <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
