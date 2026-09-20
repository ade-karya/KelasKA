'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Minimal username+password page.
 *
 * Follow-up (deliberately out of scope): global 401 -> /login redirect and an
 * authenticated guard wrapper. Pages are currently let through by middleware;
 * only API routes enforce the session, so an unauthenticated visitor can still
 * render app pages until their first API 401.
 */
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/status', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body?.authenticated) router.replace('/');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        // Server message is a fixed string; still type-check, bound its length,
        // and render via React text (auto-escaped) so it can never become HTML.
        const serverError =
          typeof body?.error === 'string' && body.error ? body.error.slice(0, 200) : '';
        setError(
          serverError ||
            (mode === 'login' ? 'Invalid username or password' : 'Registration failed'),
        );
        return;
      }
      router.replace('/');
      router.refresh();
    } catch {
      setError('Network error, please try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border/50 bg-card/80 p-8 shadow-xl backdrop-blur-xl">
        <h1 className="mb-1 text-center text-lg font-semibold tracking-tight">
          {mode === 'login' ? 'Masuk ke OpenMAIC' : 'Daftar akun OpenMAIC'}
        </h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">
          Username 3-32 karakter alfanumerik · password minimal 8 karakter
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            maxLength={64}
            className="w-full rounded-xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
            disabled={loading}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            maxLength={128}
            className="w-full rounded-xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
            disabled={loading}
          />
          {error && <p className="text-center text-sm text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Memproses…' : mode === 'login' ? 'Masuk' : 'Daftar'}
          </button>
        </form>
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
          }}
          className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
        >
          {mode === 'login' ? 'Belum punya akun? Daftar' : 'Sudah punya akun? Masuk'}
        </button>
      </div>
    </div>
  );
}
