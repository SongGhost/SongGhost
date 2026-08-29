# DJ Lore — Strip the DB Fact-Grounding Layer (revert to pure live-LLM lore)

## Why
A recent lore-revival round added a "verified fact from the `lore_facts` database" layer on top of the live-LLM lore path. The product decision is to **remove that DB layer entirely** and keep **pure live-LLM lore**: the DJ generates lore live from the LLM, prefetched before the end of the song, under the existing `STRICT_TRUTH_GUARDRAIL` instruction (no invented biography; vibe/production/chart context only).

## Keep untouched
- `STRICT_TRUTH_GUARDRAIL` (the live-LLM grounding instruction — this IS the desired behavior).
- Pavlovian two-clip break routing, scheduler changes, the `song_id` names-only kind, the mid-session `song_intro` earcon chime, Commentary Style rotation (city-aware), Silent grays Host Studio.
- The **pre-existing Anti-Repetition Fact Engine**: `getServedFactIds`, `getExcludedFactTopics`, `logServedFact`, the `user_lore_history` table, and the `lore_facts` table itself (minus the one column being removed). Do NOT remove anti-repetition.
- Any unrelated `artistName` field (play-logs, similar-artists, lastfm, AudioPlayer, dj-intro, TrackMetadata, ScriptTeleprompter) — different fields, must not change.
- `docs/WORKFLOW.md` (unrelated).

## Remove (the positive-grounding layer)

### Code
1. `src/lib/dj/factEngine.ts`
   - Remove the `UnservedLoreFact` type, the `getUnservedLoreFact` function, and the `selectUnservedFact` helper.
   - Keep `getServedFactIds`, `getExcludedFactTopics`, `logServedFact`.
   - Update the file header comment to describe anti-repetition only (drop "positive grounding" / "inject a verified fact" wording).
   - Drop imports only if they become unused after removal.

2. `src/app/api/generate-script/route.ts`
   - Remove imports of `getUnservedLoreFact` and `type UnservedLoreFact`. Keep `getExcludedFactTopics`. Remove the `logServedFact` import (it is used only by the wrapper being removed).
   - Remove the `buildVerifiedFactDirective` function and the `logServedFactBestEffort` function.
   - In `generateLoreScript`: remove the `groundedFact` / `verifiedFactDirective` block — the `getUnservedLoreFact` call, the `buildVerifiedFactDirective` line, the `if (verifiedFactDirective) { systemPrompt += ... }`, the `verifiedFactDirective` push into `contextLines`, and the `if (groundedFact) { logServedFactBestEffort(...) }` call. The `scriptPhase === "lore"` path MUST still call the LLM with the lore system prompt (which already includes `STRICT_TRUTH_GUARDRAIL`) — that live-LLM path stays.
   - In `handleLegacyScriptGeneration`: remove the same grounding block (the `groundedFact`/`verifiedFactDirective` lines, the `systemPrompt +=` append, the `userPrompt` ternary, and the `logServedFactBestEffort` call).
   - `artistId` / `trackId` / `albumId` on `LoreCachePayload` and `loreScriptInput` may stay (inert now); update any comments mentioning "positive grounding" / "lore_facts lookup". Do not break the type.
   - Keep `STRICT_TRUTH_GUARDRAIL`, `resolveExcludedFacts`, `buildAntiRepetitionDirective`, and all Pavlovian/scheduler/earcon/commentary-style logic.

3. `src/lib/db/schema.ts`
   - Remove the `artistName: text("artist_name")` column from `loreFacts` ONLY. Do NOT touch the other `artistName` column (play-logs table).

### Migrations
4. Delete `drizzle/0002_add_lore_facts_artist_name.sql`. Remove its entry from `drizzle/meta/_journal.json` and adjust the meta snapshot so `npx drizzle-kit generate` reports **no pending changes**. The live DB was never migrated with 0002, so no DROP migration is needed. If `drizzle-kit generate` insists on a change, report it — don't guess.

### Scripts & obsolete prompts
5. Delete `scripts/seed-preset-lore.ts`.
6. Delete `public/prompts/DJ_LORE_GROUNDING_PROMPT.md` and `public/prompts/DJ_LORE_NAME_MATCHING_PROMPT.md`.

### Docs (rewrite to pure live-LLM lore; keep Pavlovian/earcon/song_id/style claims)
7. `docs/ARCHITECTURE.md` — replace the "Positive lore grounding" paragraph (the one naming `getUnservedLoreFact`) with: lore clips are generated **live by the LLM** under `STRICT_TRUTH_GUARDRAIL` (no invented biography/recording anecdotes; vibe/production/chart context only). Drop all mentions of `getUnservedLoreFact`, `artistName`, `lore_facts.artist_name`, verbatim injection, served-fact ledger write. Keep the anti-repetition description (`getExcludedFactTopics` / `user_lore_history`).
8. `docs/AUDIO_ORCHESTRATION_SPEC_2.md` — in the two-clip-break line, replace "Lore clips are grounded: /api/generate-script injects a verified lore_facts row verbatim ... a served fact is logged to user_lore_history after a successful lore clip." with: "Lore clips are generated live by the LLM under STRICT_TRUTH_GUARDRAIL (no invented biography; vibe/production/chart context only)." Keep surrounding Pavlovian/earcon/song_id text.
9. `docs/ROADMAP.md` — in the lore-grounding checkbox, drop "getUnservedLoreFact injects a verified lore_facts row verbatim ... served-fact ledger write after playback". Keep the rest (Commentary Styles rotate city-aware, every mid-session voiced break is Pavlovian, song_id names-only kind, Silent grays Host Studio). Checkbox now describes live-LLM lore with STRICT_TRUTH_GUARDRAIL.
10. `.cursor/rules/songhost.mdc` — rewrite the "No invented lore" bullet to: a lore clip is generated live by the LLM under `STRICT_TRUTH_GUARDRAIL` — no invented biographical/recording anecdotes; when the LLM lacks a verified fact it describes vibe/production/chart context only. Drop `getUnservedLoreFact` / `lore_facts` / `user_lore_history` from that bullet.

## Validation & report
- `npx tsc --noEmit` — 0 errors.
- `npx drizzle-kit generate` — no pending changes (or report what it wants).
- Confirm no remaining references in `src/` or `docs/` to `getUnservedLoreFact`, `buildVerifiedFactDirective`, `logServedFactBestEffort`, `UnservedLoreFact`, `selectUnservedFact`, or `lore_facts.artist_name`.
- Report every file changed/deleted and paste the final rewritten text for the 4 doc locations.
