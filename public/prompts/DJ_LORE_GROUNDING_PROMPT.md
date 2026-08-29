# Step 3 Surgical Fix Execution: DJ Lore Grounding + Commentary Style Revival

Execute a strict **Step 3 Surgical Fix** in this **new, clean context window**, based on the confirmed Step 2 alignment.

Canonical docs attached: ARCHITECTURE.md, ROADMAP.md, AUDIO_ORCHESTRATION_SPEC_2.md, WORKFLOW.md, plus the target source files listed below. Do not pull quarantined Spotify / YouTube / MusicKit code unless it is in the approved file list.

---

### SOP Rules
- **SURGICAL EXECUTION**: Modify ONLY the exact files and functions specified in the execution plan below.
- **NO UNRELATED REFACTORS**: Do not touch adjacent code, clean up unrelated styling, or modify unapproved hooks. Do not change WHEN breaks fire or HOW they play — that is a separate prompt. This prompt only changes WHAT the LLM is told on a lore break.
- **DIRECTIVE-ONLY**: Follow the behavioral contract; inspect the live files; do not paste unverified snippets from a prior chat. No pre-written code in this prompt — generate native code against the live codebase.
- **NO HALLUCINATIONS (north star)**: Every lore clip the DJ speaks must be grounded in a verified fact from the `lore_facts` table when one is available. When none is available, the clip falls back to non-factual commentary (vibe / production / chart context) and MUST NOT invent biographical or recording anecdotes.

---

### Confirmed Root Cause Context
- **The hallucination gap**: The `lore_facts` table (`src/lib/db/schema.ts:157-166`) is keyed by `artistId` / `albumId` / `trackId` with `factText` and `category`, but is used **only for exclusion** (anti-repetition) via `getExcludedFactTopics` (`src/lib/dj/factEngine.ts:28-37`). No positive-grounding step pulls a *new* verified fact for the current artist/track and feeds it to the LLM. So the LLM generates lore from its own training data and is merely told not to invent via `STRICT_TRUTH_GUARDRAIL` (`src/app/api/generate-script/route.ts:297-301`). That is the hallucination risk.
- **The dead styles**: `COMMENTARY_STYLES` in `src/lib/dj/promptBuilder.ts` defines 7 on-air angles, but `pickCommentaryStyle` only runs for the `song_intro` LLM case (which is templated away client-side in `src/lib/dj-intro.ts`) and the legacy no-plan path. `artist_trivia` and `local_events` hardcode their style in `buildSegmentUserPrompt`. So 5 of 7 styles never fire and rotation does not happen.

### Affected Files (approved)
- `src/lib/dj/factEngine.ts`
- `src/app/api/generate-script/route.ts`
- `src/lib/dj/promptBuilder.ts`
- Read-only reference: `src/lib/db/schema.ts` (do not modify the schema; the `lore_facts` + `user_lore_history` tables already exist)

---

### Execution Plan

#### Task 1 — Positive fact retrieval (factEngine)
- **File**: `src/lib/dj/factEngine.ts`
- **Target**: Add a new exported async function alongside the existing `getExcludedFactTopics`.
- **Behavior**:
  1. Accept the current listener `userId`, plus the current `artistId`, `trackId`, and `albumId` when available (all optional strings).
  2. Return one verified, **unserved** fact for this listener. Preference order: a fact whose `trackId` matches the current track; else one whose `artistId` matches the current artist; else one whose `albumId` matches; else any fact (broadest fallback). Never return a fact already present in this user's `user_lore_history`.
  3. Return an object containing the `factId` and `factText`, or `null` when no unserved fact exists.
  4. Fail open: on any DB error, return `null` (never throw to the script path).
  5. Keep the existing `getServedFactIds` / `getExcludedFactTopics` untouched; reuse `getServedFactIds` to compute the exclusion set.

