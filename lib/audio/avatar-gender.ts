/**
 * Gender of the avatar images the agent-profiles step may pick from, taken from
 * each file's artwork description (the same `desc` the profile prompt sees).
 * The model picks the avatar and the voiceDesign independently, and "a female
 * teacher avatar with a male design" is a perfectly plausible LLM mistake —
 * it then speaks in a woman's voice while looking like a man. The profile step
 * therefore pins the design's gender (and the gender words of `identity`) to
 * the avatar it assigned.
 */
export type AgentAvatarGender = 'male' | 'female';

export const AVATAR_GENDER: Record<string, AgentAvatarGender> = {
  '/avatars/teacher.png': 'male',
  '/avatars/teacher-2.png': 'female',
  '/avatars/assist.png': 'female',
  '/avatars/assist-2.png': 'female',
  '/avatars/clown.png': 'female',
  '/avatars/clown-2.png': 'female',
  '/avatars/curious.png': 'male',
  '/avatars/curious-2.png': 'male',
  '/avatars/note-taker.png': 'male',
  '/avatars/note-taker-2.png': 'male',
  '/avatars/thinker.png': 'female',
  '/avatars/thinker-2.png': 'female',
};

/** The avatar's gender, or `undefined` when the path is not one of the advertised avatars. */
export function avatarGender(path: string | undefined | null): AgentAvatarGender | undefined {
  if (!path) return undefined;
  return AVATAR_GENDER[path];
}

// Latin gendered tokens, swapped one token at a time (never nested matches).
const LATIN_TO_FEMALE: Record<string, string> = {
  man: 'woman',
  men: 'women',
  male: 'female',
  boy: 'girl',
  boys: 'girls',
  gentleman: 'lady',
  gentlemen: 'ladies',
  husband: 'wife',
  king: 'queen',
  prince: 'princess',
  sir: 'madam',
  // Bahasa Indonesia
  pria: 'wanita',
  'laki-laki': 'perempuan',
  putra: 'putri',
  lelaki: 'perempuan',
  cowo: 'cewe',
};

const LATIN_TO_MALE: Record<string, string> = {
  woman: 'man',
  women: 'men',
  female: 'male',
  girl: 'boy',
  girls: 'boys',
  lady: 'gentleman',
  ladies: 'gentlemen',
  wife: 'husband',
  queen: 'king',
  princess: 'prince',
  madam: 'sir',
  wanita: 'pria',
  perempuan: 'pria',
  putri: 'putra',
  cewe: 'cowo',
};

function patternFor(map: Record<string, string>): RegExp {
  // Longest keys first so multi-word tokens win over their parts.
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  const body = keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`\\b(?:${body})\\b`, 'gi');
}

const LATIN_PATTERN_TO_FEMALE = patternFor(LATIN_TO_FEMALE);
const LATIN_PATTERN_TO_MALE = patternFor(LATIN_TO_MALE);

function matchCase(replacement: string, source: string): string {
  if (source.toUpperCase() === source) return replacement.toUpperCase();
  if (/^[A-Z]/.test(source)) return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  return replacement;
}

/** Swap the Latin-script gendered tokens of `text` towards `target` (whole words, case-preserving). */
function swapLatin(text: string, target: AgentAvatarGender): string {
  const map = target === 'female' ? LATIN_TO_FEMALE : LATIN_TO_MALE;
  const pattern = target === 'female' ? LATIN_PATTERN_TO_FEMALE : LATIN_PATTERN_TO_MALE;
  return text.replace(pattern, (token) => matchCase(map[token.toLowerCase()], token));
}

/** Swap 男/女 (never a literal substring of anything else in this alphabet). */
function swapCjk(text: string, target: AgentAvatarGender): string {
  return text.replace(/[男女]/g, (token) => {
    if (target === 'female') return token === '男' ? '女' : token;
    return token === '女' ? '男' : token;
  });
}

/** Force the identity's gender words to `target`. Non-gendered tokens are untouched. */
export function alignVoiceDesignGenderToAvatar<
  T extends { identity?: string; gender?: AgentAvatarGender },
>(design: T, target: AgentAvatarGender): T {
  const aligned = swapCjk(swapLatin(design.identity ?? '', target), target);
  return {
    ...design,
    gender: target,
    identity: aligned,
  };
}
