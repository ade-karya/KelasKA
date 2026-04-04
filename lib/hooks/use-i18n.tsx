'use client';

import { createContext, useContext, useEffect, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type Locale, defaultLocale, supportedLocales } from '@/lib/i18n';
import '@/lib/i18n/config';

const LOCALE_STORAGE_KEY = 'locale';

/** Match a browser language code (e.g. 'en', 'zh-TW') to a supported locale */
function resolveLocale(lang: string): Locale {
  // Exact match
  const exact = supportedLocales.find((l) => l.code === lang);
  if (exact) return exact.code;
  // Prefix match: 'en' → 'en-US', 'zh' → 'zh-CN'
  const prefix = lang.split('-')[0].toLowerCase();
  const match = supportedLocales.find((l) => l.code.toLowerCase().startsWith(prefix));
  return match?.code ?? defaultLocale;
}

type I18nContextType = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
};

const LOCALE_STORAGE_KEY = 'locale';
const VALID_LOCALES: Locale[] = ['id-ID', 'en-US', 'ar-SA'];

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();

  const locale = (i18n.language || defaultLocale) as Locale;

  // Detect language after hydration to avoid SSR mismatch.
  // i18next handles fallback automatically: if the detected language
  // has no matching JSON file, it falls back to fallbackLng.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (stored && VALID_LOCALES.includes(stored as Locale)) {
        setLocaleState(stored as Locale);
        return;
      }
      const detected = navigator.language?.startsWith('id') ? 'id-ID' : navigator.language?.startsWith('ar') ? 'ar-SA' : navigator.language?.startsWith('en') ? 'en-US' : 'id-ID';
      localStorage.setItem(LOCALE_STORAGE_KEY, detected);
      setLocaleState(detected);
    } catch {
      // localStorage unavailable, keep default
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setLocale = (newLocale: Locale) => {
    i18n.changeLanguage(newLocale);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, newLocale);
    } catch {
      // localStorage unavailable
    }
  };

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
}
