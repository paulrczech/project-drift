# Drift — Claude Context

## What this is

An ambient emotional listening experience. Today (v0, built 2025): pick 1–2 of 21 emotion words → two ~20s recorded chord loops crossfade through reverb/delay while a breathing gradient and a short line of text fade in and out. Live at https://project-drift.netlify.app/ (Netlify, `public/_redirects`).

Status: **personal portfolio piece, with the intent to grow into a standalone product** and, down the road, integrate with Eddy (the sibling app, `/Users/paulczech/note-threader` — a voice-leading tool for songwriters). Drift is the *listener* side of the same idea: Eddy lets a composer move voices by hand; Drift lets a listener move through feelings and the harmony follows.

## Stack

Vue 3 `<script setup>` + TypeScript, Vite, Tone.js 15, vue-multiselect (the redundant unpkg `<script>` tag is gone). No backend, no router, no store (state lives in `App.vue`). ~860 lines total.

## Current code map

- `src/App.vue` — all state; `handleSubmit()` builds A/B profiles in pick order; `crossfadeInterval = 16000` ms sets the cycle, and `activeSide`/`fadeSeconds` (set by `AudioPlayer`'s `fade` event) drive text and visuals.
- `src/components/EmotionSelector.vue` — multiselect (max 2), start/end buttons.
- `src/components/AudioPlayer.vue` — two `Tone.Player` loops synced to Transport, `Tone.CrossFade`, reverb (decay 8, wet 0.9) + feedback delay; a `Tone.Loop` flips the crossfade every period (30% fade / 70% solo) and emits `fade` at each fade start — the app's single clock.
- `src/components/BreathingBackground.vue` — idle + A + B gradient layers from `emotionPalettes`; wrapper fades A↔B, inner layer runs the CSS "breathe" keyframes (which animate opacity — hence the wrapper).
- `src/components/EmotionalSnippet.vue` — two `<p>` crossfading on `activeSide`; a single emotion keeps A on screen.
- `src/data/EmotionConfig.ts` — 21 profiles: label, 2 sample files, snippet. `src/data/EmotionGradient.ts` — 3-color palettes.
- `public/sounds/*.mp3` — 42 loops (20MB), recorded by Paul in Logic with a Kontakt library.

## Known issues (found in the 2026-10-16 review; status after the same-day fix-up pass)

**Fixed in the fix-up pass (uncommitted until Paul says so):**
1. ~~Second emotion's background never shows~~ — `BreathingBackground` now stacks idle/A/B layers and fades A↔B. The dead `background`/`tempoHint` config fields are removed.
2. ~~Order mismatch~~ — `App.vue` builds A/B in the user's pick order.
3. ~~Three unsynchronized clocks~~ — the Tone Transport loop is the clock. `AudioPlayer` emits `fade(to, seconds)` via `Tone.getDraw().schedule` at each fade start; `App.vue` holds `activeSide`/`fadeSeconds`; text and visuals only react to that. Verified in headless Chromium: text and layer opacities track identically, period exactly 16s.
4. ~~4s cycle~~ — `crossfadeInterval` is now 16000 ms (11.2s solo / 4.8s fade). One constant in `App.vue`.
7. (partial) `playerOffset` and the unpkg `<script>` tag are removed; `tempoHint`/`background` removed. Quote licensing is still open.

**Still open:**
5. **Thin variety:** 2 loops per emotion, ~20s, repeat forever. (Correction: the loops are *not* loaded eagerly — only the selected emotions' two files are fetched; the 20MB sits in `public/` untouched. "Lazy-load" was a non-issue for audio; Tone.js itself is still in the main bundle, ~340KB.)
6. **Harmonic clashes:** automated chroma analysis (indicative, not exact) puts the 42 loops in ~13 different keys, and both players always run (only the gain crossfades), so mid-fade two unrelated keys sound together (e.g. D major + D# minor). The mood→mode mapping is also unsystematic (sad-1 reads C major, happy-1 E minor). Goes away with the generative prototype.
7. (remaining) Quotes in `EmotionConfig.ts` look like Tao Te Ching translations — **check licensing before any public/commercial release**.
8. ~~End Drift cuts audio and can throw~~ — fixed. `App.vue` keeps `AudioPlayer` mounted for the 3s fade (`audioActive`, remounted per `session` key); `AudioPlayer` has a `halted` flag so an End during loading never starts audio, and clamps the mid-ramp `gain.value` read (it can come back ~-4e-16, which Tone rejects — seen once, not deterministic). Verified with an AnalyserNode tap on the destination: output decays over ~3s after End, stays silent if End lands during loading, and a restart within the fade plays; 10 End timings (0–2000ms) threw no errors.
9. **Contrast:** white snippet text on light palettes (e.g. happy's pale yellow) is weak. Needs a design discussion (text colour per palette vs. a subtle scrim).

10. **Background flicker — fix applied, awaiting Paul's confirmation in Chrome.** Only Chrome; Paul's Loom screenshot showed rectangular tiles of the wrong colour plus bare white — unrasterized tiles, with the idle gradient showing through. Cause: the `breathe` keyframes animated `background-position`, forcing a repaint of three viewport-sized gradients (scaled to 4×) every frame. Measured with a Chrome trace over a steady 4s window (headless can't show the flicker itself, but does show the load): **960 Paint / 11,146 RasterTask events → 0 / 0**. Fix: keyframes now animate only `transform` and `opacity` (the old centre drift became a small `translate`), background-position is static, `will-change: transform, opacity` on the inner layers. Look compared old vs new at 0/3/6s of the cycle: near-identical, slightly less centre drift at the peak. If flicker persists on Paul's machine, next suspect: mid-crossfade A and B are both partly transparent so the idle gradient bleeds through — make B fade over an opaque A.
11. **Loop seam (deferred)** — the recorded loops don't loop seamlessly (Paul). Not worth fixing; the loops go away with the generative prototype.

## Hard constraint

**The recorded Kontakt loops cannot be carried forward** (Paul, 2026-10-16). Any new version needs its own sound source: generated from Eddy's engine through samples with clear licensing. Eddy's sample set has mixed sources (see `/Users/paulczech/note-threader/CREDITS.md`) — audit each for redistribution-in-an-app before shipping Drift commercially; Paul's own recordings (Yindad Acoustic, Ultra Ambient Pad) are the safest.

## Direction (agreed in principle, nothing built yet)

1. ~~**Fix-up pass**~~ — done 2026-10-16 (see Known issues; End-Drift fade bug #8 still to do).
2. **Generative prototype** (the big bet): replace loops with harmony generated by Eddy's voice-leading engine.
   - Valence → mode brightness ladder (Locrian/Phrygian … Aeolian, Dorian, Mixolydian, Ionian, Lydian). Arousal → tempo, density, register, voicing openness.
   - **A→B transitions are real voice leading** (one voice at a time through the modes), not a volume crossfade — the music literally drifts.
   - A 2D valence/arousal mood pad can replace the 21-word dropdown (continuous, no assets).
3. **The journey** (the product hook): "where I am" → "where I'd like to be" over 5/10/20 minutes (the music-therapy *iso principle*: start matched, then move gently). Frame as a listening experience; **no health claims**.
4. Later: audio-reactive visuals, seeded shareable links, 60s capture for sharing, ambient/display mode, time-of-day/HealthKit inputs, sleep timer.
5. Eddy bridge, down the road: a mood→channel (scale) chooser inside Eddy for beginners; export a Drift arc as MIDI via Eddy's exporter.

Competitive context: Endel and Calm own generative ambient. Differentiators here: truly voice-led harmony, the explicit A→B journey, restrained design.

## Eddy modules to port for the prototype (copy first, extract a shared package only when the Eddy integration is real)

All framework-free in `/Users/paulczech/note-threader/src/`:
- `data/scales.ts` — 18 scale/mode definitions + `getScaleNotes()` (every mode on the brightness ladder already exists)
- `composables/useVoiceLeading.ts` — `generateCandidates()` (strategies, key-locked movement, "settle" pulling strays back in)
- `data/strategies.ts`, `utils/noteUtils.ts`, `data/notes.ts`
- `utils/arpeggioEngine.ts` — note scheduling shared by playback and export
- Sound: `composables/useAudioEngine.ts` (Tone.Sampler chains, reverb sends, AutoFilter) — read, don't copy wholesale; it carries iOS-specific AudioContext recovery logic Drift may or may not need.
- Eddy's own design lessons live in its CLAUDE.md (seed voicing rules, strict key lock).

## Working style (same collaborator as Eddy)

**Role.** Claude is the senior architect, developer and music-technology partner — a full creative and technical collaborator, not just an executor. Authority to push back, flag problems before they become bugs, and make architectural calls. Paul has the final say, but Claude's judgment is actively valued: when asked "what do you think?", give a clear recommendation with reasoning, no hedging. Paul is the creative lead.

**Creative lens.**
- Think about the music as well as the code.
- Taoist, minimalist orientation: wu-wei, negative space, the beauty of what's left out. The best solution often removes friction rather than adding cleverness.
- What the app doesn't do matters as much as what it does. Complexity hidden, not eliminated.
- The listener should never have to think so hard they stop *listening*.
- Attend to where things are going, not novelty for its own sake. Community-minded; willing to try exotic solutions when conventional ones are merely adequate.

**How we work.**
- Direct and concise. Lead with the answer or the action; no padding, preamble or trailing summaries. Show or do instead of lecturing. Paul moves fast and dislikes talky, setup-heavy explanations.
- Discuss before implementing anything non-trivial, especially UI and copy: present options or a plan and wait for approval. Small fixes (typos, constants, one-liners) — just do them.
- Surgical edits over rewrites. Read and understand the code before suggesting changes.

**Verification.**
- Use real diagnostic tooling proactively: throwaway scripts for engine statistics, headless Chromium (playwright-core) for UI, screenshots. No blind fixes.
- Reproduce a bug before fixing it; measure before and after.
- Confirm on a real device where it matters (iOS/Safari audio especially) — desktop headless results aren't always the same, and headless can't judge how audio *sounds*.
- Report honestly when something can't be reproduced or a fix didn't work.

**Models and effort.** If a different model or effort level would suit a task better, say so — Paul switches it; Claude can't.

**Git and builds.**
- Commit and push only when Paul asks. Clear prefixed messages (`feature:`, `fix:`, `revert:`, `chore:`) that read like short design notes.
- If Paul says revert something, revert it and don't re-attempt it unprompted.
- Deploys are Netlify from the repo; Paul runs any release steps himself (on Eddy that means Xcode / App Store Connect / TestFlight). Claude's part is the code and verifying builds (`npm run build` runs `vue-tsc`).

**Context handoff.** Claude's memory doesn't carry between projects or sessions. This file is the source of truth — update it as decisions are made.
