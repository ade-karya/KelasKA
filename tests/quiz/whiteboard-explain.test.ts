import { describe, expect, it } from 'vitest';
import {
  buildMultiQuizWhiteboardExplainMessage,
  buildSingleQuizWhiteboardExplainMessage,
} from '@/lib/quiz/whiteboard-explain';
import { buildStateContext } from '@/lib/orchestration/summarizers/state-context';
import { buildChildPrompt } from '@/lib/chat/pi/prompts';
import type { AgentConfig } from '@/lib/orchestration/registry/types';
import type { StatelessChatRequest } from '@/lib/types/chat';

describe('quiz whiteboard explain message', () => {
  const item = {
    questionNumber: 2,
    questionId: 'q2',
    question: 'Jika x + 2 = 5, berapa x?',
    studentAnswer: 'B. 4',
    correctAnswer: 'B. 3',
  };

  it('builds an Indonesian stepwise whiteboard request', () => {
    const msg = buildSingleQuizWhiteboardExplainMessage(item, 'id-ID');
    expect(msg).toContain('soal nomor 2');
    expect(msg).toContain('papan tulis');
    expect(msg).toContain('Langkah');
    expect(msg).toContain('LaTeX');
    expect(msg).toContain('Bahasa Indonesia');
    expect(msg).toContain('Jawaban saya');
  });

  it('builds an English stepwise whiteboard request', () => {
    const msg = buildSingleQuizWhiteboardExplainMessage(item, 'en-US');
    expect(msg).toContain('question 2');
    expect(msg).toContain('whiteboard');
    expect(msg).toContain('Step 1/2/3');
    expect(msg).toContain('LaTeX');
  });

  it('builds a multi-question remediation request without re-teaching correct ones', () => {
    const msg = buildMultiQuizWhiteboardExplainMessage(
      [
        item,
        {
          questionNumber: 3,
          questionId: 'q3',
          question: 'Turunan dari x^2?',
          studentAnswer: 'x',
          correctAnswer: '2x',
        },
      ],
      'id-ID',
    );
    expect(msg).toContain('nomor 2, 3');
    expect(msg).toContain('satu per satu');
    expect(msg).toContain('Jangan bahas soal yang sudah benar');
  });
});

describe('quiz state context whiteboard remediation', () => {
  function makeQuizState(): StatelessChatRequest['storeState'] {
    return {
      stage: { id: 'stage-1', name: 'Matematika' },
      scenes: [
        {
          id: 'quiz-1',
          stageId: 'stage-1',
          title: 'Kuis',
          order: 1,
          type: 'quiz',
          content: {
            type: 'quiz',
            questions: [
              {
                id: 'q1',
                type: 'single',
                question: 'Jika x + 2 = 5, berapa x?',
                options: [
                  { value: 'A', label: '2' },
                  { value: 'B', label: '3' },
                ],
                answer: ['B'],
                analysis: 'Kurangkan kedua sisi dengan 2.',
              },
            ],
          },
        },
      ],
      currentSceneId: 'quiz-1',
      mode: 'autonomous',
      whiteboardOpen: false,
      quizResults: {
        sceneId: 'quiz-1',
        answers: { q1: 'A' },
        results: [{ questionId: 'q1', correct: false, status: 'incorrect', earned: 0 }],
      },
    } as unknown as StatelessChatRequest['storeState'];
  }

  it('instructs stepwise whiteboard derivation for wrong answers', () => {
    const context = buildStateContext(makeQuizState());
    expect(context).toContain('Quiz results');
    expect(context).toContain('wb_draw_latex');
    expect(context).toContain('Langkah 1/2/3');
    expect(context).toContain('One formula per draw');
  });
});

describe('quiz remediation whiteboard guidelines', () => {
  const teacher: AgentConfig = {
    id: 'teacher-1',
    name: 'Guru AI',
    role: 'teacher',
    persona: 'Guru yang sabar.',
    avatar: '',
    color: '#3366ff',
    allowedActions: ['wb_open', 'wb_draw_text', 'wb_draw_latex', 'wb_clear'],
    priority: 10,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    isDefault: true,
  };

  function makeBody(): StatelessChatRequest {
    return {
      messages: [],
      storeState: {
        stage: { id: 'stage-1', name: 'Fisika' },
        scenes: [],
        currentSceneId: null,
        whiteboardOpen: false,
      },
      config: { agentIds: [teacher.id], agentConfigs: [teacher] },
      apiKey: '',
    } as unknown as StatelessChatRequest;
  }

  it('teaches stepwise quiz remediation in the child prompt', () => {
    const prompt = buildChildPrompt(
      makeBody(),
      teacher,
      [],
      [],
      ['wb_open', 'wb_draw_text', 'wb_draw_latex'],
    );
    expect(prompt).toContain('Quiz remediation');
    expect(prompt).toContain('Langkah N');
    expect(prompt).toContain('Never dump the whole solution');
  });
});
