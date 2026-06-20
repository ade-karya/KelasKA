'use client';

import { useState } from 'react';

interface DesktopAPI {
  isDesktop: boolean;
  platform: string;
  getVersion: () => Promise<string | null>;
  checkForUpdates: () => Promise<{ updateAvailable: boolean } | null>;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  installUpdate: () => void;
  onUpdateAvailable: (cb: (info: any) => void) => void;
  onUpdateProgress: (cb: (progress: any) => void) => void;
  onUpdateDownloaded: (cb: (info: any) => void) => void;
}

export function useDesktop(): DesktopAPI {
  const [isDesktop] = useState(() => {
    return typeof window !== 'undefined' && 
      (window as any).electronAPI?.isDesktop === true;
  });

  const api = isDesktop ? (window as any).electronAPI : null;

  return {
    isDesktop,
    platform: api?.platform ?? 'web',
    getVersion: api?.getVersion ?? (() => Promise.resolve(null)),
    checkForUpdates: api?.checkForUpdates ?? (() => Promise.resolve(null)),
    minimize: api?.minimize ?? (() => {}),
    maximize: api?.maximize ?? (() => {}),
    close: api?.close ?? (() => {}),
    installUpdate: api?.installUpdate ?? (() => {}),
    onUpdateAvailable: api?.onUpdateAvailable ?? (() => {}),
    onUpdateProgress: api?.onUpdateProgress ?? (() => {}),
    onUpdateDownloaded: api?.onUpdateDownloaded ?? (() => {}),
  };
}
