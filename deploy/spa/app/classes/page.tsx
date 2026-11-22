'use client';

import { useCallback, useEffect, useState } from 'react';

import { createCourse, fetchCourses, formatDate, type CourseSummary } from '../../lib/courses';

export default function ClassesPage() {
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCourses(await fetchCourses());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Daftar kelas gagal dimuat.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const course = await createCourse(name, description);
      setCourses((current) => [course, ...current]);
      setName('');
      setDescription('');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kelas gagal dibuat.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <main>
      <h1>Kursus Saya</h1>
      <p className="muted">
        <a href="/">← Konsol sesi</a>
      </p>

      <section className="panel">
        <h2>Buat kelas baru</h2>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            Nama kelas
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            Deskripsi (opsional)
            <input value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <button type="submit" disabled={creating || !name.trim()}>
            {creating ? 'Membuat…' : 'Buat kelas'}
          </button>
        </form>
      </section>

      <section>
        <h2>Daftar kelas</h2>
        {loading && <p className="muted">Memuat…</p>}
        {error && <p className="state-offline">{error}</p>}
        {!loading && !error && courses.length === 0 && (
          <p className="muted">Belum ada kelas. Buat kelas pertama Anda di atas.</p>
        )}
        <div className="course-grid">
          {courses.map((course) => (
            <article key={course.id} className="panel course-card">
              <h3>
                <a href={`/classroom?id=${encodeURIComponent(course.id)}`}>{course.name}</a>
              </h3>
              {course.description && <p>{course.description}</p>}
              <p className="muted">
                {course.sceneCount} adegan · diperbarui {formatDate(course.updatedAt)}
              </p>
              {course.isOwner === false && <p className="muted">Kelas orang lain (read-only)</p>}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
