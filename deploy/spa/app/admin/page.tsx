'use client';

import { useCallback, useEffect, useState } from 'react';

import { createUser, fetchUsers, updateUser, type AdminUser } from '../../lib/admin';

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<AdminUser['role']>('student');

  const load = useCallback(async () => {
    try {
      setUsers(await fetchUsers());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Daftar akun gagal dimuat.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (user: AdminUser, change: Partial<AdminUser>) => {
    setBusy(user.id);
    setError('');
    try {
      const updated = await updateUser(user.id, change);
      setUsers((current) => current.map((item) => (item.id === user.id ? updated : item)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Perubahan gagal.');
    } finally {
      setBusy('');
    }
  };

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !name.trim()) return;
    setBusy('new');
    setError('');
    try {
      const created = await createUser(email.trim(), name.trim(), role);
      setUsers((current) => [...current, created]);
      setEmail('');
      setName('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Akun gagal dibuat.');
    } finally {
      setBusy('');
    }
  };

  return (
    <main>
      <h1>Konsol Admin</h1>
      <p className="muted">
        <a href="/">← Konsol sesi</a>
      </p>
      {error && <p className="state-offline">{error}</p>}

      <section className="panel">
        <h2>Tambah akun</h2>
        <form onSubmit={(event) => void add(event)}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Nama
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            Peran
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as AdminUser['role'])}
            >
              <option value="student">student</option>
              <option value="teacher">teacher</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button type="submit" disabled={busy === 'new'}>
            Buat akun
          </button>
        </form>
      </section>

      <section>
        <h2>Akun ({users.length})</h2>
        {users.map((user) => (
          <article key={user.id} className="panel">
            <h3>
              {user.name} <span className="muted">({user.email})</span>
            </h3>
            <p>
              Status:{' '}
              <strong className={user.active ? 'state-online' : 'state-offline'}>
                {user.active ? 'aktif' : 'menunggu persetujuan'}
              </strong>{' '}
              · kunci: {user.apiKey?.status ?? 'none'}
            </p>
            <p>
              Peran:{' '}
              <select
                value={user.role}
                disabled={busy === user.id}
                onChange={(event) =>
                  void patch(user, { role: event.target.value as AdminUser['role'] })
                }
              >
                <option value="student">student</option>
                <option value="teacher">teacher</option>
                <option value="admin">admin</option>
              </select>
            </p>
            <p>
              {!user.active && (
                <button
                  onClick={() => void patch(user, { active: true })}
                  disabled={busy === user.id}
                >
                  Setujui
                </button>
              )}
              {user.active && (
                <button
                  onClick={() => void patch(user, { active: false })}
                  disabled={busy === user.id}
                >
                  Nonaktifkan
                </button>
              )}
            </p>
          </article>
        ))}
      </section>
    </main>
  );
}
