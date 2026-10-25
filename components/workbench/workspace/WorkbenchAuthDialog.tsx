'use client';

/**
 * Agent login entry point, opened from the key button in the workspace header.
 *
 * The dialog is a thin shell: two provider tabs (Antigravity / Codex) and a
 * quiet connection check so the trigger can show a green dot when at least one
 * provider is ready. All credential handling lives in the panels and on the
 * server — nothing secret reaches this component.
 */

import { useEffect, useState } from 'react';
import { KeyRound, Sparkles, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AntigravityAuthPanel } from './AntigravityAuthPanel';
import { CodexAuthPanel } from './CodexAuthPanel';

type ProviderTab = 'antigravity' | 'codex';

interface AuthSnapshot {
  codex?: { loggedIn?: boolean };
  antigravity?: { authenticated?: boolean };
}

export function WorkbenchAuthDialog() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ProviderTab>('antigravity');
  const [antigravityConnected, setAntigravityConnected] = useState(false);
  const [codexConnected, setCodexConnected] = useState(false);

  // Seed the trigger dot on mount and refresh it after the dialog closes. While
  // the dialog is open the panels already fetch status, so skip the duplicate.
  useEffect(() => {
    if (open) return;
    let active = true;
    void (async () => {
      try {
        const res = await fetch('/api/agent/auth', { credentials: 'include' });
        if (!res.ok) return;
        const body = (await res.json().catch(() => ({}))) as AuthSnapshot;
        if (!active) return;
        setAntigravityConnected(Boolean(body.antigravity?.authenticated));
        setCodexConnected(Boolean(body.codex?.loggedIn));
      } catch {
        // The button is still usable; the panels report real errors once opened.
      }
    })();
    return () => {
      active = false;
    };
  }, [open]);

  const connected = antigravityConnected || codexConnected;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="relative h-8 w-8 shrink-0 p-0"
        onClick={() => setOpen(true)}
        title={connected ? 'Model AI terhubung — kelola login' : 'Hubungkan model AI'}
        aria-label={connected ? 'Model AI terhubung, kelola login' : 'Hubungkan model AI'}
      >
        <KeyRound className="h-4 w-4" />
        {connected ? (
          <span
            className="absolute top-1 right-1 size-1.5 rounded-full bg-green-500 ring-2 ring-background"
            aria-hidden
          />
        ) : null}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
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
                <DialogTitle className="text-base">Hubungkan model AI</DialogTitle>
                <DialogDescription className="text-xs leading-relaxed sm:text-sm">
                  Masuk dengan akun yang sudah kamu punya. Kredensial disimpan di server dan tidak
                  pernah dikirim ke browser.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <Tabs value={tab} onValueChange={(value) => setTab(value as ProviderTab)}>
            <TabsList className="h-10 w-full p-1">
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

            <TabsContent value="antigravity" className="mt-4">
              <AntigravityAuthPanel onConnectionChange={setAntigravityConnected} />
            </TabsContent>

            <TabsContent value="codex" className="mt-4">
              <CodexAuthPanel onConnectionChange={setCodexConnected} />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
