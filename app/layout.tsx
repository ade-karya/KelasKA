import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import '@openmaic/renderer/fonts.css';
import 'animate.css';
import 'katex/dist/katex.min.css';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { I18nProvider } from '@/lib/hooks/use-i18n';
import { Toaster } from '@/components/ui/sonner';
import { ServerProvidersInit } from '@/components/server-providers-init';
import { AccessCodeGuard } from '@/components/access-code-guard';
import { MobileInitializer } from '@/components/mobile-init';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { SessionProvider } from 'next-auth/react';

const inter = localFont({
  src: '../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  variable: '--font-sans',
  weight: '100 900',
});

export const metadata: Metadata = {
  title: 'KelasKA — Platform Belajar AI Interaktif',
  description:
    'KelasKA adalah platform LMS berbasis AI multi-agent. Belajar lebih interaktif dengan guru AI, kuis otomatis, dan sertifikat kelulusan.',
  keywords: 'LMS, belajar online, AI classroom, kursus online, Indonesia',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider>
          <I18nProvider>
            <SessionProvider>
              <ServerProvidersInit />
              <MobileInitializer />
              <AccessCodeGuard>{children}</AccessCodeGuard>
              <MobileBottomNav />
              <Toaster position="top-center" />
            </SessionProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
