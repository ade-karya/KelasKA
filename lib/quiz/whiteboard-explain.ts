/**
 * Helper for "Pembahasan Step-by-Step di Papan Tulis" (quiz whiteboard remediation).
 *
 * QuizView (reviewing phase) builds a natural-language chat request and dispatches
 * it as a window CustomEvent. PlaybackChromeRoot listens for the event and forwards
 * the message into the classroom chat (which already carries graded `quizResults`
 * via `buildFreshAgentLoopStoreState`, so the teacher can ground the explanation).
 *
 * Keeping the message builder here makes it unit-testable and keeps the Indonesian
 * and English phrasing in one place.
 */

export const QUIZ_WHITEBOARD_EXPLAIN_EVENT = 'kelaska:quiz-whiteboard-explain';

export interface QuizWhiteboardExplainItem {
  /** 1-based question number shown to the learner. */
  questionNumber: number;
  questionId: string;
  question: string;
  studentAnswer: string;
  correctAnswer: string;
  analysis?: string;
}

export interface QuizWhiteboardExplainEventDetail {
  message: string;
  sceneId?: string;
  /** Question ids included in the request (for debugging/telemetry). */
  questionIds?: string[];
}

function isIndonesian(locale?: string): boolean {
  return (locale ?? '').toLowerCase().startsWith('id');
}

function cleanText(value: string | undefined, maxLength: number): string {
  const trimmed = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return '-';
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

function formatAnswer(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed || '(kosong)';
}

function formatAnswerEn(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed || '(empty)';
}

export function buildSingleQuizWhiteboardExplainMessage(
  item: QuizWhiteboardExplainItem,
  locale?: string,
): string {
  const question = cleanText(item.question, 500);
  if (isIndonesian(locale)) {
    const student = formatAnswer(item.studentAnswer);
    const correct = formatAnswer(item.correctAnswer);
    return [
      `Tolong bahas soal nomor ${item.questionNumber} langkah demi langkah di papan tulis (whiteboard).`,
      `Soal: "${question}"`,
      `Jawaban saya: "${cleanText(student, 300)}" (salah).`,
      `Kunci jawaban: "${cleanText(correct, 300)}".`,
      'Buka papan tulis, lalu tulis penyelesaiannya satu langkah per satu: tulis judul "Langkah 1/2/3…" yang pendek, tulis tiap rumus memakai LaTeX, dan jelaskan tiap langkah dengan suara singkat dalam Bahasa Indonesia.',
      'Mulai dari konsep dasarnya, tunjukkan setiap penurunan rumus/perhitungan sampai jawaban akhir, dan tunjukkan di mana letak kesalahan jawaban saya. Fokus hanya pada soal ini.',
    ].join(' ');
  }
  const student = formatAnswerEn(item.studentAnswer);
  const correct = formatAnswerEn(item.correctAnswer);
  return [
    `Please explain question ${item.questionNumber} step by step on the whiteboard.`,
    `Question: "${question}"`,
    `My answer: "${cleanText(student, 300)}" (incorrect).`,
    `Correct answer: "${cleanText(correct, 300)}".`,
    'Open the whiteboard and write the solution one step at a time: a short "Step 1/2/3…" title per step, each formula in LaTeX, with one short spoken sentence per step.',
    'Start from the basic concept, show every derivation/calculation to the final answer, and point out where my answer went wrong. Focus only on this question.',
  ].join(' ');
}

export function buildMultiQuizWhiteboardExplainMessage(
  items: QuizWhiteboardExplainItem[],
  locale?: string,
): string {
  const numbered = items.map((item) => item.questionNumber).join(', ');
  if (isIndonesian(locale)) {
    const lines = items.slice(0, 5).map((item) => {
      const q = cleanText(item.question, 180);
      return `No. ${item.questionNumber}: "${q}" (jawaban saya "${cleanText(formatAnswer(item.studentAnswer), 120)}", kunci "${cleanText(formatAnswer(item.correctAnswer), 120)}")`;
    });
    const more = items.length > 5 ? ` Dan ${items.length - 5} soal salah lainnya.` : '';
    return [
      `Tolong bahas soal nomor ${numbered} yang saya jawab salah, satu per satu di papan tulis (whiteboard).`,
      `${lines.join(' ')}${more}`,
      'Buka papan tulis, bahas tiap soal langkah demi langkah (Langkah 1/2/3…): judul pendek + satu rumus LaTeX per langkah, dengan penjelasan suara singkat Bahasa Indonesia.',
      'Mulai dari konsep dasar tiap soal, tunjukkan perhitungannya sampai jawaban akhir, dan tunjukkan kesalahan saya. Jangan bahas soal yang sudah benar.',
    ].join(' ');
  }
  const lines = items.slice(0, 5).map((item) => {
    const q = cleanText(item.question, 180);
    return `Q${item.questionNumber}: "${q}" (mine "${cleanText(formatAnswerEn(item.studentAnswer), 120)}", key "${cleanText(formatAnswerEn(item.correctAnswer), 120)}")`;
  });
  const more = items.length > 5 ? ` Plus ${items.length - 5} more incorrect.` : '';
  return [
    `Please explain my incorrect questions ${numbered} one by one on the whiteboard.`,
    `${lines.join(' ')}${more}`,
    'Open the whiteboard and teach each question step by step (Step 1/2/3…): short title + one LaTeX formula per step, with one short spoken sentence per step.',
    'Start from the basic concept of each question, show the work to the final answer, and point out my mistake. Skip questions I already got right.',
  ].join(' ');
}

export function dispatchQuizWhiteboardExplain(
  message: string,
  extra?: Omit<QuizWhiteboardExplainEventDetail, 'message'>,
): void {
  if (typeof window === 'undefined') return;
  const detail: QuizWhiteboardExplainEventDetail = { message, ...extra };
  window.dispatchEvent(new CustomEvent(QUIZ_WHITEBOARD_EXPLAIN_EVENT, { detail }));
}
