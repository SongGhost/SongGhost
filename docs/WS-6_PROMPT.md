# WS-6: Pavlovian Architecture + Host Studio UI Fixes — Grok Build Prompt

## Context

SongHost just shipped WS-2 (4-persona reconstruction: Standard Broadcast / Warm Companion / Sarcastic Critic / The Musicologist, all 13 OpenAI voices on `gpt-4o-mini-tts`). The live DJ break today is a **single speech clip** per break: the engine generates one script (the `song_intro` kind bundles the lore/commentary and the track announcement together), the orchestrator ducks the incoming track's intro to 18% and plays that one clip over the ducked bed, then restores over 1500ms.

WS-6 has two parts. **Part A** is three low-risk Host Studio UI fixes found during WS-2 testing. **Part B** is the Pavlovian Architecture: split the lore-type break into two sequenced speech clips with an earcon cue, so the listener hears a Pavlovian cue → the DJ's lore → then the ducked track announcement. Do Part A first (low risk, independently testable), then Part B (audio FSM change, higher risk).

## Part A — Host Studio UI Fixes (3 issues)

Three UI surfaces read the same persisted persona/voice state but display it inconsistently. All three live in the Host Studio / player-bar area.

### A1 — Persona display mismatch (player bar vs Host Studio modal)

In Free mode, the player status pill shows "Standard Broadcast" while the Host Studio modal shows the listener's true persisted persona (e.g. "The Musicologist", migrated from a legacy host id). Same persisted state, two different displays. The player bar is not reflecting the actual persisted persona — it is showing the Free default. Fix the player bar so it reflects the same resolved persona the modal shows, OR clamp consistently — but the two surfaces must agree on what is displayed for the same persisted state.

### A2 — Voice name not shown in the player bar (Free mode)

The code comment in `src/components/player/HostBar.tsx` on `resolveHostDisplayName` states the intent: Free mode shows the selected OpenAI **voice** name; Pro mode shows the named **persona**. Today the Free player bar shows the persona name ("Standard Broadcast") plus "Host Unlocked" and omits the voice entirely. Per the documented intent, Free mode should show the selected OpenAI voice name (e.g. "Fable", "Alloy") so the listener can see which of the 13 voices is active without opening the modal. Make the Free player bar show the voice name as the code comment intends. If showing both the persona and the voice reads better, that is acceptable — but the voice name must be visible in Free mode.

### A3 — Pro persona selected in the Host Studio modal while in Free mode

A listener whose persisted `activePersonaId` resolves to a Pro persona (e.g. The Musicologist, migrated from a legacy host) sees that Pro persona shown as the active selection in the Host Studio modal while in Free mode — but they cannot actually use it in Free. The modal should not present a Pro persona as the active/selected choice for a Free user. Either clamp the displayed selection to Standard Broadcast for Free users (and mark the Pro persona as locked/upgrade-required), or clearly indicate the Pro persona is unavailable in Free. Do not silently show a Pro persona as the active selection for a Free listener.

### Part A constraints

- These are display-only fixes. Do not change the persisted persona/voice values, the resolver logic in `src/lib/dj/personaConfig.ts` or `src/lib/dj-resolver.ts`, or the TTS path. Do not regress the migration logic (`LEGACY_PERSONA_ALIASES` / `LEGACY_PERSONA_VOICE`).
- Files likely involved: `src/components/player/HostBar.tsx`, `src/components/player/HostSettingsModal.tsx`. Read them fully before editing. If the clamp logic needs a shared helper, add it next to the existing resolver helpers — do not duplicate.
- Run `npx tsc --noEmit` and `npm run lint` after Part A. Both must pass with zero new errors. Then do Part B.

## Part B — Pavlovian Break Architecture

### The experience to build

For every **lore-type break** (segment kinds `song_intro`, `artist_trivia`, `local_events`), the DJ break becomes two sequenced speech clips with an earcon cue, instead of one clip:

