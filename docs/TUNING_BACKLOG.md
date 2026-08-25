# SongHost — Tuning Backlog (post-WS-3/4/5 round)

**Status:** Living document. Read this before the big tuning round that follows WS-3, WS-4, and WS-5.
**Owner:** GLM 5.2 (designer) proposes; Larry approves; Grok implements.
**Last updated:** Aug 25 2026

This doc tracks issues identified during WS-1 through WS-6 that are deliberately **deferred** to a single tuning round after WS-3, WS-4, and WS-5 ship. Do not address these piecemeal during WS-3/4/5 — Larry wants to test the full stack together, then tune once.

---

## Workstream order (confirmed by Larry, Aug 25 2026)

1. **WS-1** — OpenAI 13-voice catalog swap — DONE (shipped)
2. **WS-2** — 4-persona reconstruction — DONE (shipped)
3. **WS-2.1** — ProUpgradeModal copy fix — DONE (shipped)
4. **WS-6** — Pavlovian two-clip break + Host Studio display fixes — DONE (shipped)
5. **WS-3** — Genre Vernacular (invisible, LLM-generated) — IN PROGRESS
6. **WS-4** — Roots & Branches Pro Teaser (uses reserved `teaser/open.mp3`) — NEXT
7. **WS-5** — Host Studio Vibe Chips (Pro custom directives) — THEN
8. **BIG TUNING ROUND** — everything in this doc, after WS-3/4/5 are in and Larry has done a full-stack ear test
9. **WS-7** — Admin Director's Cut tool (ElevenLabs pre-rendered R2 documentaries) — AFTER the tuning round

---

## T1 — Cache extension for Pavlovian two-clip breaks (cost saver)

**Source:** Found during WS-6 verification (Aug 25 2026). Verified in code.
**Severity:** Cost implication, not a correctness bug.

WS-6 added this line in `src/app/api/generate-script/route.ts` (lines 1157–1158):
```
const usePavlovian = !segmentPlan || isLoreSegmentKind(segmentPlan.kind);
const contextAware = baseContextAware || usePavlovian;
```
This forces **every lore-type break** (`song_intro`, `artist_trivia`, `local_events`) to `contextAware = true`. The DB + R2 cache (`cached_lore_breaks` table, keyed on `(trackId, voiceId)`) is gated on `!contextAware` (lines 1173 and 1355), so:

- **After WS-6, all Pavlovian lore-type breaks bypass the DB cache entirely.** They always generate live — 2 LLM calls + 2 TTS calls per break, never cached.
- The cache now only serves non-lore single-clip breaks (stinger / recap / up_next) that are non-context-aware.
- The cache schema stores a single `audioUrl` + `scriptText`. WS-6's Pavlovian response carries two URLs (`loreAudioUrl` + `announcementAudioUrl`), but the cache insert/lookup was never extended to store or return two clips.

**Fix (for the tuning round):** Extend `cached_lore_breaks` to store `loreAudioUrl` + `announcementAudioUrl` (and the two scripts), keyed on `(trackId, voiceId, personaId)`, so a Pavlovian break can be cached and replayed when non-context-aware. Restore the cost-saver to the most common break type (the song intro). Must still respect the existing `contextAware` exclusions (anti-repetition, clean vs explicit, extended format, vibe prompt) — never serve a shared cache hit to a context-aware break.

**What stays cached today (no action):** Studio authored `customText` pre-renders (full-album listens) bypass LLM → TTS → R2 and play as-is. In-memory `prefetchedBreaksMap` is session-scoped zero-latency, not cost-saving.

---

## T2 — Persona `instructions` tuning (ear test)

**Source:** Deferred by Larry, Aug 25 2026.
**Severity:** Character delivery quality.

Larry deferred persona `instructions` tweaks until the full stack (Pavlovian breaks + vernacular) is in, because the break shape changes how a persona *feels* end to end. After the full-stack ear test, judge each persona:

- **Standard Broadcast** — clean, neutral, gets out of the way.
- **Warm Companion** — sounds warm, not politely AI.
- **Sarcastic Critic** — sounds deadpan/dry, not enthusiastic.
- **The Musicologist** — sounds like someone who's lived with the record.

If a persona doesn't land, it's a one-line `ttsInstructions` tweak in `src/data/personas.ts` — NOT another architecture pass. Note which persona and what's off (too warm, not dry enough, etc.).

---

## T3 — Pavlovian commentary gap + earcon gain tuning

**Source:** WS-6 shipped with recommended defaults; Larry to tune by ear.
**Severity:** Feel.

