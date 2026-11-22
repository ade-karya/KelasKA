'use client';

import { useCallback, useEffect, useState } from 'react';

import { fetchSettings, type SettingsView } from '../../lib/settings';

export default function SettingsPage() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setView(await fetchSettings());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pengaturan gagal dimuat.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main>
      <h1>Konfigurasi Model</h1>
      <p className="muted">
        <a href="/">← Konsol sesi</a> · <a href="/onboarding/api-key">Atur kunci API</a>
      </p>
      {error && <p className="state-offline">{error}</p>}
      {!view && !error && <p className="muted">Memuat…</p>}
      {view && (
        <>
          <section className="panel">
            <h2>Provider ({view.providers.length})</h2>
            {view.providers.length === 0 && <p className="muted">Belum ada provider.</p>}
            {view.providers.map((provider) => (
              <p key={provider.id}>
                <strong>{provider.presetName ?? provider.preset}</strong> · {provider.id}
                {provider.source ? ` · ${provider.source}` : ''}
                {provider.key?.set
                  ? ` · kunci ${provider.key.mask ?? 'tersimpan'}`
                  : ' · tanpa kunci'}
              </p>
            ))}
          </section>
          <section className="panel">
            <h2>Slot ({view.slots.length})</h2>
            {view.slots.map((slot) => (
              <p key={slot.slot}>
                <code>{slot.slot}</code> · {slot.source?.kind ?? '—'}
                {slot.locked ? ' · terkunci' : ''}
              </p>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