1. **Song A ends** (its outro finishes or fades).
2. **Earcon** plays — a short cue sound that signals commentary is coming. The earcon is selected by the break's sub-kind (see below).
3. **Commentary gap** — a brief beat (recommend ~400–600ms) so the earcon lands cleanly before the DJ speaks.
4. **Lore clip** — the DJ speaks the lore / commentary / fact. This plays in the gap after song A, **not ducked over track B** (track B has not started yet, or song A has ended). This is a separate TTS clip from the announcement.
5. **Track B starts** — its instrumental intro begins. Start track B as the lore clip ends (or with a tiny overlap) so there is no dead air between the lore clip and track B.
6. **Duck track B's intro** to 18% (`DUCK_RATIO`) over 300ms (`DUCK_RAMP_MS`) — the duck begins as the announcement clip starts.
7. **Announcement clip** — the DJ announces track B's name + artist, played over the ducked bed. This is the second TTS clip.
8. **Restore** track B to 100% over 1500ms (`RESTORE_RAMP_MS`) after the announcement clip ends.

For the **session-opening break** (track 1, `isSessionOpening: true`), there is no preceding song A. The sequence is: earcon → commentary gap → lore clip (the welcome/opening lore) → track 1 starts → duck → announcement of track 1 → restore. The opening lore clip plays before track 1 begins.

### What does NOT change

- **Stinger, recap, and up_next breaks stay as today** — single clip, ducked over the incoming track. No earcon, no two-phase split. Only `song_intro`, `artist_trivia`, and `local_events` get the Pavlovian treatment.
- The **duck constants** (`DUCK_RATIO 0.18`, `DUCK_RAMP_MS 300`, `RESTORE_RAMP_MS 1500`, `VOICE_HEADROOM_BOOST 1.35`) in `src/lib/audio/mix-bus.ts` are **not edited**. Use them as-is.
- The **first-song invariant** stands: `sessionOpeningDjRef` is set true only on `stationId` / `queueGeneration` change — never on `videoId` / track advance. Track 1 still receives `full_break` with `kind: "song_intro"` and `isSessionOpening: true`.
- `useStationQueue`, `DirectStreamProvider`, and `performance-commit.ts` are **not touched**.
- The **ChatterPacing** rules and legacy numeric pacing fallback in `src/lib/dj/scheduler.ts` keep their current windows. The Pavlovian treatment applies only when `planDjSegment` returns a lore-type `full_break`; `silent` and `stinger` plans are unchanged.

### Earcon selection

Four earcon files exist and are not yet referenced by any code:
- `public/audio/earcons/lore/open.mp3`
- `public/audio/earcons/weather/open.mp3`
- `public/audio/earcons/concert/open.mp3`
- `public/audio/earcons/teaser/open.mp3` — **NOT used in WS-6** (reserved for WS-4 Roots & Branches). Do not wire it.

The earcon maps to break sub-kind as follows:
- `song_intro` and `artist_trivia` → `public/audio/earcons/lore/open.mp3`
- `local_events` with a weather sub-kind → `public/audio/earcons/weather/open.mp3`
- `local_events` with a concert sub-kind → `public/audio/earcons/concert/open.mp3`

### Weather vs concert sub-kind

Today `local_events` is one `DjSegmentKind` covering both weather and concerts. Add a **sub-kind field** on the segment plan (e.g. `localEventSubkind?: "weather" | "concert"`) so the orchestrator can pick the right earcon. Set this field at the point where the plan decides a `local_events` break is weather vs concert (the data already comes from separate sources — `src/lib/location/weather.ts` for weather, `src/lib/artist-events.ts` for concerts — so the distinction exists in the data layer; surface it onto the plan). Keep `src/types/station.ts` dependency-light (the DJ scheduler imports it; keep `Station` re-exports type-only).

### Script generation: two scripts per lore break

Today the script generator produces one script per break. For lore-type breaks, it must now produce **two scripts**:
1. A **lore script** — the commentary / fact / trivia (no track name/artist announcement).
2. An **announcement script** — the track name + artist introduction (the existing song-intro announcement wording).

