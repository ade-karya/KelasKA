'use client';

import { useEffect, useState } from 'react';

import { fetchAccount } from '../../lib/account';
import { createSupabaseBrowser } from '../../lib/auth';
import { safeNext } from '../../lib/api-key';

const ERROR_MESSAGES: Record<string, string> = {
  pending: 'Akun Anda menunggu persetujuan admin.',
  google_failed: 'Masuk Google gagal. Coba lagi.',
};

export default function LoginPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('error');
    if (code) setError(ERROR_MESSAGES[code] ?? 'Masuk gagal.');
    const supabase = createSupabaseBrowser();
    if (!supabase) {
      setError('Supabase belum dikonfigurasi di build ini.');
      setReady(true);
      return;
    }
    void supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user.email ?? null);
      setReady(true);
    });
    if (!params.get('error')) {
      void fetchAccount()
        .then((view) => {
          if (view.user) setEmail(view.user.email);
        })
        .catch(() => undefined);
    }
  }, []);

  const login = async () => {
    const supabase = createSupabaseBrowser();
    if (!supabase) return;
    const next = safeNext(new URLSearchParams(window.location.search).get('next'));
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}${next}` },
    });
  };

  return (
    <main>
      <h1>Masuk ke Kelas KA</h1>
      <p className="muted">Masuk memakai akun Google yang sudah disetujui admin.</p>
      {error && <p className="state-offline">{error}</p>}
      {ready && email && (
        <section className="panel">
          <h2 className="state-online">Sudah masuk sebagai {email}</h2>
          <p>
            <a href="/">Buka konsol sesi →</a> · <a href="/account">Akun</a>
          </p>
        </section>
      )}
      {ready && !email && <button onClick={() => void login()}>Masuk dengan Google</button>}
    </main>
  );
}