WS-6 shipped:
- Commentary gap = **500ms** (`COMMENTARY_GAP_MS` in `src/lib/dj/earcon.ts`).
- Earcon gain = voice gain (`effectiveDjVoiceGain()`), passed to `playEarconFailClosed`.

After the full-stack ear test, tune:
- Gap shorter (e.g. 300ms) if it feels like dead air; longer (e.g. 700ms) if the earcon bleeds into the speech.
- Earcon gain up if too quiet / buried; down if too prominent.

These are constants in `src/lib/dj/earcon.ts` — single-value tweaks, not architecture.

---

## T4 — Companion (DirectStream / iTunes preview) duck-ramp inconsistency

**Source:** Flagged by Grok in WS-6; verified pre-existing, NOT a WS-6 regression.
**Severity:** Minor; affects only the Song Radio search (iTunes 30s preview) path, not the main YouTube dial.

The YouTube live dial uses mix-bus duck **300ms / restore 1500ms** (correct per SOP). The companion DirectStream/iTunes-preview announcement path goes through Mode A, which uses **600ms duck ramp / 800ms swell** (`MODE_A_DUCK_RAMP_MS = 600` in `src/lib/audio/legacy/webOrchestrator.ts`). WS-6 inherited this by routing the announcement through `runModeATransition`.

**Fix (optional, for the tuning round):** Align Mode A's duck/restore ramps to the SOP 300ms / 1500ms, OR document why the companion path intentionally differs. Larry's call. The main dial is already correct, so this is low priority.

---

## T6 — Re-enable Free break metering + tie Roots & Branches teasers to the paywall (strategic option, not yet decided)

**Source:** Raised by Larry during WS-4 design, Aug 25 2026.
**Status:** NOT decided. Logged for Larry's call. Do not implement without explicit approval.

Today the Free monthly break metering is **OFF** — `FREE_MONTHLY_BREAK_LIMIT = Number.POSITIVE_INFINITY` in `src/lib/usage/constants.ts` (legacy allowance set to infinity; Free users get unlimited breaks). WS-4 ships teasers at "once every 7 breaks" with metering still off.

**Strategic option:** Re-enable the 30-breaks/month wall AND tie the 3 Roots & Branches teasers to it (3 over 30 = every 10th voiced break). This creates a clean conversion funnel: a Free user hears 3 Pro-format tastes across the month, then hits the break wall right after the last taste — the last thing they heard was a sample of Pro, at the paywall moment. Stronger conversion nudge than a standalone teaser cadence.

**Why it's separate from WS-4:** Re-enabling the metering changes the break experience for ALL Free users, not just teasers. That's a product-strategy decision, not an implementation detail. Keep it out of WS-4 unless Larry explicitly approves.

---

## T5 — WS-6 Host Studio display fixes (shipped — for reference, no action)

These shipped in WS-6 Part A and are verified working in code (live session not yet run):
- **A1+A3:** Free listener with a saved Pro persona no longer sees it selected in the modal — clamped to Standard Broadcast via `getEffectivePersona`; Pro cards locked; persisted `activePersonaId` unchanged; lock note shown.
- **A2:** Free player bar shows the selected OpenAI voice label (per `resolveHostDisplayName` intent); Pro shows the persona name.

No action needed unless the live ear test surfaces a display issue.

---

## Verification gaps to close in the tuning round

- **No live station session was run for WS-6.** Larry's full-stack ear test is the first end-to-end listen. Confirm: earcon → gap → lore → track B duck → announcement → restore, with no dead air and no stuck-ducked state.
- **No live session for WS-3 vernacular.** After WS-3 ships, listen across multiple genres (e.g. Britpop, country, jazz, grunge) and confirm the host actually sounds genre-coloured without sounding like a parody.

---

## Doc-update discipline (process fix)

**Source:** GLM 5.2 process gap, Aug 25 2026.

The WS-2 and WS-6 Grok build prompts did NOT instruct Grok to update the code docs (`ARCHITECTURE.md`, `ROADMAP.md`, `AUDIO_ORCHESTRATION_SPEC_2.md`) per the §14 model roles. Result: those three docs are stale through WS-6. A `DOCS_CATCHUP_PROMPT.md` was written to bring them current.

**Process fix going forward:** Every Grok build prompt MUST include an explicit requirement to update `ARCHITECTURE.md`, `ROADMAP.md`, and `AUDIO_ORCHESTRATION_SPEC_2.md` for any architecture-level change, plus a `DECISIONS.md` entry drafted for GLM 5.2 to finalize. Do not rely on Grok remembering the §14 split — state it in every prompt.