#### Task 2 — Ground the lore clip + log the served fact (generate-script route)
- **File**: `src/app/api/generate-script/route.ts`
- **Target**: The lore-clip generation path (the branch that handles `scriptPhase === "lore"`).
- **Behavior**:
  1. When a lore clip is requested, call the new retrieval function (Task 1) with the request's `userId`, `artistId`, `trackId`, `albumId`.
  2. **If a verified fact is returned**, inject it into the prompt sent to the LLM as the single verified fact this break must deliver. Instruct the LLM explicitly: deliver this fact in the persona and commentary style given; do not add, embellish, or invent any other biographical, recording, or anecdotal claim beyond the provided fact; phrasing may vary, the substance may not.
  3. **If no fact is returned (`null`)**, keep the existing `STRICT_TRUTH_GUARDRAIL` behavior: the clip describes musical vibe, production elements, or chart context only, and invents nothing biographical. This is the safe fallback that keeps the break voiced without fabricating.
  4. The `STRICT_TRUTH_GUARDRAIL` constant stays appended to every lore system prompt in both branches.
  5. After the lore clip is successfully generated, record the served `factId` to `user_lore_history` for this `userId` (best-effort, non-blocking; a failure here must not fail the script). Reuse the existing `logServedFact` in factEngine if it fits, else add a thin logger there.
  6. Do not change the announcement-clip (`scriptPhase === "announcement"`) path — it stays names-only and grounded by the track metadata already passed in.

#### Task 3 — Revive Commentary Style rotation (promptBuilder)
- **File**: `src/lib/dj/promptBuilder.ts`
- **Target**: `buildSegmentUserPrompt`, the `artist_trivia` and `local_events` cases (currently hardcoded), and `pickCommentaryStyle` / its call sites.
- **Behavior**:
  1. Remove the hardcoded style for `artist_trivia` and `local_events`. Route every lore-bearing kind (`song_intro`, `artist_trivia`, `up_next`, `local_events`) through `pickCommentaryStyle` using the segment plan's `styleRotationIndex`, exactly as `song_intro` already does.
  2. Make the rotation **city-aware**: when no broadcast city is available for the break, exclude the weather-vibe style and the local-events style from the candidate set so the LLM is never directed to mention weather or live concerts it cannot verify. When a city IS available, the full 7-style set remains in rotation.
  3. Keep `recap` and `stinger` cases unchanged — they do not rotate commentary styles.
  4. Do not change `MUSICOLOGY_PILLARS` or `pickMusicologyPillar` — pillar rotation already works; this prompt only fixes style rotation.
  5. Preserve the existing anti-repetition directive (do-not-repeat prior topics) — it still runs from `getExcludedFactTopics`.

---

### Verification & Output Requirements
1. **Apply Minimal Diff Modifications**: implement directly against the live files; no scaffolding, no unrelated edits.
2. **Grounding proof**: when a matching `lore_facts` row exists, the lore-clip prompt MUST contain that `factText` verbatim and the no-embellishment instruction; when none exists, the prompt MUST contain the `STRICT_TRUTH_GUARDRAIL` and no fabricated biographical prompt.
3. **Served-fact ledger**: a played lore break logs exactly one row to `user_lore_history`; a failed/aborted lore break logs zero rows; the same fact is never served twice to the same listener.
4. **Style rotation**: across consecutive lore breaks of the same kind, the chosen `CommentaryStyle` advances via `styleRotationIndex`; with no city, neither weather nor local-events style is ever selected.
5. **Validation**: `tsc --noEmit` — 0 errors; `eslint` on the three touched files — clean; run any existing `src/lib/dj/__tests__` and `src/lib/catalog/__tests__` that cover these modules.
6. **Step 4 docs**: name which canonical docs need updating — at minimum `docs/AUDIO_ORCHESTRATION_SPEC_2.md` (lore grounding + style rotation) and `.cursor/rules/songhost.mdc` if it references the lore pipeline. Do not edit docs unless instructed; list them in your report.