This means two TTS API calls per lore break instead of one. Both calls use the persona's `systemPrompt` and `ttsInstructions` as today. Keep the existing word caps (opening ≤45 words, mid-session ≤30 words) split across the two clips so the total spoken time stays in the same lane. Read `src/lib/dj/promptBuilder.ts` and `src/lib/dj/scriptGenerator.ts` fully before changing them; preserve the anti-repetition engine (`lore_facts`, `user_lore_history`) so the lore clip does not repeat recently-used facts.

### Orchestrator FSM

The orchestrator (`src/lib/audio/legacy/webOrchestrator.ts`, `src/lib/audio/legacy/useWebOrchestrator.ts`) must sequence, for a lore-type break: earcon playback → commentary gap → lore clip → track B start → duck → announcement clip → restore. Read the existing `playFreshDjClip` and the Mode A/B/hard-pause scenario logic fully before changing the FSM. The earcon is a short audio file played through the same Web Audio speech context (or a dedicated short buffer source) at voice gain; it is **not** ducked (it plays in the gap, not over music). The lore clip is also **not** ducked (it plays after song A ends). Only the announcement clip ducks track B. Preserve all existing abort/epoch/stale-clip guards — the two-clip sequence must still honor `breakAbortSignal`, `sessionEpoch`, and the late-speech discard logic.

### Part B constraints

- Do **not** edit `src/lib/audio/mix-bus.ts`. Use the exported duck constants.
- Do **not** touch `useStationQueue`, `DirectStreamProvider`, or `performance-commit.ts`.
- Do **not** regress the first-song invariant or the ChatterPacing windows.
- If the earcon file is missing or fails to load, fail **closed**: skip the earcon and proceed to the lore clip. Never block a break on a missing earcon.
- If the second TTS call (announcement) fails, the lore clip should still have played; do not leave the listener in a stuck-ducked state — restore track B.

## Invariants (do not regress — verify each)

1. Duck to 18% over 300ms when the **announcement** clip starts; restore to 100% over 1500ms after it ends. Voice gain uses `VOICE_HEADROOM_BOOST` (1.35×).
2. `sessionOpeningDjRef` set true only on `stationId` / `queueGeneration` change — never on track advance.
3. Track 1 receives `full_break` with `kind: "song_intro"` and `isSessionOpening: true`.
4. `silent` and `stinger` plans force no DJ intro and no earcon.
5. ChatterPacing: `talkative` alternates full_break ↔ stinger; `standard` every 2–4 tracks; `music_focused` every 5–7; `music_only` mutes the host entirely (only case that may skip the opening song_intro).
6. Legacy numeric pacing keeps `minGap = pacing`, `maxGap = pacing + 1`, stinger alternation at pacing 1.

## Process

1. Read every file listed above before editing. Understand the current DJ break FSM, the script generation path, and the duck lifecycle before changing anything.
2. Do Part A first. Run `npx tsc --noEmit` and `npm run lint`. Both pass with zero new errors. Then start Part B.
3. For Part B, change the segment plan type first (add `localEventSubkind`), then the script generator (two scripts), then the orchestrator FSM (sequencing), then earcon playback. Build bottom-up so each layer typechecks before the next.
4. If something in the current code contradicts the experience described here, or a guard would be violated by the two-clip sequence, **stop and ask** — do not silently work around it.
5. Do not introduce new bugs. Do not refactor opportunistically. Surgical changes only.
6. Run `npx tsc --noEmit` and `npm run lint` after Part B. Both must pass with zero new errors.
7. Give a full summary: every file changed, the new two-clip sequence, the earcon selection logic, the sub-kind field, the UI fixes, typecheck/lint results, and anything you could not fully verify (e.g. a full live station session).

## Deliverable

Part A (3 UI fixes) + Part B (Pavlovian two-clip break architecture with earcon cue, commentary gap, lore clip, ducked announcement clip), typecheck + lint passing, and a full summary for review before push.
