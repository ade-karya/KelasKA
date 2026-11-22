'use client';

/** Sandbox PBL examples are a feature of the main app, not the static shell. */
export default function PBLPage() {
  return (
    <main>
      <h1>Contoh PBL v3</h1>
      <p className="muted">
        <a href="/workspace">← Ruang Kerja</a>
      </p>
      <section className="panel">
        <p>
          Halaman contoh PBL tersedia di aplikasi utama ketika mode sandbox diaktifkan. Shell statis
          tidak menjalankan sandbox workspace.
        </p>
        <p>
          <a href="/classes">Buka kelas yang sudah dibuat →</a>
        </p>
      </section>
    </main>
  );
}
