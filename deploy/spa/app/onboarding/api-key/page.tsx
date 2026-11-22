'use client';

import { useEffect, useState } from 'react';

import {
  ONBOARDING_PROVIDERS,
  onboardKey,
  safeNext,
  type OnboardingProvider,
} from '../../../lib/api-key';

export default function OnboardingPage() {
  const [step, setStep] = useState<'choose' | 'configure' | 'done'>('choose');
  const [provider, setProvider] = useState<OnboardingProvider | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [next, setNext] = useState('/');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setNext(safeNext(new URLSearchParams(window.location.search).get('next')));
  }, []);

  const pick = (entry: OnboardingProvider) => {
    setProvider(entry);
    setModel(entry.defaultModel);
    setApiKey('');
    setError('');
    setStep('configure');
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!provider || busy) return;
    if (apiKey.trim().length < 8) {
      setError('Kunci API terlalu pendek.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await onboardKey(
        provider,
        apiKey.trim(),
        model.trim() || provider.defaultModel,
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setStep('done');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Onboarding gagal.');
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => undefined);
    window.location.assign('/');
  };

  return (
    <main>
      <h1>Kunci API</h1>
      <p className="muted">
        Akun perlu satu kunci chat yang terverifikasi sebelum kelas dan percakapan dapat dibuat.
      </p>

      {step === 'choose' && (
        <section>
          <h2>Pilih penyedia</h2>
          <div className="course-grid">
            {ONBOARDING_PROVIDERS.map((entry) => (
              <button key={entry.id} type="button" onClick={() => pick(entry)}>
                {entry.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 'configure' && provider && (
        <section className="panel">
          <h2>{provider.name}</h2>
          <p>
            Buat kunci di <a href={provider.signupUrl}>{provider.signupUrl}</a>.
          </p>
          <form onSubmit={(event) => void submit(event)}>
            <label>
              Kunci API
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                required
              />
            </label>
            <label>
              Model
              <input value={model} onChange={(event) => setModel(event.target.value)} required />
            </label>
            <button type="submit" disabled={busy || apiKey.trim().length < 8}>
              {busy ? 'Memverifikasi…' : 'Simpan dan verifikasi'}
            </button>
          </form>
          {error && <p className="state-offline">{error}</p>}
          <button type="button" onClick={() => void signOut()}>
            Keluar
          </button>
        </section>
      )}

      {step === 'done' && (
        <section className="panel">
          <h2 className="state-online">Kunci terverifikasi</h2>
          <p>Kunci disimpan di akun Anda dan tidak dikirim kembali ke browser.</p>
          <a href={next}>Lanjutkan →</a>
        </section>
      )}
    </main>
  );
}
