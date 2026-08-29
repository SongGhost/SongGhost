# Step 3 Surgical Fix Execution: DJ Lore Scheduling + Pavlovian Playback Revival

Execute a strict **Step 3 Surgical Fix** in this **new, clean context window**, based on the confirmed Step 2 alignment. This prompt depends on `DJ_LORE_GROUNDING_PROMPT.md` landing first — execute that one before this one.

Canonical docs attached: ARCHITECTURE.md, ROADMAP.md, AUDIO_ORCHESTRATION_SPEC_2.md, WORKFLOW.md, plus the target source files listed below. Do not pull quarantined Spotify / YouTube / MusicKit code unless it is in the approved file list.

---

### SOP Rules
- **SURGICAL EXECUTION**: Modify ONLY the exact files and functions specified below.
- **NO UNRELATED REFACTORS**: do not touch mix-bus constants, queue logic, ROU, or catalog code. This prompt changes WHEN a voiced break fires and HOW it plays, not the duck ratios or the audio graph.
- **DIRECTIVE-ONLY**: follow the behavioral contract; inspect the live files; do not paste unverified snippets. No pre-written code in this prompt — generate native code against the live codebase.
- **INVARIANTS HELD**: Track 1 of a session still always receives a `full_break` `song_intro`; `music_only` is still the only pace that may skip the opening `song_intro`; duck to 18% / restore over 1500ms; voice never sidechained; first-song playback invariant (pause until unlock → seekTo(0) → play → emit once) is untouched.

---

### Confirmed Root Cause Context
- **Most voiced breaks skip the LLM**: `song_intro` breaks are templated canned lines and never call the LLM (`src/lib/dj-intro.ts:196-207`). Only `artist_trivia` and `local_events` get the Pavlovian earcon→lore→announcement path, because `isLoreSegmentKind` is true only for those two (`src/types/dj.ts`). Per the confirmed spec, EVERY mid-session voiced break across all non-Silent paces must run the full Pavlovian sequence (the grounding from Prompt 1 then feeds the lore clip).
- **No stinger slot in the Pavlovian path**: the stinger sweeper only runs in the single-clip path (`src/lib/dj-intro.ts:549-551`); the Pavlovian branch (`:466-518`) has no optional stinger between lore and announcement.
- **Short-intro "always tell me" stays silent**: `canDuckAnnounce` requires an instrumental intro ≥3s (`src/lib/dj/scheduler.ts`); shorter-intro tracks are not announced and get named later in a recap. Per the confirmed spec, short-intro tracks with "always tell me" on should be announced in the pre-song gap, then the song starts at full volume.
- **Silent does not gray Host Studio**: `HostSettingsModal` only disables controls for Pro-lock, not for muted pace (`src/components/player/HostSettingsModal.tsx:449`).
- **UI label drift**: Natural Pace is described as "every 2–3 songs" but the code window is 2–4 (`src/types/dj.ts:154` vs `src/types/station.ts` standard profile minGap 2 / maxGap 4).

### Affected Files (approved)
- `src/lib/dj-intro.ts`
- `src/lib/dj/scheduler.ts`
- `src/types/dj.ts`
- `src/components/player/HostSettingsModal.tsx`
- Doc-sync only (do not edit unless instructed): `.cursor/rules/songhost.mdc`, `docs/ARCHITECTURE.md`

---

### Execution Plan

#### Task 1 — Every mid-session voiced break is Pavlovian (dj-intro)
- **File**: `src/lib/dj-intro.ts`
- **Target**: the `song_intro` early-return templated branch (`:196-207`) and the Pavlovian gate at `:461` (`isLoreSegmentKind`).
- **Behavior**:
  1. Keep the **session-opening** `song_intro` (track 1, `segmentPlan.isSessionOpening === true`) on its existing templated launch-liner path — fast, reliable launch, no LLM call. This preserves the first-song invariant and avoids launch latency.
  2. Route every **mid-session** voiced break — including mid-session `song_intro`, `up_next`, `artist_trivia`, `local_events` — through the Pavlovian earcon → lore (silence) → optional stinger → announcement (over next song ducked to 18%) → ramp sequence that already exists for `artist_trivia`/`local_events`.
  3. The lore clip is fetched from the LLM (now grounded by Prompt 1); the announcement clip stays names-only. The two-clip Pavlovian contract is unchanged; only the set of kinds that enter it expands.
  4. Do not change the duck ratios, the earcon resolution, or the `onLoreComplete` → start-next-song handoff.

#### Task 2 — Optional stinger slot in the Pavlovian path (dj-intro)
- **File**: `src/lib/dj-intro.ts`
- **Target**: the Pavlovian branch (`:466-518`), between lore completion and the announcement.
- **Behavior**:
  1. After the lore clip finishes and before the announcement, add an optional stinger slot driven by the segment plan's stinger flag (the same `includeStinger` / talkative-alternation signal the single-clip path uses).
  2. When the flag is set, play the station-ID stinger sweeper (reuse the existing `playTalkativeStingerSweeper` helper) in the gap before the next song starts. When unset, skip straight to the announcement. Do not double-play stingers across both paths.
  3. Reconcile with the talkative "alternate full_break ↔ stinger" rule: a stinger-only track (no full break) still uses the single-clip path; a full Pavlovian break may carry one optional stinger in its slot. Make sure a track never gets both a standalone stinger sweeper and an in-break stinger.

