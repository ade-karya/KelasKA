import { describe, expect, it } from 'vitest';
import {
  applyOutlineAliases,
  normalizeSceneOutlines,
} from '@/lib/server/generation/outline-schema';

// Payload persis yang membuat run gagal sebelum alias ditoleransi
// (diekstrak dari outline_item event run-0al3UXy5jMtKFyQL:
// model mengeluarkan `sceneType`/`sceneTitle`/… bukan `type`/`title`/…).
const step5FirstOutline = {
  id: 'TXBpEj_ppCb38rmPbatqd',
  order: 1,
  narration:
    'Selamat datang. Hari ini kita akan menjelaskan proses metamorfosis, perubahan bentuk luar biasa yang dialami banyak hewan sepanjang hidupnya.',
  sceneType: 'slide',
  sceneTitle: 'Apa Itu Metamorfosis?',
  sceneNumber: 1,
  visualNotes:
    'Foto perbandingan ulat vs kupu-kupu di satu layar, latar hijau lembut, teks besar',
  contentOutline: [
    'Definisi metamorfosis: perubahan bentuk tubuh dari menetas/lahir hingga dewasa',
    'Contoh hewan: kupu-kupu, katak, belalang, nyamuk, lebah',
  ],
  durationMinutes: 5,
  learningObjective: 'Menjelaskan pengertian metamorfosis dan mengapa hewan mengalaminya',
};

describe('outline alias keys (model di luar konvensi field)', () => {
  it('menerima outline ber-alias penuh sebagai outline usable', () => {
    const normalized = normalizeSceneOutlines([step5FirstOutline]);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.value).toHaveLength(1);
    expect(normalized.value[0]).toMatchObject({
      id: 'TXBpEj_ppCb38rmPbatqd',
      type: 'slide',
      title: 'Apa Itu Metamorfosis?',
      order: 1,
      teachingObjective: 'Menjelaskan pengertian metamorfosis dan mengapa hewan mengalaminya',
      estimatedDuration: 300,
    });
    expect(normalized.value[0].keyPoints).toHaveLength(2);
    expect(normalized.value[0].description).toContain('ulat vs kupu-kupu');
  });

  it('member kanonik menang atas alias', () => {
    const normalized = normalizeSceneOutlines([
      {
        id: 'a',
        order: 1,
        type: 'quiz',
        title: 'Kuis',
        sceneType: 'slide',
        sceneTitle: 'Diabaikan',
        durationMinutes: 5,
        estimatedDuration: 42,
      },
    ]);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.value[0]).toMatchObject({
      type: 'quiz',
      title: 'Kuis',
      estimatedDuration: 42,
    });
  });

  it('melipat tipe yang dikenal tanpa memperhatikan kapitalisasi', () => {
    const normalized = normalizeSceneOutlines([{ id: 'a', order: 1, type: 'Slide' }]);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.value[0].type).toBe('slide');
  });

  it('melewatkan tipe asing apa adanya (gagal di content step, bukan di outline)', () => {
    const normalized = normalizeSceneOutlines([{ id: 'a', order: 1, type: 'hologram' }]);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.value[0].type).toBe('hologram');
  });

  it('tetap menolak tanpa type maupun sceneType dengan pesan yang sama', () => {
    expect(normalizeSceneOutlines([{ id: 'a', order: 1 }])).toEqual({
      ok: false,
      message: 'outlines[0].type must be a non-empty string of at most 64 characters',
    });
  });

  it('tetap menolak type lebih dari 64 karakter', () => {
    expect(normalizeSceneOutlines([{ id: 'a', order: 1, sceneType: 'x'.repeat(65) }])).toEqual({
      ok: false,
      message: 'outlines[0].type must be a non-empty string of at most 64 characters',
    });
  });

  it('mengabaikan durationMinutes yang bukan angka', () => {
    const normalized = normalizeSceneOutlines([
      { id: 'a', order: 1, type: 'slide', durationMinutes: 'lama' },
    ]);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.value[0].estimatedDuration).toBeUndefined();
  });

  it('memakai sceneNumber sebagai order bila order absen', () => {
    const normalized = normalizeSceneOutlines([{ id: 'a', sceneNumber: 3, type: 'slide' }]);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.value[0].order).toBe(3);
  });
});

describe('applyOutlineAliases', () => {
  it('mengembalikan undefined untuk non-objek', () => {
    expect(applyOutlineAliases(null)).toBeUndefined();
    expect(applyOutlineAliases([{ id: 'a' }])).toBeUndefined();
    expect(applyOutlineAliases('slide')).toBeUndefined();
  });

  it('tidak mengubah input dan menghapus key alias', () => {
    const input = { ...step5FirstOutline };
    const merged = applyOutlineAliases(input);
    expect(input).toHaveProperty('sceneType', 'slide');
    expect(merged).not.toHaveProperty('sceneType');
    expect(merged).not.toHaveProperty('sceneTitle');
    expect(merged).not.toHaveProperty('durationMinutes');
    expect(merged).toMatchObject({ type: 'slide', title: 'Apa Itu Metamorfosis?' });
  });
});
