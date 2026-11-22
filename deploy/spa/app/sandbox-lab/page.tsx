'use client';

export default function SandboxLabPage() {
  return (
    <main>
      <h1>Sandbox Lab</h1>
      <p className="muted">
        <a href="/workspace">← Ruang Kerja</a>
      </p>
      <section className="panel">
        <p>
          Lab sandbox memerlukan flag <code>OPENMAIC_SANDBOX_LAB</code> pada aplikasi utama dan
          tidak disertakan dalam export statis.
        </p>
      </section>
    </main>
  );
}
