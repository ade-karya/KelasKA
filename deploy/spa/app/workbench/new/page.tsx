'use client';

import { useEffect, useState } from 'react';

/** Backward-compatible bridge for old /workbench/new?prompt= links. */
export default function WorkbenchNewPage() {
  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    setPrompt(new URLSearchParams(window.location.search).get('prompt') ?? '');
  }, []);

  return (
    <main>
      <h1>Percakapan Baru</h1>
      <p className="muted">
        <a href="/workspace">← Ruang Kerja</a>
      </p>
      <section className="panel">
        {prompt ? (
          <>
            <p>Prompt dari tautan lama:</p>
            <p className="muted">{prompt}</p>
          </>
        ) : (
          <p>Tidak ada prompt pada tautan ini.</p>
        )}
        <p>
          <a href="/workspace">Lanjut di Ruang Kerja →</a>
        </p>
      </section>
    </main>
  );
}
