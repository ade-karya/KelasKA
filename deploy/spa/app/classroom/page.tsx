'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchStage, orderedScenes, slideText, type ClassroomDocument } from '../../lib/classroom';

export default function ClassroomPage() {
  const [course, setCourse] = useState<ClassroomDocument | null>(null);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [courseId, setCourseId] = useState('');

  useEffect(() => {
    // Static export has no dynamic route params; read the query in the browser.
    const id = new URLSearchParams(window.location.search).get('id') ?? '';
    setCourseId(id);
    if (!id) {
      setError('Tautan kelas tidak memiliki id.');
      return;
    }
    void fetchStage(id)
      .then(setCourse)
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Kelas gagal dimuat.'));
  }, []);

  const scenes = useMemo(() => (course ? orderedScenes(course) : []), [course]);
  const current = scenes[index];

  const go = useCallback(
    (delta: number) => setIndex((value) => Math.min(Math.max(0, value + delta), scenes.length - 1)),
    [scenes.length],
  );

  return (
    <main>
      <h1>{course?.stage.name ?? 'Kelas'}</h1>
      <p className="muted">
        <a href="/classes">← Kursus Saya</a>
        {courseId ? ` · id: ${courseId}` : ''}
      </p>

      {error && <p className="state-offline">{error}</p>}
      {!course && !error && <p className="muted">Memuat kelas…</p>}

      {course && (
        <section className="panel">
          <h2>
            Adegan {scenes.length ? index + 1 : 0} / {scenes.length}
            {current ? ` — ${current.title}` : ''}
          </h2>
          {current?.type === 'quiz' ? (
            <ol>
              {(current.content?.questions ?? []).map((question) => (
                <li key={question.question}>
                  <p>{question.question}</p>
                  {(question.options ?? []).map((option) => (
                    <p key={option.value} className="muted">
                      {option.label}. {option.value}
                    </p>
                  ))}
                </li>
              ))}
            </ol>
          ) : (
            <div className="slide-text">
              {current ? slideText(current).map((line, i) => <p key={i}>{line}</p>) : null}
            </div>
          )}
          <p>
            <button onClick={() => go(-1)} disabled={index === 0}>
              Sebelumnya
            </button>
            <button onClick={() => go(1)} disabled={index >= scenes.length - 1}>
              Berikutnya
            </button>
          </p>
          <p className="muted">
            Penampil ringkas: teks slide dan soal kuis. Narasi/interaksi penuh tetap di aplikasi.
          </p>
        </section>
      )}
    </main>
  );
}
