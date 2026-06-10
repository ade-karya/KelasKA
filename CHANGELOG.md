# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.2] - 2026-06-02

### Features

- **KelasKA Editor (v0) — slide editing surface** — A new **Pro Mode** toggle turns any generated slide into an editable canvas: select and edit text, insert text boxes and images, navigate and reorder slides from a thumbnail rail, with history-aware undo/redo. This is the first surface of the broader KelasKA Editor framework (gated behind `NEXT_PUBLIC_MAIC_EDITOR_ENABLED`) [#615](/pull/615)
- **Editable outline before generation** — The streaming course outline now morphs into an inline editor: review, edit, reorder, and add or delete scenes and bullet points, then confirm to generate the full course — so you catch structure problems before spending a full generation [#558](/pull/558)
- **Offline-ready classroom export** — Exported teaching resource packs and classroom ZIPs now inline external assets so interactive pages open fully offline, even when copied to another machine [#613](/pull/613)
- Add Claude Opus 4.8 and MiniMax M3 to the default model registry [#635](/pull/635)
- Add Gemini 3.5 Flash [#584](/pull/584)
- Add Xiaomi MiMo Token Plan support [#578](/pull/578) (by @xuruiray)
- Add web search providers: Brave and Baidu [#42](/pull/42) (by @YizukiAme), Bocha [#524](/pull/524), and MiniMax [#634](/pull/634)
- Add Azure STT (Fast Transcription) as a speech-to-text provider [#175](/pull/175) (by @ismailariyan)
- Add HappyHorse video adapter [#509](/pull/509) (by @xuruiray) and Lemonade as an LLM provider [#508](/pull/508)
- Add OpenAI image generation environment-variable fallback [#510](/pull/510) (by @xuruiray)
- Add generated-video manifest references so produced videos survive export/import [#540](/pull/540)
- Add Traditional Chinese (zh-TW) [#517](/pull/517) (by @alvinets) and Brazilian Portuguese (pt-BR) [#602](/pull/602) (by @hemanz) interface languages

### Bug Fixes

- **Server-configured providers are now admin-managed** — providers set via server environment can no longer be overridden by client settings, preventing base-URL/key tampering on shared deployments [#624](/pull/624); fixes server API-key fallback when the client echoes the provider base URL [#533](/pull/533) (by @LooThao); auto-selects the server LLM model [#577](/pull/577) (by @xuruiray); and enforces a "usable provider ⇒ concrete model" invariant [#581](/pull/581)
- Keep interactive scenes alive across remounts with an iframe keep-alive pool, so interactive content no longer reloads when navigating [#629](/pull/629)
- Restore the orchestration director's ability to answer the user's question and stop runaway turns (removed `maxTurns`) [#599](/pull/599); restore agent attribution in the director summary [#554](/pull/554) (by @ashutoshrana)
- Skip shapes with malformed SVG paths instead of aborting the whole PPTX export [#505](/pull/505); prevent memory leaks and silent export failures [#552](/pull/552) (by @arnow117)
- Add defensive checks in ChartElement to prevent crashes on malformed chart data [#588](/pull/588) (by @tongshu2023)
- Let whiteboard code elements capture internal scroll/drag instead of the canvas [#544](/pull/544) (by @cosarah)
- Preserve discussion triggers when importing classroom ZIPs [#557](/pull/557) (by @cosarah)
- Fix generated video thumbnails [#546](/pull/546)
- Gate media snippets in the interactive-outlines prompt template [#628](/pull/628)
- Hide the unsupported MiniMax Hailuo fast text-to-video model [#632](/pull/632); remove weak Lemonade recommended models [#567](/pull/567) (by @cosarah)
- Fix Haiku 4.5 thinking controls [#501](/pull/501)
- Use an ESM import for TypeScript in the pptxgenjs rollup config [#616](/pull/616)
- Align zh-TW provider names with the rest of the locale set

### Other Changes

- Add a Fumadocs-based documentation site [#622](/pull/622)
- Add a VoxCPM2 setup guide and tighten the README section [#500](/pull/500) [#502](/pull/502)
- Fix the commercial licensing contact email [#604](/pull/604) (by @DHQ1204)

## [0.2.1] - 2026-04-26

### Features

- **[VoxCPM2](https://github.com/OpenBMB/VoxCPM) TTS provider with voice cloning** — KelasKA adapts to user-managed VoxCPM backends (vLLM-Omni, Nano-VLLM, official Python API). Clone any voice from a reference audio clip you upload or record in the browser, or let Auto Voice generate a fitting voice from each agent's persona at synthesis time. Voice profiles are stored locally to keep the serverless setup model. The Agent Bar exposes a searchable, previewable voice picker that draws from the global VoxCPM voice pool [#496](/pull/496)
- **Per-model thinking configuration** — First-class metadata for each model's reasoning capability (effort levels, on/off toggle, adjustable budget, or fixed thinking) flows through chat and all generation paths and is mapped to the right provider-specific request fields (Anthropic `thinking`, OpenAI `reasoning`, etc.). The model selector becomes a unified provider/model/thinking popover with compact search and a much smaller toolbar footprint [#494](/pull/494)
- **End-of-course completion page with persistent quiz state** — When the outline is fully materialized, students see a course-complete view with quiz score card, scene-type stat cards, and a (motion-respecting) confetti celebration. Quiz answers persist on submit and grading results persist on completion, so navigating away and back restores the reviewing state with AI feedback intact instead of resetting [#484](/pull/484)
- Add latest released models including [GPT-5.5](/pull/487), DeepSeek-V4 (`-pro`, `-flash`), Xiaomi [MiMo](https://github.com/XiaomiMiMo) (`mimo-v2.5-pro`, `mimo-v2.5`), Tencent [Hy3](https://github.com/Tencent-Hunyuan), and [OpenRouter](https://openrouter.ai/) as a multi-provider gateway [#481](/pull/481) [#487](/pull/487)
- Add OpenAI image generation (GPT-Image-2) as a media provider [#481](/pull/481)
- Refresh built-in model registries across Anthropic, DeepSeek, Kimi, Qwen, MiniMax, Grok, OpenAI, GLM, SiliconFlow, and Ollama; persisted local settings now rehydrate in registry order so newly curated lists appear consistent without clearing state [#481](/pull/481)
- Add inline search for recent classrooms on the home page with deferred filtering by name and description, keyboard-driven open/clear/collapse [#476](/pull/476)
- Add Deep-Interactive badge on classroom thumbnails for sessions generated with Interactive Mode [#478](/pull/478)
- Replace always-included media instruction blocks in generation prompts with conditional snippet includes gated on `imageEnabled` / `videoEnabled` — disabled capabilities are removed from the prompt entirely instead of relying on negative-override directives the model often ignored [#490](/pull/490) (by @YizukiAme)

### Bug Fixes

- Fix language drift between outline and scene generation by unifying the languageDirective across the pipeline so the same target language flows from outline planning through every per-scene call [#474](/pull/474)

### Other Changes

- Refactor whiteboard role prompts to file-based markdown templates and add a geometry-conflict detector (overlap, line-through-bbox, canvas clipping) that surfaces problems back to the model. Eval (flash, repeat 3, gemini-3.1-pro scorer) shows overall quality 5.4 → 6.1 and overlap 6.3 → 8.1 from prompt + detector alone [#485](/pull/485)
- Migrate orchestration prompt builders (`buildStructuredPrompt`, `buildDirectorPrompt`, `buildPBLSystemPrompt`) from inline TS template literals to file-based markdown templates under `lib/prompts/`, sharing the loader infrastructure with the generation pipeline. `prompt-builder.ts` 890 → 314 lines; future content tweaks land as markdown edits [#459](/pull/459)

## [0.2.0] - 2026-04-20

### Features

- **Deep Interactive Mode** — Generate hands-on interactive scenes (3D visualization, simulation, game, mind map/diagram, online programming) with an AI teacher who operates the UI to guide students. Fully responsive across desktop, tablet, and mobile [#461](/pull/461)
- Add code element support on the whiteboard — AI agents can write, display, and reference runnable code during lessons [#385](/pull/385) (by @cosarah)
- Add Arabic (ar-SA) interface language [#431](/pull/431) (by @YizukiAme)
- Add MinerU Cloud API as a PDF parsing provider, with a dedicated settings UI [#438](/pull/438)
- Add latest OpenAI models to the default config [#416](/pull/416) (by @donghch)
- Add GLM-5.1 and GLM-5V-Turbo to GLM preset models [#437](/pull/437)
- Add international base URL shortcuts for GLM, Kimi, and MiniMax in provider settings [#449](/pull/449)
- Add anti-framing security headers (X-Frame-Options + CSP `frame-ancestors`) with an optional `ALLOWED_FRAME_ANCESTORS` override [#430](/pull/430) (by @YizukiAme)
- Add i18n key alignment check to CI so missing or extra translation keys fail the build [#447](/pull/447) (by @KanameMadoka520)
- Add whiteboard layout quality eval harness and unify it with the outline-language harness [#425](/pull/425) [#453](/pull/453)

### Bug Fixes

- Fix classroom ZIP export to use the latest classroom name from IndexedDB [#435](/pull/435)
- Fix spotlight cutout for text elements and add element-content variant for image/video [#457](/pull/457)

### Other Changes

- Renew the README with Deep Interactive Mode showcase and visual assets [#463](/pull/463) (by @Shirokumaaaa)
- Update Discord invite links across README, CONTRIBUTING, and issue templates

## [0.1.1] - 2026-04-14

### Features
- Add inline language inference for outline and PBL generation, replacing manual language selector [#412](/pull/412) (by @cosarah)
- Add ACCESS_CODE site-level authentication for shared deployments [#411](/pull/411)
- Add classroom export and import as ZIP [#418](/pull/418)
- Add custom OpenAI-compatible TTS/ASR provider support [#409](/pull/409)
- Add Ollama as built-in provider with keyless activation [#94](/pull/94) (by @f1rep0wr)
- Add Japanese (ja-JP) locale [#365](/pull/365) (by @YizukiAme)
- Add Russian (ru-RU) locale [#261](/pull/261) (by @maximvalerevich)
- Migrate i18n infrastructure to i18next framework [#331](/pull/331) (by @cosarah)
- Add MiniMax provider support [#182](/pull/182) (by @Hi-Jiajun)
- Add Doubao TTS 2.0 (Volcengine) provider [#283](/pull/283)
- Add configurable model selection for TTS and ASR [#108](/pull/108) (by @ShaojieLiu)
- Add context-aware Tavily web search when PDF is uploaded [#258](/pull/258) (by @nkmohit)
- Add course rename [#58](/pull/58) (by @YizukiAme)
- Add end-to-end generation happy path test [#405](/pull/405)

### Bug Fixes
- Fix DNS rebinding bypass in SSRF validation [#386](/pull/386) (by @YizukiAme)
- Add ALLOW_LOCAL_NETWORKS env var for self-hosted deployments [#366](/pull/366)
- Fix custom provider baseUrl not persisting on creation [#417](/pull/417) (by @YizukiAme)
- Hide Ollama from model selector when not configured [#420](/pull/420) (by @cosarah)
- Fix agent configs not persisting in server-generated classrooms [#336](/pull/336) (by @YizukiAme)
- Fix action filtering logic and add safety improvements [#163](/pull/163) (by @zky001)
- Fix modifier-key combos triggering single-key shortcuts [#359](/pull/359) (by @YizukiAme)
- Fix agent mode selection for conditionally set generatedAgentConfigs [#373](/pull/373) (by @YizukiAme)
- Unify TTS model selection to per-provider and fix ElevenLabs model_id [#326](/pull/326)
- Allow model-level test connection without client-side API key [#309](/pull/309) (by @cosarah)
- Add structured request context to all API error logs [#337](/pull/337) (by @YizukiAme)
- Fix breathing bar background color in roundtable [#307](/pull/307)

### Other Changes
- Add missing Ollama and Doubao provider names for ru-RU [#389](/pull/389) (by @cosarah)
- Update Ollama logo to official version [#400](/pull/400) (by @cosarah)
- Remove deprecated Gemini 3 Pro Preview model [#142](/pull/142) (by @Orinameh)
- Update expired Discord invite link
- Create SECURITY.md [#281](/pull/281) (by @fai1424)

### New Contributors

@f1rep0wr, @maximvalerevich, @Hi-Jiajun, @cosarah, @zky001, @Orinameh, @fai1424

## [0.1.0] - 2026-03-26

The first tagged release of KelasKA, including all improvements since the initial open-source launch.

### Highlights

- **Discussion TTS** — Voice playback during discussion phase with per-agent voice assignment, supporting all TTS providers including browser-native [#211](/pull/211)
- **Immersive Mode** — Full-screen view with speech bubbles, auto-hide controls, and keyboard navigation [#195](/pull/195) (by @YizukiAme)
- **Discussion buffer-level pause** — Freeze text reveal without aborting the AI stream [#129](/pull/129) (by @YizukiAme)
- **Keyboard shortcuts** — Comprehensive roundtable controls: T/V/Esc/Space/M/S/C [#256](/pull/256) (by @YizukiAme)
- **Whiteboard enhancements** — Pan, zoom, auto-fit [#31](/pull/31), history and auto-save [#40](/pull/40) (by @YizukiAme)
- **New providers** — ElevenLabs TTS [#134](/pull/134) (by @nkmohit), Grok/xAI for LLM, image, and video [#113](/pull/113) (by @KanameMadoka520)
- **Server-side generation** — Media and TTS generation on the server [#75](/pull/75) (by @cosarah)
- **1.25x playback speed** [#131](/pull/131) (by @YizukiAme)
- **OpenClaw integration** — Generate classrooms from Feishu, Slack, Telegram, and 20+ messaging apps [#4](/pull/4) (by @cosarah)
- **Vercel one-click deploy** [#2](/pull/2) (by @cosarah)

### Security

- Fix SSRF and credential forwarding via client-supplied baseUrl [#30](/pull/30) (by @Wing900)
- Use resolved API key in chat route instead of client-sent key [#221](/pull/221)

### Testing

- Add Vitest unit testing infrastructure [#144](/pull/144)
- Add Playwright e2e testing framework [#229](/pull/229)

### New Contributors

@YizukiAme, @nkmohit, @KanameMadoka520, @Wing900, @Bortlesboat, @JokerQianwei, @humingfeng, @tsinglua, @mehulmpt, @ShaojieLiu, @Rowtion
