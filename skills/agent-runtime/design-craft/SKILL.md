---
name: design-craft
title: "专业视觉工艺"
description: |
  Professional visual craft for course pages — typography hierarchy, color discipline, anti-AI-slop, spacing rhythm, and accessibility contrast. Load it when generating or polishing slides, when a page looks cheap or generic, when fixing colors, fonts, crowding, or contrast, or when raising the whole course to a professional standard. Companion to slide-craft (geometry) and pro-editing (procedure) — this one decides what a professional page looks like.
---

# Professional visual craft

You are styling pages inside the KelasKA Stage DSL: canvas **1000 × 562.5**,
**50px margin**, absolute elements (`left/top/width/height`). `slide-craft`
owns geometry; this skill owns taste. When both are loaded, geometry wins on
numbers, this skill wins on visual judgment.

## 1. Anti-AI-slop (never ship these)

- Never use default AI indigo `#6366f1`, `#4f46e5`, `#8b5cf6` as brand color.
- Never use a two-stop purple-to-blue hero gradient.
- Never use emoji as icons. Use text glyphs (`•`, `—`, `→`) or leave air.
- Never use a card with rounded corners + left accent border as the whole design.
- Never invent metrics, quotes, or logos. No lorem ipsum on a delivered page.
- House rule: **80% proven patterns + 20% distinctive choices**. One distinctive
  move per page (a strong title, one accent, one image treatment) — not five.

## 2. Color discipline

- Ratio: neutrals **70–90%**, one accent **5–10%**, semantic (success/warn/danger)
  **0–5%**. The accent may appear at most **2 times per screen**.
- Max **12 hex values** outside the page tokens. Prefer one accent family with
  opacity steps over many hues.
- Dark surfaces: use `#0f0f0f` surfaces with `#f0f0f0` text, never pure
  `#000` on `#fff`. Light surfaces: warm paper `#faf9f7`, ink `#1a1a1a`.
- Contrast: body text **≥ 4.5:1**, large titles **≥ 3:1**. If in doubt, darken
  text before enlarging it.

## 3. Typography hierarchy

- Scale: title **32–36px**, section head **24–28px**, body **16–18px**,
  caption **14px**. Body line-height **1.5–1.6**.
- Max **2 typefaces** and **3 weights** (400 / 500 / 600) per course.
- ALL-CAPS labels must carry `letter-spacing 0.06–0.1em`; Latin display titles
  may use `-0.02em`. Never justify body text; left-align, `max ~65 characters`
  per line (re-derive box height from the `slide-craft` table after rewording).
- One page, one job for type: the title states the point, the body carries
  at most **3 ideas**, captions carry sources. Shorten words before growing boxes.

## 4. Layout rhythm (Swiss grid on the 1000px canvas)

- Columns: left content at `left = 60` or `80`; centered at
  `left = (1000 - width) / 2` (recompute, never guess); right at
  `left = 1000 - width - 60`. A row shares one left edge — 8px off reads as
  a mistake even when nothing overflows.
- Whitespace is the design: prefer one hero element + air over four competing
  boxes. If a page feels crowded, delete before rearranging.
- Order of fix: **shorten words → step type scale → widen box**. A slide that
  needs a bigger box usually needs fewer words.

## 5. Accessibility baseline

- Every image/shape carrying meaning gets adjacent text stating the same point.
- Interactive-adjacent pages (quiz/PBL): state the action in the title
  ("Pilih satu", "Urutkan langkah"), not only in narration.
- Narration (`generate_tts`) must match on-screen wording for numbers, names,
  and steps — re-generate TTS after any text change.

## 6. QA before handoff (with pro-editing)

1. Read the page back via `read_stage` — check spill, contrast, alignment.
2. At most **2 rounds** of `render_scene_preview` look-edit-look; stop when
   professional, not when novel.
3. Close with narration consistency (`generate_tts` after text edits).
