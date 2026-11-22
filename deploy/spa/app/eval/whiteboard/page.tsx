'use client';

export default function EvalWhiteboardPage() {
  return (
    <main>
      <h1>Evaluasi Whiteboard</h1>
      <p className="muted">
        <a href="/workspace">← Ruang Kerja</a>
      </p>
      <section className="panel">
        <p>
          Halaman evaluasi renderer whiteboard tetap berjalan di aplikasi utama; shell statis hanya
          menyediakan penampil kelas ringkas di <a href="/classroom">/classroom</a>.
        </p>
      </section>
    </main>
  );
}
