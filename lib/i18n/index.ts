import i18n from './config';

export { type Locale, defaultLocale } from './types';
import { commonEnUS, commonIdID, commonArSA } from './common';
import { stageEnUS, stageIdID, stageArSA } from './stage';
import { chatEnUS, chatIdID, chatArSA } from './chat';
import { generationEnUS, generationIdID, generationArSA } from './generation';
import { settingsEnUS, settingsIdID, settingsArSA } from './settings';

export const translations = {
  'id-ID': {
    ...commonIdID,
    ...stageIdID,
    ...chatIdID,
    ...generationIdID,
    ...settingsIdID,
  },
  'en-US': {
    ...commonEnUS,
    ...stageEnUS,
    ...chatEnUS,
    ...generationEnUS,
    ...settingsEnUS,
  },
  'ar-SA': {
    ...commonArSA,
    ...stageArSA,
    ...chatArSA,
    ...generationArSA,
    ...settingsArSA,
  },
} as const;

export type TranslationKey = keyof (typeof translations)[typeof defaultLocale];

export function translate(locale: string, key: string): string {
  return i18n.t(key, { lng: locale });
}

export function getClientTranslation(key: string): string {
  let locale: Locale = defaultLocale;

  if (typeof window !== 'undefined') {
    try {
      const storedLocale = localStorage.getItem('locale');
      if (storedLocale === 'en-US' || storedLocale === 'id-ID' || storedLocale === 'ar-SA') {
        locale = storedLocale;
      }
    } catch {
      // localStorage unavailable, keep default locale
    }
  }

  return translate(locale, key);
}
