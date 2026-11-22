'use client';

import { useEffect, useState } from 'react';

const WORKSPACE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export default function ProjectWorkspacePage() {
  const [id, setId] = useState('');

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('id') ?? '';
    setId(WORKSPACE_ID.test(value) ? value : '');
  }, []);

  return (
    <main>
      <h1>Workspace Proyek</h1>
      <p className="muted">
        <a href="/workspace">← Ruang Kerja</a>
      </p>
      <section className="panel">
        {id ? (
          <p>
            Proyek <code>{id}</code> tersedia di aplikasi utama saat mode sandbox aktif.
          </p>
        ) : (
          <p>Tautan tidak memiliki id workspace yang valid.</p>
        )}
      </section>
    </main>
  );
}
