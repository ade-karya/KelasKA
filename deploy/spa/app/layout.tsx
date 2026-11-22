import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Kelas KA',
  description: 'Platform pembelajaran interaktif berbasis AI Kelas KA.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/** Static shell: no cookies(), headers() or other request-time APIs. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
