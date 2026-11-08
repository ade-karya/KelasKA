'use client';

/**
 * Agent login dialog, opened from the model picker's footer action.
 *
 * The entry used to be a key button in the chat header, which put a credential
 * action next to the session title and nowhere near the provider list it
 * unlocks. It now lives inside the model picker, on both the home composer and
 * the chat pane, so the login sits beside the Antigravity/Codex models it
 * enables.
 *
 * The dialog is a thin shell: three provider tabs (OpenCode Console /
 * Antigravity / Codex) and a quiet connection check so the opener can show a
 * green dot when at least one provider is ready. All credential handling lives
 * in the panels and on the server — nothing secret reaches this component.
 */

import { useEffect, useState } from 'react';
import { KeyRound, Sparkles, SquareTerminal, Terminal } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useI18n } from '@/lib/hooks/use-i18n';
import { AntigravityAuthPanel } from './AntigravityAuthPanel';
import { CodexAuthPanel } from './CodexAuthPanel';
import { OpenCodeAuthPanel } from './OpenCodeAuthPanel';

type ProviderTab = 'opencode' | 'antigravity' | 'codex';

interface AuthSnapshot {
  codex?: { loggedIn?: boolean };
  antigravity?: { authenticated?: boolean };
  opencode?: { authenticated?: boolean };
}

export function WorkbenchAuthDialog({
  open,
  onOpenChange,
  onStatusChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Reports whether at least one provider is signed in, for the opener dot. */
  onStatusChange?: (connected: boolean) => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<ProviderTab>('opencode');
  const [opencodeConnected, setOpencodeConnected] = useState(false);
  const [antigravityConnected, setAntigravityConnected] = useState(false);
  const [codexConnected, setCodexConnected] = useState(false);

  // Seed both tab dots when the dialog opens. The panels report their own
  // status afterwards, but an inactive tab is not mounted yet, so without this
  // its dot would stay grey until the user visited it.
  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      try {
        const res = await fetch('/api/agent/auth', { credentials: 'include' });
        if (!res.ok) return;
        const body = (await res.json().catch(() => ({}))) as AuthSnapshot;
        if (!active) return;
        setAntigravityConnected(Boolean(body.antigravity?.authenticated));
        setCodexConnected(Boolean(body.codex?.loggedIn));
        setOpencodeConnected(Boolean(body.opencode?.authenticated));
      } catch {
        // The panels report real errors once the user asks for an action.
      }
    })();
    return () => {
      active = false;
    };
  }, [open]);

  const connected = antigravityConnected || codexConnected || opencodeConnected;

  useEffect(() => {
    onStatusChange?.(connected);
  }, [connected, onStatusChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="gap-3">
          <div className="flex items-start gap-3 pr-6">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
              aria-hidden
            >
              <KeyRound className="size-5" />
            </span>
            <div className="min-w-0 space-y-1">
              <DialogTitle className="text-base">{t('workspace.auth.connectTitle')}</DialogTitle>
              <DialogDescription className="text-xs leading-relaxed sm:text-sm">
                {t('workspace.auth.connectDescription')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as ProviderTab)}>
          <TabsList className="h-10 w-full p-1">
            <TabsTrigger value="opencode" className="gap-2">
              <SquareTerminal className="size-4" aria-hidden />
              OpenCode
              {opencodeConnected ? (
                <span className="size-1.5 rounded-full bg-green-500" aria-hidden />
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="antigravity" className="gap-2">
              <Sparkles className="size-4" aria-hidden />
              Antigravity
              {antigravityConnected ? (
                <span className="size-1.5 rounded-full bg-green-500" aria-hidden />
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="codex" className="gap-2">
              <Terminal className="size-4" aria-hidden />
              Codex
              {codexConnected ? (
                <span className="size-1.5 rounded-full bg-green-500" aria-hidden />
              ) : null}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="opencode" className="mt-4">
            <OpenCodeAuthPanel onConnectionChange={setOpencodeConnected} />
          </TabsContent>

          <TabsContent value="antigravity" className="mt-4">
            <AntigravityAuthPanel onConnectionChange={setAntigravityConnected} />
          </TabsContent>

          <TabsContent value="codex" className="mt-4">
            <CodexAuthPanel onConnectionChange={setCodexConnected} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
