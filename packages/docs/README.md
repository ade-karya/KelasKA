This is a Next.js application generated with
[Create Fumadocs](https://github.com/fuma-nama/fumadocs).

Run development server:

```bash
npm run dev
# or
pnpm dev
# or
yarn dev
```

The site is mounted under the `/docs` basePath, so open
http://localhost:3000/docs in your browser.

Build the static site (`next build` + static export, output in `out/`):

```bash
pnpm build
```

## Explore

In the project, you can see:

- `lib/locales.mjs`: Single source of truth for locales — language list, default
  locale, per-locale search tokenizer, RTL set, labels, and the `/docs` basePath.
  Plain JS so the `scripts/postexport.mjs` build step can import it too.
- `lib/source.ts`: Content source adapter, [`loader()`](https://fumadocs.dev/docs/headless/source-api) wires the MDX content with i18n.
- `lib/layout.shared.tsx`: Shared layout options (nav, GitHub link, Live Demo link).

| Route                       | Description                                                         |
| --------------------------- | ------------------------------------------------------------------- |
| `app/(default)`             | Default locale (id, Indonesian), served unprefixed at `/docs/<slug>`. |
| `app/(intl)/[lang]`         | Other locales, served at `/docs/<lang>/<slug>`.                     |
| `app/static.json/route.ts`  | Build-time Orama static search index (served at `/docs/static.json`). |
| `scripts/postexport.mjs`    | Post-build step: per-locale index redirects + default-locale alias stubs. |

The default locale is `id` (Bahasa Indonesia) because this fork deploys to an
Indonesian audience: `/docs/getting-started` is Indonesian and
`/docs/en/getting-started` is English. `lib/locales.mjs` stays the single
source of truth for the locale list, search tokenizers, labels and basePath.

## Serving the docs from the main app

`packages/docs` is excluded from the Bun workspace (it keeps its own dependency
set), so its static export is not part of the main application build. In the
Kelas KA deployment `scripts/build-docs.sh` installs this package's
dependencies, runs `next build` (static export) and copies `out/` to
`public/docs-site`. `app/docs/[[...slug]]/route.ts` in the main app then serves
those files at `/docs`, mapping extension-less URLs (`/docs/getting-started`)
onto `getting-started.html`, `_next/…` assets and `static.json`. The export
carries `basePath: '/docs'`, so every internal link and asset URL already
points at the mount path.

```bash
bun run build:docs   # build once, then /docs works in `bun run dev`/`next start`
```

`install.sh --colab`/`--kaggle` runs the same script in the background during
the production build and copies `public/` into `.next/standalone`; `--no-docs`
skips it. Without a build, `/docs` answers a "not built yet" page instead of a
404.

### Fumadocs MDX

A `source.config.ts` config file has been included, you can customise different options like frontmatter schema.

Read the [Introduction](https://fumadocs.dev/docs/mdx) for further details.

## Known limitations

### Default-locale docs work only as top-level pages

The default locale (`id`) is served unprefixed (`/docs/getting-started`). To keep
it unprefixed without the hydration conflict that a catch-all two-route-group
split causes, the default-locale route `app/(default)/[slug]` is a single
(non-catch-all) segment. As a result, **nested default-locale pages would 404** —
e.g. `content/docs/guides/intro.mdx` resolves for every other locale (their
routes are catch-all under `app/(intl)/[lang]/[...slug]`) but not for the
default locale.

Only top-level default-locale docs pages work today. Adding nested pages there
requires revisiting the `(default)` route group (and resolving the hydration
conflict that the current split avoids); this is deliberately deferred.

## Learn More

To learn more about Next.js and Fumadocs, take a look at the following
resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js
  features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [Fumadocs](https://fumadocs.dev) - learn about Fumadocs
