import '../global.css';
import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { RootShell } from '@/components/root-shell';
import { i18n } from '@/lib/i18n';

// Root layout for the default locale (id), served at unprefixed URLs.
export const metadata: Metadata = {
  title: {
    default: 'Dokumentasi — Kelas Kecerdasan Artifisial',
    template: '%s — Kelas Kecerdasan Artifisial',
  },
  description:
    'Dokumentasi Kelas Kecerdasan Artifisial: instalasi, konfigurasi, model yang didukung, deployment, dan hosting.',
  icons: { icon: '/logo-kemendikdasmen.png' },
};

export const viewport: Viewport = { themeColor: '#1d4ed8' };

export default function Layout({ children }: { children: ReactNode }) {
  return <RootShell lang={i18n.defaultLanguage}>{children}</RootShell>;
}
