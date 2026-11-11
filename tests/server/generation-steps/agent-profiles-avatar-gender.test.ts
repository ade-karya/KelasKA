/**
 * The agent-profiles step asks the model to pick ONE avatar per agent and a
 * voiceDesign for it. Left alone the two drift ("female teacher avatar whose
 * design says male"), so the step instructs the model to keep them aligned and
 * then corrects any mismatch it still gets back to the avatar's own gender.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  generateAgentProfiles,
  type AgentProfilesInput,
} from '@/lib/server/generation/steps/agent-profiles';

import { fakeModel, testLogger } from './helpers';

const callLLM = vi.hoisted(() => vi.fn());

vi.mock('@/lib/ai/llm', () => ({
  callLLM: (...args: unknown[]) => callLLM(...args),
}));

const FEMALE_AVATAR = { path: '/avatars/teacher-2.png', desc: 'Female teacher, gentle expression' };
const MALE_AVATAR = { path: '/avatars/teacher.png', desc: 'Male teacher with glasses' };

const STUDENT = {
  name: 'Andi',
  role: 'student',
  persona: 'An energetic student who loves asking questions.',
  avatar: '/avatars/curious.png',
  color: '#222222',
  priority: 5,
  voiceDesign: {
    identity: 'bright young male student',
    texture: 'clear',
    delivery: 'energetic',
    gender: 'male',
  },
};

const TEACHER = {
  name: 'Bu Sari',
  role: 'teacher',
  persona: 'A patient teacher.',
  avatar: FEMALE_AVATAR.path,
  color: '#111111',
  priority: 10,
  voiceDesign: {
    identity: 'middle-aged male teacher',
    texture: 'warm low',
    delivery: 'calm',
    gender: 'male',
  },
};

function profilesPayload(agents: unknown[]) {
  return { text: JSON.stringify({ agents }) };
}

async function generate(agents: unknown[], extra: Partial<AgentProfilesInput> = {}) {
  callLLM.mockResolvedValue(profilesPayload(agents));
  return generateAgentProfiles(
    {
      stageInfo: { name: 'Intro to Algebra' },
      languageDirective: 'Respond in Indonesian.',
      availableAvatars: [FEMALE_AVATAR.path, MALE_AVATAR.path],
      avatarDescriptions: [FEMALE_AVATAR, MALE_AVATAR],
      model: fakeModel(),
      ...extra,
    },
    { log: testLogger() },
  );
}

describe('the prompt ties each avatar to a gender', () => {
  it('lists every advertised avatar with its gender', async () => {
    callLLM.mockResolvedValue(profilesPayload([TEACHER]));
    await generate([TEACHER, STUDENT]);
    const prompt = (callLLM.mock.calls[0][0] as { prompt: string }).prompt;
    expect(prompt).toContain('"gender":"female"');
    expect(prompt).toContain('"gender":"male"');
    expect(prompt).toContain('voiceDesign.gender');
    expect(prompt).toContain('gender of the avatar chosen');
  });
});

describe('the step corrects a mismatched answer to the avatar’s gender', () => {
  beforeEach(() => callLLM.mockReset());

  it('moves female avatars to a female design', async () => {
    const result = await generate([TEACHER, STUDENT]);
    const teacher = result.find((agent) => agent.role === 'teacher')!;
    expect(teacher.avatar).toBe(FEMALE_AVATAR.path);
    expect(teacher.voiceDesign?.gender).toBe('female');
    expect(teacher.voiceDesign?.identity).toContain('female');
    expect(teacher.voiceDesign?.identity).not.toMatch(/\bmale\b/);
  });

  it('moves male avatars to a male design', async () => {
    const mismatched = {
      ...TEACHER,
      avatar: MALE_AVATAR.path,
      voiceDesign: {
        identity: 'middle-aged female teacher',
        texture: 'soft',
        delivery: 'gentle',
        gender: 'female',
      },
    };
    const result = await generate([mismatched, STUDENT]);
    const teacher = result.find((agent) => agent.role === 'teacher')!;
    expect(teacher.voiceDesign?.gender).toBe('male');
    expect(teacher.voiceDesign?.identity).toContain('male');
    expect(teacher.voiceDesign?.identity).not.toMatch(/\bfemale\b/);
  });

  it('handles Indonesian gender tokens', async () => {
    const mismatched = {
      ...TEACHER,
      voiceDesign: {
        identity: 'pria paruh baya guru matematika',
        texture: 'tenang',
        delivery: 'hangat',
        gender: 'male',
      },
    };
    const result = await generate([mismatched, STUDENT]);
    const teacher = result.find((agent) => agent.role === 'teacher')!;
    expect(teacher.voiceDesign?.gender).toBe('female');
    expect(teacher.voiceDesign?.identity).toBe('wanita paruh baya guru matematika');
  });

  it('leaves an aligned answer untouched', async () => {
    const aligned = {
      ...TEACHER,
      voiceDesign: {
        identity: 'middle-aged female teacher',
        texture: 'warm low',
        delivery: 'calm',
        gender: 'female',
      },
    };
    const result = await generate([aligned, STUDENT]);
    const teacher = result.find((agent) => agent.role === 'teacher')!;
    expect(teacher.voiceDesign).toEqual({
      identity: 'middle-aged female teacher',
      texture: 'warm low',
      delivery: 'calm',
      gender: 'female',
    });
  });

  it('does not invent a design when the model gave none and the avatar matched no gender rule applies', async () => {
    const { voiceDesign, ...withoutDesign } = TEACHER;
    const result = await generate([withoutDesign, STUDENT]);
    const teacher = result.find((agent) => agent.role === 'teacher')!;
    expect(teacher.voiceDesign).toBeUndefined();
  });
});
