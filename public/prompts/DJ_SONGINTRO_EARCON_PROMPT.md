# Step 3 Surgical Fix Execution: Earcon for mid-session song_intro

Execute a strict **Step 3 Surgical Fix** in this **new, clean context window**, based on the confirmed Step 2 alignment.

Canonical docs attached: ARCHITECTURE.md, AUDIO_ORCHESTRATION_SPEC_2.md, WORKFLOW.md, plus the target source files listed below.

---

### SOP Rules
- **SURGICAL EXECUTION**: Modify ONLY the exact files and functions specified below.
- **NO UNRELATED REFACTORS**: do not touch scheduler, dj-intro playback, mix-bus, or promptBuilder. This prompt only changes which breaks get an opening earcon chime.
- **DIRECTIVE-ONLY**: follow the behavioral contract; inspect the live files; do not paste unverified snippets. No pre-written code in this prompt.
- **FAIL-CLOSED PRESERVED**: a missing/unresolvable earcon MUST still skip silently and proceed to the lore clip (`playEarconFailClosed` already does this). Do not change fail-closed behavior.

---

### Confirmed Root Cause Context
- After the lore revival, every **mid-session** voiced break (`song_intro`, `up_next`, `artist_trivia`, `local_events`) runs the Pavlovian sequence: earcon → grounded lore → optional stinger → ducked announcement → ramp.
- `resolveEarconSrc` (`src/lib/dj/earcon.ts:37`) returns `null` for **all** `song_intro` (opener and mid-session), with a now-stale comment ("song_intro is single-clip — never an earcon"). Mid-session `song_intro` is no longer single-clip — it is Pavlovian. So the most common Pavlovian break airs its lore with **no opening chime**, while `artist_trivia` / `up_next` / `local_events` get one. That is the inconsistency to fix.
- The session-**opening** `song_intro` (`isSessionOpening: true`) stays a single-clip templated launch liner and correctly has no earcon — that must not change.

### Affected Files (approved)
- `src/lib/dj/earcon.ts`
- `src/lib/dj/__tests__/earcon.test.ts` (update the existing test to cover the new branch)

---

### Execution Plan

#### Task 1 — Give mid-session song_intro an earcon (earcon)
- **File**: `src/lib/dj/earcon.ts`
- **Target**: `resolveEarconSrc`.
- **Behavior**:
  1. Add `isSessionOpening` to the `Pick<DjSegmentPlan, ...>` the function accepts (the callers already pass the full plan, which carries `isSessionOpening`).
  2. For `kind === "song_intro"`: return `null` only when `isSessionOpening === true` (the session opener stays chime-less). When `isSessionOpening` is false/absent (mid-session), return the same lore earcon the other lore kinds use (`EARCON_LORE`).
  3. Replace the stale comment on the `song_intro` line so it reflects the new behavior: opener = no earcon; mid-session = lore earcon.
  4. Do not change the `local_events` (weather/concert), `roots_teaser`, or `!isLoreSegmentKind` branches. `song_id` is not a lore kind and must continue to get no earcon (it is not handled here today; leave it).

#### Task 2 — Update the earcon test
- **File**: `src/lib/dj/__tests__/earcon.test.ts`
- **Target**: the `resolveEarconSrc` test cases.
- **Behavior**:
  1. Add/adjust cases so: a session-opening `song_intro` plan returns `null`; a mid-session `song_intro` plan (no `isSessionOpening`) returns the lore earcon. Keep the existing `artist_trivia` / `local_events` (weather + concert) / `roots_teaser` / non-lore assertions intact.
  2. Do not weaken any existing assertion.

---

### Verification & Output Requirements
1. **Apply Minimal Diff Modifications**: implement directly; no scaffolding, no unrelated edits.
2. **Earcon coverage**: mid-session `song_intro` now resolves to the lore earcon; session-opening `song_intro` still resolves to `null`; `song_id` and non-lore kinds still get nothing; `local_events` weather/concert and `roots_teaser` unchanged.
3. **Fail-closed intact**: a null/missing earcon still skips silently and proceeds to the lore clip — `playEarconFailClosed` behavior unchanged.
4. **Validation**: `tsc --noEmit` — 0 errors; `eslint` on `src/lib/dj/earcon.ts` and the test file — clean; run `src/lib/dj/__tests__/earcon.test.ts` (Vitest) and confirm all assertions pass.
5. **Step 4 docs**: `docs/ARCHITECTURE.md` and `docs/AUDIO_ORCHESTRATION_SPEC_2.md` already note mid-session `song_intro` earcon as a follow-up. After this fix, update those notes to say the earcon is now wired (remove the "follow-up to wire" caveat). Do not edit docs unless instructed; list them in your report.
