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

**The recorded Kontakt loops cannot be carried forward** (Paul, 2026-10-16). Any new version needs its own sound source: generated from Eddy's engine through samples with clear licensing. Eddy's sample set has mixed sources (see `/Users/paulczech/note-threader/CREDITS.md`) — audit each for redistribution-in-an-app before shipping Drift commercially; Paul's own recordings are the safest: Yindad Acoustic and the retro pad (a Logic RetroSynth patch printed to audio; 24MB, would need trimming). Corrected 2026-10-16: *Ultra Ambient Pad is not Paul's* — it's Julian Morgan's, via Pianobook (royalty-free for use in music, but shipping the files inside an app is redistribution; unverified). Others: Moog Minitaur Saw is CC0, VSCO2 upright piano explicitly allows redistribution, choir pad is CC Sampling Plus 1.0 (restrictions apply).

## Direction (agreed in principle, nothing built yet)

1. ~~**Fix-up pass**~~ — done 2026-10-16 (see Known issues; End-Drift fade bug #8 still to do).
2. **Generative prototype** (the big bet): replace loops with harmony generated by Eddy's voice-leading engine.
   - Valence → mode brightness ladder (Locrian/Phrygian … Aeolian, Dorian, Mixolydian, Ionian, Lydian). Arousal → tempo, density, register, voicing openness.
   - **A→B transitions are real voice leading** (one voice at a time through the modes), not a volume crossfade — the music literally drifts.
   - A 2D valence/arousal mood pad can replace the 21-word dropdown (continuous, no assets).
3. **The journey** (the product hook): "where I am" → "where I'd like to be" over 5/10/20 minutes (the music-therapy *iso principle*: start matched, then move gently). Frame as a listening experience; **no health claims**.
4. Later: audio-reactive visuals, seeded shareable links, 60s capture for sharing, ambient/display mode, time-of-day/HealthKit inputs, sleep timer.
5. Eddy bridge, down the road: a mood→channel (scale) chooser inside Eddy for beginners; export a Drift arc as MIDI via Eddy's exporter.

**Product questions Paul raised 2026-10-16 (after hearing the first renders — "they sound good") and where we landed:**
- *Journey length is user-set* — yes. `composeJourney` already takes seconds; presets 1/5/10/20 min plus a floor of ~20s. Short journeys need `beat` scaled to the length (a 30s walk of 5 flips can't wait 6s between moves).
- *Instrument/voicing selector* — yes, later. The composer is instrument-agnostic (note events), but each instrument needs its own articulation (the 5.5s re-articulation chain is pad-specific; plucked/piano need re-strikes or arpeggiation) and its own licence audit. Ship the pad first; add 1–2 more pad-like voices before any plucked ones.
- *Truly generative each time* — yes, already: the voice path is random per run (`Math.random`), seedable for shareable/reproducible runs. Honest limit: the mode, tonic (D), colour tone and register are fixed by the mood, so "happy" is always recognisably the same colour with a different path. More variety later from arousal (tempo/density/register), other roots, voicing choices.
- *Timeline / film-score use* — plausible and the architecture is the right shape: a journey is a list of keyframes `{time, mood}`; the ladder walk runs between consecutive keyframes, and arousal can be a second lane. Needs: planning backward so a mode is *reached* by the keyframe time, shorter beats for fast changes, and honest limits (2s attack/3s release smears hard cuts — fine for ambient underscore, not for hits on a cut). Offline WAV render already exists (`scripts/render`); MIDI export would come via Eddy's exporter. It's a different audience (editors/filmmakers: deterministic, editable, stems/MIDI, royalty-free from Paul's own samples) — park as a later product line, but **keep the composer's data model keyframe-shaped** so the two-point journey is just the simplest case. No UI until the listening experience is solid.

**To discuss at the appropriate time — dissonance control (Paul, 2026-10-16):** a darker starting emotion (e.g. Locrian) is likely dissonant; Paul wants a control that raises/lowers dissonance *within limits* so the mode's character survives and it stays listenable. Claude's first take: feasible, and measurable. The mode is only the coarse lever — dissonance also lives in the voicing and the moves. Fine levers we already have or can add: score candidates with Eddy's `clusterDissonance` and bias the stream toward/away from them; weight of the colour tone (`COLOR_INTERVAL`); voicing openness / spacing rule (`minGap`); voice count (3 vs 4); register; the reverb wet. Guard rails to enforce and test: colour tone still sounding ≥ ~60% of the time at every setting (character), a hard cap on adjacent-semitone/tritone clusters (listenability), monotonic mean dissonance vs. the control. Caveat found in the stats: with the current stream, mean `clusterDissonance` is ~4.2–4.6 in *every* mode including Locrian — the spacing rule and tonic/colour bias already keep it tame, so the metric/range must be calibrated first (does Locrian even sound harsh yet?). Not started.

Competitive context: Endel and Calm own generative ambient. Differentiators here: truly voice-led harmony, the explicit A→B journey, restrained design.

## Generative prototype — status (branch `generative`, started 2026-10-16)

**Decisions (Paul, 2026-10-16):** build on branch `generative`, loops stay live on `main` until Paul prefers the new engine; sound = **retro pad** (Paul's own Logic RetroSynth recording; he'll swap the source if testing says so); **one tonal centre per drift, D by default** — `tonic` (pitch class 0–11) is now a parameter of the engine and composer (2026-10-16; the register window moves with the root, so every key plays the same shape of music; tested on all 12 tonics: 126k stream steps, 0 out of mode/window; 7.5k transitions, 0 failures). Plan: the app picks the tonic (random/seeded per drift), no user picker by default — restraint; a manual key can live behind a share link/advanced setting. Later idea: on long journeys, let the tonic itself drift by fifths. keep the 21 words as the input for v1, each mapped to a hidden valence/arousal pair so a 2D pad can replace them later without touching the engine.

**What exists (engine + live playback wired, built 2026-10-16):**
- `src/engine/eddy/` — copies of Eddy's `notes`, `scales`, `strategies`, `noteUtils`, `useVoiceLeading` (→ `voiceLeading.ts`). Two small edits to `voiceLeading.ts`: `options.bounds` (register window) and `options.maxCandidates` (callers that filter further need the full pool, not Eddy's sample of 6).
- `src/engine/drift.ts` — `DriftEngine`. `LADDER` = Lydian, Ionian, Mixolydian, Dorian, Aeolian, Phrygian, Locrian — all parallel modes on D, so adjacent rungs differ by ONE degree, one semitone. `step()` = one voice moves one step inside the mode, using Eddy's `generateCandidates` with the key lock on and only the gentle one-voice strategies (`GENTLE`). `shift(±1)` = move one rung: voices holding the changed pitch class follow it by a semitone (our own, not Eddy's — Eddy's strategy machinery isn't the right shape for it). Stream bias (`choose`): newly-introduced degrees first (`pending`), then keep the mode's colour tone (`COLOR_PC`) and the tonic D, with 1-in-6 free choice so nothing is pinned. Spacing rule: open at the bottom (≥ fourth below G3, ≥ minor third below C4).
- `src/engine/moods.ts` — the 21 words → (valence, arousal); `rungFor(valence)` maps to Lydian…Phrygian (Locrian unmapped: its tonic chord is diminished and reads tense, not low). First-draft values, tune by ear.
- `src/engine/compose.ts` — `composeTimeline({waypoints:[{rung,hold}…], walk, tonic?, beat?, rng?})` → `{events:{time,note,hold}[], marks, duration}`: settle at a mode for `hold`s, walk the ladder to the next waypoint over `walk`s (one value or one per gap). `composeJourney({from,to,holdA,shiftSeconds,holdB,…})` is the two-point wrapper. While walking, the harmonic beat speeds up so each flip can be followed (floor 2s, the pad's attack). A film cue is just more waypoints; a helper to turn absolute `{time, mood}` keyframes into waypoints is still to write. Pure and deterministic for a given rng (seedable links later). Pad samples are 8s, so sustained voices are re-articulated in overlapping links (every ~5.5s, 2s attack / 3s release), and a voice that moves hands over to its new note the same way (legato crossfade).
- `public/samples/retro-pad/*.mp3` — Eddy's 12 retro-pad WAVs (24MB) converted to 160k MP3 (1.9MB), untrimmed, 8s each, every major third E2–C6; Tone.Sampler pitch-shifts between. Pitch verified by FFT (strongest partial at 2× expected fundamental, within ~10 cents — the patch is second-harmonic-heavy; no octave/semitone error).

**Measured (throwaway scripts, 2026-10-16):** stream — 100% of notes in-mode, max step 2 semitones, never stuck (after retry-with-forgetting), register 48–76. Transitions over all 42 ordered rung pairs × 200 trials: 0 strays at the end, 0 octave collisions, largest single move 1 semitone. Roughly half of rung flips move no voice (the changed degree isn't in the cluster), so `pending` makes the stream introduce it: median 1–3 steps, p90 ≤ 6. Colour tone sounding 40–62% → 79–92% of the time, tonic 58–64% → 81–87%, with distinct chords per 100 steps 82 → 66 (voices still wander). Rendered journeys: no dropouts, RMS steady, chroma moves from the first mode's degrees to the second's (e.g. Eb 23% in the Phrygian opening, G# 25% in the Lydian ending).

**Live playback (built, verified headless; not yet judged by ear in the browser):** `npm run dev` now plays the generative engine; `?engine=loops` plays the original loops for A/B. `App.vue` holds `emotions: string[]` (any number, journey order), `position` (fractional index along them) and `textIndex`; the UI offers 1–2 emotions for now (multiselect cap) but nothing downstream assumes two. `GenerativePlayer.vue` (renderless): dynamic-imports Tone, loads the retro-pad Sampler (attack 2s / release 3s) → Reverb(8s, wet .35) → master gain (0.5), pulls events from a `Composer` stream and queues them ~90s ahead on the audio clock (hidden tabs throttle timers), and every 250ms emits `progress(position, textIndex)` from `positionAt`/`textIndexAt` (compose.ts). Journey shape: 1/5 of the chosen length held at A, 3/5 walking, then B forever until End Drift; length chosen with a 1/5/10/20 min selector that appears only with two emotions. Tonic and seed are random per drift (logged via `console.info('drift', …)` for reproduction). Backgrounds: layer 0 opaque, layer i fades in over layer i−1 as `position` passes i−1 → no resting-gradient bleed-through and it generalises to N emotions; text crossfades (6s) at each walk's midpoint. Tone is now a separate chunk (main bundle 340KB → 100KB). `Composer` is deterministic per seed and independent of how it is chunked (Eddy's two `Math.random` calls now take the seeded rng). **Progress indicator: deliberately open** — Paul wants to keep the idea alive; how it appears is a design discussion (nothing shown for now).
Verified live in headless Chromium (1-min sad→happy): layer B ramps over the walk, text switches at its midpoint, audio steady with no dropouts after the 3s fade-in, chroma moves from Phrygian (♭2 20%) to major (♭2 4%, leading tone 31%), End Drift fades the audio over ~3s; also single emotion, End during loading, restart within the fade, and the loops fallback. Known quirk: two emotions that map to the same mode (e.g. happy/cheerful) get a visual/text journey but no harmonic one until arousal differentiates them.

**Known limits / next:** (1) *Not yet judged by ear* — Paul listens to `renders/*.wav`. (2) Chords often have no third (open voicings + tonic/colour bias) — a major/minor third as a second anchor may be needed. (3) Arousal is not wired in yet (tempo/beat, density, register). (4) ~~Live playback + clock wiring~~ done (see above). (5) Mid-transition notes outside the *source* mode are intentional (that's the drift).

**Rendering (offline WAV for listening):** `npm i --no-save playwright-core` (a later plain `npm install` prunes it — reinstall), then `node scripts/render/run.mjs journeys '[["name",{"from":5,"to":1,"holdA":40,"shiftSeconds":40,"holdB":40,"seed":7}]]'` (rungs are LADDER indices) or `timelines '[["film",{"waypoints":[{"rung":5,"hold":6},{"rung":3,"hold":4},{"rung":0,"hold":6}],"walk":[6,8],"tonic":2,"seed":3}]]'` or `... pitch`. Writes normalised WAVs to `renders/` (gitignored). Runs the real composer + Tone.Sampler + reverb through `Tone.Offline` in headless Chromium. If it fails with `window.renderJourney is not a function`, a stale server holds port 4175.

## Eddy modules to port for the prototype (copy first, extract a shared package only when the Eddy integration is real)

*Update 2026-10-16: `scales`, `strategies`, `noteUtils`, `notes` and `useVoiceLeading` are ported (see status above). `arpeggioEngine` and `useAudioEngine` are deliberately not: the pad only plays chords, and Drift's own sampler chain is ~100 lines.*

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
