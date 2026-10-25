'use client';

/**
 * Small presentation pieces shared by the agent login panels.
 *
 * The panels talk to server-owned credentials, so the UI has one job: make the
 * next step obvious. These primitives keep that consistent across Antigravity
 * and Codex — a status card on top, selectable method cards, numbered steps for
 * the browser hand-off, and a copy button for URLs/codes.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  PlugZap,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Copy text to the clipboard, with a visible check mark for a moment. */
export function CopyButton({
  value,
  label = 'Salin',
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Tidak bisa menyalin otomatis. Silakan salin manual.');
    }
  }, [value]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={() => void copy()}
      aria-label={label}
      title={label}
      className={className}
    >
      {copied ? <Check className="text-green-600" /> : <Copy />}
    </Button>
  );
}

/** Top-of-panel connection summary. One glance answers "is this ready?". */
export function AuthStatusCard({
  connected,
  title,
  description,
  meta,
  loading,
  checking,
  pending,
  onRefresh,
  children,
}: {
  connected: boolean;
  title: string;
  description: string;
  meta?: ReactNode;
  loading?: boolean;
  checking?: boolean;
  pending?: boolean;
  onRefresh?: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-3 transition-colors',
        connected
          ? 'border-green-600/25 bg-green-500/[0.06]'
          : pending
            ? 'border-primary/30 bg-primary/[0.04]'
            : 'border-border bg-muted/40',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
            connected
              ? 'bg-green-500/15 text-green-600'
              : pending
                ? 'bg-primary/10 text-primary'
                : 'bg-amber-500/15 text-amber-600',
          )}
          aria-hidden
        >
          {connected ? (
            <CheckCircle2 className="size-4" />
          ) : checking || pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <PlugZap className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{title}</span>
            <Badge
              variant={connected ? 'secondary' : 'outline'}
              className={cn(
                'font-normal',
                connected && 'bg-green-500/10 text-green-700 dark:text-green-400',
                pending && 'border-primary/30 text-primary',
              )}
            >
              {connected
                ? 'Terhubung'
                : pending
                  ? 'Menunggu login'
                  : checking
                    ? 'Memeriksa…'
                    : 'Belum terhubung'}
            </Badge>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground" aria-live="polite">
            {description}
          </p>
          {meta}
        </div>
        {onRefresh ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Periksa ulang status"
            title="Periksa ulang status"
            className="-mr-1 -mt-1 shrink-0"
          >
            <RefreshCw className={cn(loading && 'animate-spin')} />
          </Button>
        ) : null}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

/** A selectable login method, used as a radio card. */
export function AuthMethodCard({
  selected,
  onSelect,
  icon: Icon,
  title,
  description,
  badge,
  disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'group flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
        selected
          ? 'border-primary/40 bg-primary/[0.04] ring-1 ring-primary/20'
          : 'border-border hover:bg-muted/50',
      )}
    >
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg border',
          selected ? 'bg-background text-foreground' : 'bg-muted text-muted-foreground',
        )}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          {badge ? (
            <Badge variant="secondary" className="font-normal">
              {badge}
            </Badge>
          ) : null}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
          {description}
        </span>
      </span>
      <span
        className={cn(
          'mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-primary bg-primary' : 'border-muted-foreground/40',
        )}
        aria-hidden
      >
        {selected ? <Check className="size-3 text-primary-foreground" /> : null}
      </span>
    </button>
  );
}

/** One numbered step in a browser hand-off flow. Render inside an `<ol>`. */
export function AuthStep({
  step,
  title,
  children,
  last,
}: {
  step: number;
  title: string;
  children?: ReactNode;
  last?: boolean;
}) {
  return (
    <li className="relative flex gap-3 pb-3 last:pb-0">
      {last ? null : <span aria-hidden className="absolute left-3 top-8 bottom-0 w-px bg-border" />}
      <span className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border bg-background text-xs font-medium">
        {step}
      </span>
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        <p className="text-sm font-medium leading-5">{title}</p>
        {children}
      </div>
    </li>
  );
}

/** Inline success/error message that does not vanish like a toast. */
export function AuthNotice({
  tone,
  title,
  children,
}: {
  tone: 'error' | 'success';
  title?: string;
  children?: ReactNode;
}) {
  const error = tone === 'error';
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={cn(
        'flex gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed',
        error
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : 'border-green-600/30 bg-green-500/5 text-green-700 dark:text-green-400',
      )}
    >
      {error ? (
        <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      ) : (
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      )}
      <div className="min-w-0 space-y-0.5">
        {title ? <p className="font-medium">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}

/** Password-style input with a show/hide toggle, for API keys. */
export function SecretInput({ className, ...props }: Omit<ComponentProps<typeof Input>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? 'text' : 'password'} className={cn('pr-10', className)} />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-1/2 right-1 -translate-y-1/2"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? 'Sembunyikan kunci' : 'Tampilkan kunci'}
        title={visible ? 'Sembunyikan kunci' : 'Tampilkan kunci'}
      >
        {visible ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  );
}
