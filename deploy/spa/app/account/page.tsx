'use client';

import { useCallback, useEffect, useState } from 'react';

import { fetchAccount, signOutApp, type AccountView } from '../../lib/account';
import { createSupabaseBrowser } from '../../lib/auth';

export default function AccountPage() {
  const [view, setView] = useState<AccountView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await fetchAccount());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Akun gagal dimuat.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const logout = async () => {
    setBusy(true);
    try {
      await signOutApp();
      await createSupabaseBrowser()?.auth.signOut();
      window.location.assign('/');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Keluar gagal.');
      setBusy(false);
    }
  };

  return (
    <main>
      <h1>Akun</h1>
      <p className="muted">
        <a href="/">← Konsol sesi</a>
      </p>
      {error && <p className="state-offline">{error}</p>}
      {!view && !error && <p className="muted">Memuat…</p>}
      {view && (
        <section className="panel">
          <p>
            Status:{' '}
            <strong className={view.user ? 'state-online' : 'state-offline'}>
              {view.user ? 'masuk' : 'belum masuk'}
            </strong>
          </p>
          {view.user ? (
            <>
              <p>Nama: {view.user.name}</p>
              <p>Email: {view.user.email}</p>
              <p>Peran: {view.user.role}</p>
              <button onClick={() => void logout()} disabled={busy}>
                {busy ? 'Keluar…' : 'Keluar'}
              </button>
            </>
          ) : (
            <p>
              <a href="/login">Masuk dengan Google →</a>
            </p>
          )}
        </section>
      )}
    </main>
  );
}
