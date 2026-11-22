'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { createSupabaseBrowser } from '../lib/auth';
import {
  exchangeAppSession,
  fetchEdgeStatus,
  sessionState,
  startFailureMessage,
  startSession,
  type EdgeStatus,
} from '../lib/session';

export default function Page() {
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const [email, setEmail] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [status, setStatus] = useState<EdgeStatus | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState('');

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchEdgeStatus());
    } catch {
      // Keep the last known status while the Worker is briefly unreachable.
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
      setMessage('NEXT_PUBLIC_SUPABASE_URL / ANON_KEY belum diisi di build.');
      return;
    }
    void supabase.auth.getSession().then(({ data }) => {
      setAccessToken(data.session?.access_token ?? null);
      setEmail(data.session?.user.email ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setAccessToken(session?.access_token ?? null);
      setEmail(session?.user.email ?? null);
    });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => {
      window.clearInterval(timer);
      listener.subscription.unsubscribe();
    };
  }, [supabase, refresh]);

  const state = status ? sessionState(status) : 'offline';

  const login = async () => {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/' },
    });
  };

  const start = async () => {
    if (!accessToken) {
      setMessage('Masuk dengan Google terlebih dahulu.');
      return;
    }
    setBusy(true);
    try {
      const result = await startSession(accessToken);
      if (result.ok) {
        setMessage('Sesi sedang disiapkan. Halaman ini akan berubah otomatis.');
        await refresh();
      } else {
        setMessage(startFailureMessage(result.status));
      }
    } catch {
      setMessage('Worker tidak dapat dihubungi.');
    } finally {
      setBusy(false);
    }
  };

  const openApp = async () => {
    if (!accessToken) return;
    setBusy(true);
    try {
      const result = await exchangeAppSession(accessToken);
      setMessage(
        result.ok
          ? 'Sesi aplikasi aktif. Cookie kelaska_session sudah dipasang.'
          : startFailureMessage(result.status),
      );
    } finally {
      setBusy(false);
    }
  };

  const probeApi = async () => {
    try {
      const response = await fetch('/api/stages', { credentials: 'include' });
      setProbe(`GET /api/stages → ${response.status}`);
    } catch {
      setProbe('GET /api/stages → gagal');
    }
  };

  return (
    <main>
      <h1>Kelas KA</h1>
      <p className="muted">Konsol sesi — shell statis di Vercel, backend di sesi Kaggle.</p>

      <section className="panel">
        <h2>Status sesi</h2>
        <p>
          Keadaan: <strong className={`state-${state}`}>{state}</strong>
          {status?.queue ? ` · antrean ${status.queue}` : ''}
        </p>
        <p className="muted">
          Akun: {email ?? 'belum masuk'} · GPU: {status?.gpu?.status ?? '–'} · Colab:{' '}
          {status?.colab?.status ?? '–'}
        </p>
        {message && <p>{message}</p>}
        {!accessToken && (
          <button onClick={() => void login()} disabled={!supabase}>
            Masuk dengan Google
          </button>
        )}
        <p>
          <a href="/login">Halaman masuk</a> · <a href="/account">Akun</a>
        </p>
        {state !== 'online' && (
          <button onClick={() => void start()} disabled={busy || !accessToken}>
            Mulai sesi
          </button>
        )}
        {state === 'online' && (
          <button onClick={() => void openApp()} disabled={busy || !accessToken}>
            Aktifkan sesi aplikasi
          </button>
        )}
      </section>

      <section className="panel">
        <h2>Kelas</h2>
        <p className="muted">Daftar dan buat kelas setelah cookie aplikasi aktif.</p>
        <a href="/classes">Buka Kursus Saya →</a>
        <p>
          <a href="/settings">Konfigurasi Model</a> ·{' '}
          <a href="/onboarding/api-key">Atur kunci API</a>
        </p>
      </section>

      <section className="panel">
        <h2>Verifikasi backend</h2>
        <p className="muted">
          Setelah cookie aplikasi dipasang, tombol ini memastikan <code>/api/*</code> benar-benar
          sampai ke sesi.
        </p>
        <button onClick={() => void probeApi()}>Coba /api/stages</button>
        {probe && <p>{probe}</p>}
      </section>
    </main>
  );
}
