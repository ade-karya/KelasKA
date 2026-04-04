<<<<<<< HEAD
export type Locale = 'en-US' | 'id-ID' | 'ar-SA';
=======
import { supportedLocales } from './locales';

export type Locale = (typeof supportedLocales)[number]['code'];
>>>>>>> 412cd4537b2059c6cd46b106a4387ec82fab740f

export const defaultLocale: Locale = 'id-ID';
