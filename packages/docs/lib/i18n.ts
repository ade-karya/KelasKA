import { defineI18n } from 'fumadocs-core/i18n';
import { uiTranslations } from 'fumadocs-ui/i18n';
import { DEFAULT_LANGUAGE, LANGUAGES, LOCALE_LABELS, RTL_LOCALES } from './locales.mjs';

export const i18n = defineI18n({
  defaultLanguage: DEFAULT_LANGUAGE,
  languages: LANGUAGES,
  // Default locale (id) has NO path prefix: /docs/getting-started.
  // Other locales are prefixed: /docs/en/getting-started.
  hideLocale: 'default-locale',
});

export const rtlLocales = new Set(RTL_LOCALES);
export const localeLabels = LOCALE_LABELS;

// fumadocs-ui only ships English UI strings; the fork adds Indonesian so the
// default locale's chrome (search, sidebar, page actions) matches its content.
// Every other locale keeps the English defaults until it is translated.
const idUI = {
  search: 'Cari',
  searchNoResult: 'Tidak ada hasil',
  searchOpen: 'Buka pencarian',
  searchClose: 'Tutup pencarian',
  toc: 'Di halaman ini',
  tocNoHeadings: 'Tidak ada judul',
  tocInline: 'Daftar isi',
  lastUpdate: 'Terakhir diperbarui pada',
  chooseLanguage: 'Pilih bahasa',
  nextPage: 'Halaman berikutnya',
  previousPage: 'Halaman sebelumnya',
  chooseTheme: 'Tema',
  editOnGithub: 'Edit di GitHub',
  themeToggle: 'Ubah tema',
  themeLight: 'Terang',
  themeDark: 'Gelap',
  themeSystem: 'Sistem',
  codeBlockCopy: 'Salin teks',
  codeBlockCopied: 'Teks disalin',
  accordionCopyAnchor: 'Salin tautan',
  headingCopyAnchor: 'Salin tautan judul',
  bannerClose: 'Tutup banner',
  menuToggle: 'Buka/tutup menu',
  pageActionsCopyMarkdown: 'Salin Markdown',
  pageActionsOpen: 'Buka',
  pageActionsOpenGitHub: 'Buka di GitHub',
  pageActionsViewMarkdown: 'Lihat sebagai Markdown',
  pageActionsOpenScira: 'Buka di Scira AI',
  pageActionsOpenChatGPT: 'Buka di ChatGPT',
  pageActionsOpenClaude: 'Buka di Claude',
  pageActionsOpenCursor: 'Buka di Cursor',
  pageActionsOpenInLLMPrompt: (url: string) =>
    `Baca ${url}, saya ingin bertanya tentang isinya.`,
  sidebarOpen: 'Buka bilah sisi',
  sidebarCollapse: 'Ciutkan bilah sisi',
  typeTableProp: 'Properti',
  typeTableType: 'Tipe',
  typeTableDefault: 'Default',
  typeTableParameters: 'Parameter',
  typeTableReturns: 'Nilai kembali',
  notFoundTitle: 'Halaman tidak ditemukan',
  notFoundDescription:
    'Halaman yang Anda cari mungkin sudah dihapus, namanya berubah, atau sedang tidak tersedia.',
  notFoundLink: 'Kembali ke beranda',
};

// Translations API with the built-in fumadocs-ui namespace. `displayName` drives
// the labels in the language switcher; build it from the single locale source.
export const translations = i18n
  .translations()
  .extend(uiTranslations())
  .add(
    'ui',
    Object.fromEntries(
      LANGUAGES.map((lang) => [
        lang,
        { displayName: LOCALE_LABELS[lang], ...(lang === 'id' ? idUI : {}) },
      ]),
    ) as Record<string, { displayName: string }>,
  );
