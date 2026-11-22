'use client';

import { useEffect, useState } from 'react';

import { fetchRun, startRun, type RunSnapshot } from '../../lib/generation';

export default function GenerationPreviewPage() {
  const [requirement, setRequirement] = useState('');
  const [materials, setMaterials] = useState('');
  const [run, setRun] = useState<RunSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // A run keeps going without this page; support ?run=<id> deep links too.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('run');
    if (!id) return;
    void fetchRun(id)
      .then(setRun)
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Run gagal dimuat.'));
  }, []);

  useEffect(() => {
    if (!run || run.stageId) return;
    const timer = window.setInterval(() => {
      void fetchRun(run.id)
        .then((next) => setRun(next))
        .catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [run?.id, run?.stageId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!requirement.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const ids = materials
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter(Boolean);
      setRun(
        await startRun({
          requirement: requirement.trim(),
          ...(ids.length ? { materialIds: ids } : {}),
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Run gagal dimulai.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <h1>Buat Kelas dari Materi</h1>
      <p className="muted">
        <a href="/classes">← Kursus Saya</a>
      </p>

      <section className="panel">
        <form onSubmit={(event) => void submit(event)}>
          <label>
            Topik / kebutuhan kelas
            <textarea
              value={requirement}
              onChange={(event) => setRequirement(event.target.value)}
              rows={4}
              required
            />
          </label>
          <label>
            Id materi (opsional, dipisah koma)
            <input value={materials} onChange={(event) => setMaterials(event.target.value)} />
          </label>
          <button type="submit" disabled={busy || !requirement.trim()}>
            {busy ? 'Memulai…' : 'Mulai buat kelas'}
          </button>
        </form>
        {error && <p className="state-offline">{error}</p>}
      </section>

      {run && (
        <section className="panel">
          <h2>Run {run.id}</h2>
          <p>
            Keadaan: <strong>{run.state}</strong> · langkah: {run.step ?? '—'} · versi {run.seq}
          </p>
          {run.error?.message && <p className="state-offline">{run.error.message}</p>}
          {run.stageId ? (
            <p>
              <a href={`/classroom?id=${encodeURIComponent(run.stageId)}`}>Buka kelas →</a>
            </p>
          ) : (
            <p className="muted">Menunggu kelas pertama selesai dibuat…</p>
          )}
        </section>
      )}
    </main>
  );
}
