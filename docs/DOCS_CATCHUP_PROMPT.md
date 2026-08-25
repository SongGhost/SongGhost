# Docs Catch-Up: ARCHITECTURE / ROADMAP / AUDIO_ORCHESTRATION_SPEC_2 — Grok Build Prompt

## Context

Three code docs are stale and need to be brought current through WS-6. Per the §14 model roles, you own these docs. WS-1 (OpenAI 13-voice catalog swap, `gpt-4o-mini-tts`, ElevenLabs mothballed from the live dial), WS-2 (4-persona reconstruction: Standard Broadcast / Warm Companion / Sarcastic Critic / The Musicologist; `DjPersonality` + `DjMood` removed; Pro tier reintroduced for host personality), and WS-6 (Pavlovian two-clip break architecture + Host Studio display fixes) have all shipped but are not reflected in these docs.

This is a **documentation-only** task. Do not change any code. Read the shipped code to ground the docs in what actually exists.

## Task

Update these three docs to reflect the shipped state. Read the relevant source first so the docs match the code, not assumptions.

### 1. `docs/ARCHITECTURE.md`

Document the current host/voice/persona architecture as it now exists:
- The live dial is **3 independent axes**: Voice (all 13 OpenAI voices, never gated), Persona (Standard Broadcast Free; Warm Companion / Sarcastic Critic / The Musicologist Pro), Vernacular (WS-3, not yet built).
- TTS model is `gpt-4o-mini-tts` with the `instructions` parameter (steerable prosody). 2000-char input limit via `assertOpenAiTtsInputLength`.
- ElevenLabs is mothballed from the live dial (`ttsProvider` hardcoded `"openai"` on the live path in `src/app/page.tsx`); kept in-tree for admin-only WS-7 Director's Cut pre-renders.
- The 4 personas are defined in `src/data/personas.ts`, each with `systemPrompt` (LLM) + `ttsInstructions` (TTS delivery). Migration: `LEGACY_PERSONA_ALIASES` maps old host ids → new personas; `LEGACY_PERSONA_VOICE` is the fallback voice only; the listener's stored `preferredVoice` is never rewritten.
- `DjPersonality` and `DjMood` are removed; `DjTuningSettings` is now `pace` + `knowledge` only.
- Visualizer palettes mapped to the 4 personas (`src/lib/visuals/theme-palette.ts`); Standard Broadcast = Studio Amber.

### 2. `docs/ROADMAP.md`

Add a workstream status section reflecting what shipped and what remains. Use this state:
- **WS-1 — OpenAI voice catalog swap** — DONE (shipped Aug 25 2026).
- **WS-2 — Persona reconstruction (4 personas)** — DONE (shipped Aug 25 2026).
- **WS-2.1 — ProUpgradeModal copy fix** — DONE (shipped Aug 25 2026).
- **WS-6 — Pavlovian two-clip break architecture + Host Studio display fixes** — DONE (shipped Aug 25 2026).
- **WS-3 — Genre Vernacular** — NEXT (not started).
- **WS-4 — Roots & Branches Pro Teaser** — not started (uses `teaser/open.mp3` earcon, reserved in WS-6).
- **WS-5 — Host Studio Vibe Chips** — not started.
- **WS-7 — Admin Director's Cut tool (ElevenLabs pre-rendered R2 documentaries)** — not started.

### 3. `docs/AUDIO_ORCHESTRATION_SPEC_2.md`

Document the Pavlovian two-clip break as the new lore-type break FSM. This is the most important of the three — it's the audio FSM spec and the Pavlovian change is a major FSM change. Cover:
- **Lore-type breaks** (`song_intro`, `artist_trivia`, `local_events`) now run a two-clip sequence: earcon → ~500ms commentary gap → lore clip (spoken in the gap after song A, not ducked) → track B starts → duck to 18% (`DUCK_RATIO`) over 300ms (`DUCK_RAMP_MS`) → announcement clip (track name + artist over the ducked bed) → restore to 100% over 1500ms (`RESTORE_RAMP_MS`).
- **Stinger, recap, up_next stay single-clip**, ducked over the incoming track. No earcon.
- **Earcon selection** (`src/lib/dj/earcon.ts`): `lore/open` for song_intro/artist_trivia; `weather/open` vs `concert/open` for local_events via `DjSegmentPlan.localEventSubkind` (`"weather" | "concert"`). `teaser/open.mp3` is reserved for WS-4 and not wired.
- **Session opener** (track 1, `isSessionOpening: true`): welcome lore plays before the track, then the track starts, ducks, and the announcement fires. `sessionOpeningDjRef` is still armed only on `stationId` / `queueGeneration` change — never on track advance.
- **Two TTS calls** per lore break; word caps split (opening lore ≤32 + announcement ≤13; mid-session lore ≤20 + announcement ≤13). Anti-repetition (`excludedFacts` / `user_lore_history`) stays on the lore clip.
- **Fail-closed guarantees**: missing/unloadable earcon skips to the lore clip (never blocks a break); a failed announcement clip restores track B so the listener is never left in a ducked state.
- **Orchestrator entry point**: `runPavlovianTransition` in `src/lib/audio/legacy/webOrchestrator.ts`; no-lore-URL falls back to the legacy single-clip `runModeATransition`.
- **Pre-existing inconsistency to note**: the companion (DirectStream / iTunes preview) announcement path uses Mode A's 600ms duck ramp / 800ms swell, not the SOP 300ms / 1500ms. The YouTube live dial uses mix-bus 300/1500 (correct). Aligning the companion path is a follow-up.
- **Unchanged invariants**: `mix-bus.ts` duck constants (18% / 300ms / 1500ms / 1.35× headroom), `useStationQueue`, `DirectStreamProvider`, `performance-commit.ts`, ChatterPacing windows, first-song invariant.

## Process

1. Read the shipped source for each claim before writing it into the docs — do not document from memory. Key files: `src/data/personas.ts`, `src/types/dj.ts`, `src/lib/dj/earcon.ts`, `src/lib/dj-intro.ts`, `src/lib/audio/legacy/webOrchestrator.ts`, `src/lib/audio/mix-bus.ts`, `src/components/player/HostBar.tsx`, `src/app/page.tsx`.
2. Match the existing tone and structure of each doc. Do not reformat or restructure beyond what the new content requires.
3. Surgical additions only — do not delete or rewrite existing content that is still accurate.
4. If you find existing doc content that is now factually wrong (e.g. references to the 6 named hosts, ElevenLabs on the live dial, `DjMood`), correct those specific lines.
5. Run `npx tsc --noEmit` and `npm run lint` — both must still pass (docs-only change, but confirm nothing broke).
6. Give a full summary: which doc, which sections added/corrected, and the exact stale references you fixed.

## Deliverable

Three updated docs (`ARCHITECTURE.md`, `ROADMAP.md`, `AUDIO_ORCHESTRATION_SPEC_2.md`) current through WS-6, typecheck + lint still passing, and a full summary for review before push.
