import '../../global.css';
import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { RootShell } from '@/components/root-shell';

// Root layout for non-default locales, served at /<lang> prefixed URLs.
export const metadata: Metadata = {
  title: {
    default: 'Documentation — Kelas Kecerdasan Artifisial',
    template: '%s — Kelas Kecerdasan Artifisial',
  },
  description:
    'Kelas Kecerdasan Artifisial documentation: getting started, configuration, supported models, deployment, and hosting.',
  icons: { icon: '/logo-kemendikdasmen.png' },
};

export const viewport: Viewport = { themeColor: '#1d4ed8' };

export default async function Layout({
  children,
  params,
}: LayoutProps<'/[lang]'>) {
  const { lang } = await params;
  return <RootShell lang={lang}>{children}</RootShell>;
}
