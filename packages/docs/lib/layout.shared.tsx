import type { ReactNode } from 'react';
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, appShortName, gitConfig, siteUrl } from './shared';
import { i18n } from './i18n';

/**
 * Kelas KA lockup for the navbar: the two instansi logos (served from the
 * main app's public/ at the site root) plus the product wordmark. The full
 * product name is long for a navbar, so the lockup shows the short form;
 * `appName` itself is the full name shown in the sidebar and page metadata.
 */
function NavTitle(): ReactNode {
  return (
    <span className="flex items-center gap-2" title={appName}>
      <img src="/logo-kemendikdasmen.png" alt="Kemendikdasmen" className="h-6 w-auto" />
      <img src="/logo-dprd.png" alt="DPRD" className="h-6 w-auto" />
      <span className="font-bold tracking-tight">{appShortName}</span>
    </span>
  );
}

export function baseOptions(lang?: string): BaseLayoutProps {
  // Respect hideLocale: the default locale (id) has no path prefix, so its
  // nav title links to the docs root, not /id.
  const localePrefix =
    lang && lang !== i18n.defaultLanguage ? `/${lang}` : '';

  return {
    nav: {
      // JSX supported
      title: <NavTitle />,
      url: `${localePrefix}/`,
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    // Link back to the live product, shown prominently in the top navbar.
    links: [
      {
        text: lang === 'id' ? 'Buka Aplikasi' : 'Open App',
        url: siteUrl,
        external: true,
      },
    ],
    // enable the locale switcher in the navbar
    i18n: true,
  };
}