#### Task 3 — Short-intro "always tell me" pre-song announce (scheduler + dj-intro)
- **Files**: `src/lib/dj/scheduler.ts`, `src/lib/dj-intro.ts`
- **Target**: `canDuckAnnounce` and the duck-announce playback path.
- **Behavior**:
  1. For "always tell me what's playing" ON, split the announce by intro length:
     - **Long intro (≥3s)**: keep current behavior — duck over the intro, announce, ramp.
     - **Short intro (<3s)**: announce in the pre-song gap (templated names-only line, no lore, no LLM call), then start the song at **full volume** with no ducking.
  2. The short-intro announce is names-only (artist + song, varied phrasing) — it is NOT a lore break and must not trigger the Pavlovian LLM path. It reuses the existing templated song-ID line generator.
  3. Do not announce over a vocal entry. The short-intro path exists specifically so the DJ never talks over the singer.
  4. Keep the recap fallback for the case where "always tell me" is OFF — short-intro tracks may still be named in a later recap as today.

#### Task 4 — Expand the lore-kind set (dj types)
- **File**: `src/types/dj.ts`
- **Target**: `isLoreSegmentKind`.
- **Behavior**:
  1. Expand the Pavlovian-eligible set so the scheduler/dj-intro changes in Tasks 1–3 type-check: mid-session `song_intro` and `up_next` are now lore-bearing when they are voiced breaks. Preserve the session-opening `song_intro` exception at the call site (dj-intro), not by excluding the kind here — `isLoreSegmentKind` should reflect "this kind can carry lore," and dj-intro keeps the session-opener on the templated path regardless.
  2. Fix the Natural Pace description string drift: change "every 2–3 songs" to "every 2–4 songs" so the UI label matches the actual `standard` profile window (minGap 2 / maxGap 4). Do not change the window itself — only the description string.

#### Task 5 — Pass catalog IDs into the lore script request (dj-intro)
- **File**: `src/lib/dj-intro.ts`
- **Target**: the lore script request builder (`fetchDjScript` for `scriptPhase === "lore"`).
- **Behavior**:
  1. Send the current track's `artistId`, `trackId`, and `albumId` (whichever are available on the track object) into the lore script request payload, so `/api/generate-script` can ground the lore clip with a fact matching the actual artist/track instead of falling back to the broadest "any unserved fact" bucket.
  2. The YouTube dial path currently sends none of these ids — that is the gap this task closes. Pass whatever catalog ids the current track carries; do not fabricate ids when they are absent (the route already handles missing ids by widening the lookup).
  3. Do not change the announcement-clip request payload. Do not change the lore-cache path (it already sends `trackId`).
  4. If the YouTube track object genuinely carries no catalog ids (videoId-only tracks), leave the lookup to widen to "any unserved" — that is acceptable and safe, and is a separate catalog-linkage concern, not a defect in this change.

#### Task 6 — Gray Host Studio on Silent (HostSettingsModal)
- **File**: `src/components/player/HostSettingsModal.tsx`
- **Target**: the controls' disabled/visual state.
- **Behavior**:
  1. When the resolved DJ pace is `silent` (`no_dj`), render all Host Studio DJ controls (commentary format, trivia density, always-announce, persona, etc.) in a visually inactive / grayed state and non-interactive, with an explanatory hint that the host is muted.
  2. The pace selector itself stays interactive (so the user can switch away from Silent). Only the dependent DJ controls gray out.
  3. Reuse the existing locked/disabled visual pattern already in the file; do not introduce a new styling system.

---

### Verification & Output Requirements
1. **Apply Minimal Diff Modifications**: implement directly; no scaffolding, no unrelated edits.
2. **Invariant checks**: Track 1 still gets a `full_break` `song_intro` (templated launch liner, no LLM); `music_only` still skips the opener; duck 18% / restore 1500ms unchanged; first-song playback invariant intact.
3. **Pavlovian coverage**: a mid-session voiced break on Every Song / Natural / Long Breaks runs earcon → grounded lore (silence) → optional stinger → announcement (ducked) → ramp. A session-opening break stays templated.
4. **Short-intro announce**: with "always tell me" ON, a <3s-intro track is announced in the gap then played at full volume (no duck, no talk-over-vocal); a ≥3s-intro track still ducks-and-announces.
5. **Silent graying**: pace = Silent grays all dependent DJ controls; the pace selector remains usable.
6. **Label**: Natural Pace description now reads "every 2–4 songs".
7. **Validation**: `tsc --noEmit` — 0 errors; `eslint` on touched files — clean; run `src/lib/dj/__tests__` suites (scheduler, dj-script, promptBuilder) and confirm no regressions.
8. **Step 4 docs**: name `.cursor/rules/songghost.mdc` and `docs/ARCHITECTURE.md` for sync (Pavlovian-for-all-voiced-breaks, stinger slot, short-intro announce, Silent graying, label fix). Do not edit docs unless instructed; list them in your report.
