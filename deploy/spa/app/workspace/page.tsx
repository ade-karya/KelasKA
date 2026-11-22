'use client';

/** Lightweight workspace entry: the full workbench still lives in the app. */
export default function WorkspacePage() {
  return (
    <main>
      <h1>Ruang Kerja</h1>
      <p className="muted">
        <a href="/">← Konsol sesi</a>
      </p>
      <section className="panel">
        <p>Akses cepat ke fitur yang sudah tersedia di shell statis:</p>
        <p>
          <a href="/generation-preview">Buat kelas dari materi</a>
        </p>
        <p>
          <a href="/classes">Kursus Saya</a>
        </p>
        <p>
          <a href="/settings">Konfigurasi Model</a>
        </p>
        <p>
          <a href="/admin">Konsol Admin</a>
        </p>
        <p className="muted">Percakapan workspace penuh tetap di aplikasi utama.</p>
      </section>
    </main>
  );
}
