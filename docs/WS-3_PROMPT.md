# WS-3: Genre Vernacular (Invisible, LLM-Generated) — Grok Build Prompt

## Context

SongHost's live dial is now 3 axes: Voice (13 OpenAI voices, WS-1), Persona (4 personas, WS-2), and **Vernacular** — this workstream. The Pavlovian two-clip break (WS-6) is live. The goal of WS-3 is to make a Britpop station's host actually sound like a Britpop obsessive, a country station's host sound like a Nashville regular, a jazz station's host talk like someone who lives in the music — without the listener toggling anything. The vernacular is **invisible**: it is derived from the station's genre/scene and woven into the persona's speech automatically. It is **not a listener knob** and is **not Pro-gated** — it is the realism layer, applied to all features (DJ breaks, weather, concerts) and all tiers.

## Architecture decision (already agreed with the designer — do not redesign)

- **LLM-generated, not hardcoded.** No static phrase lists, no canned vocabulary tables. The AI generates fresh genre-specific vernacular guided by a directive prompt. Hardcoded lists were considered and rejected — they go stale and sound robotic.
- **Directive-only.** A genre vernacular directive (e.g. "speak like a Britpop obsessive who lived through it") steers the LLM's word choice. The existing anti-repetition engine (`excludedFacts` / `user_lore_history` / `recentBreakHistory`) prevents the model from reusing the same vernacular phrasing across consecutive breaks. Do NOT build a separate vernacular repetition store — extend the existing anti-repetition engine to cover vernacular phrasing.
- **Applies everywhere.** The vernacular directive is injected into every spoken surface: DJ lore clips, DJ announcement clips, weather asides, concert callouts, station liners. Not just the song intro.
- **Invisible.** No UI, no toggle, no Pro gate. The listener never picks "vernacular." It is derived from the active station's genre/scene.

## Task

### 1. Thread the station's genre/scene into the prompt context

Today `DJPromptContext` (`src/types/dj.ts` line 285) carries `stationId`, `stationName`, `segmentPlan`, but NOT the station's genre list. The genre lives on the `Station` (`seedGenres`, `src/data/stations.ts` line 86) and is resolved through `src/lib/station-genre-profiles.ts`. Thread the resolved genre/scene into the prompt context so the vernacular directive has a real hook.

Read `src/lib/station-genre-profiles.ts` fully — it already resolves a genre profile from the station's seeds. Use that resolved profile (or its primary genre/scene label) as the input to the vernacular directive. Do not duplicate the genre-resolution logic; reuse what exists. If the station has no resolvable genre/scene, the vernacular directive is simply omitted (the persona speaks without genre colour) — fail open, never block a break on a missing genre.

### 2. Add a `buildVernacularDirective`

In `src/lib/dj/promptBuilder.ts`, alongside the existing `buildPersonaDirective`, `buildEraDirective`, and `buildVibeDirective`, add a `buildVernacularDirective` that takes the resolved genre/scene and returns a directive string that steers the LLM's word choice toward genre-specific vernacular. The directive should:
- Instruct the model to adopt the vocabulary, cadence, and reference points of someone who genuinely lives inside this genre/scene — not a tourist reading the Wikipedia page.
- Be a steer, not a script. Do NOT inject specific phrases to repeat. The model generates fresh vernacular each break.
- Reinforce that vernacular is character colour, not a parody or a sketch — the host still sounds like the persona (Standard Broadcast / Warm Companion / Sarcastic Critic / The Musicologist); the vernacular layers on top of the persona, it does not replace it.
- Compose cleanly with the era directive (era lock still wins on date references) and the station identity rule (still never name real stations).

### 3. Inject the vernacular directive into every spoken surface

The vernacular directive must reach every place a persona system prompt is assembled:
- The YouTube `buildSystemPrompt` path in `src/lib/dj/promptBuilder.ts`.
- The lore clip and announcement clip generation (WS-6 split both — vernacular applies to BOTH clips).
- Weather asides and concert callouts (the `local_events` path).
- Station liners / stingers IF they use the LLM path (verify; if stingers are canned non-LLM sweepers, vernacular does not apply and that is fine — do not force it).

Read `src/lib/dj/scriptGenerator.ts` and `src/app/api/generate-script/route.ts` to find every system-prompt assembly point and ensure the vernacular directive is composed in alongside the persona directive. Do not miss a path — an inconsistent surface (vernacular on the lore clip but not the announcement clip) would sound broken.

### 4. Extend the anti-repetition engine to cover vernacular

The existing anti-repetition engine (`excludedFacts`, `user_lore_history`, `recentBreakHistory`) prevents the model from reusing the same facts. Extend it so consecutive breaks do not reuse the same vernacular phrasing / slang / scene references. Read the current anti-repetition implementation fully before changing it. Do NOT build a parallel vernacular-specific repetition store — fold vernacular phrasing into the existing exclusion mechanism so there is one source of truth for "what has this listener already heard."

### 5. No UI, no Pro gate, no persistence change

- Do NOT add a vernacular toggle, knob, or selector to the Host Studio or Host Settings.
- Do NOT gate vernacular behind Pro. It applies to Free and Pro equally.
- Do NOT change the persona resolver, migration, or the persisted preferences shape. Vernacular is derived at prompt-build time from the active station, not stored.

## Constraints

- **Surgical.** Do not refactor the persona system, the Pavlovian FSM, the duck constants, or the cache. WS-3 is a prompt-layer change plus threading the genre into the context — it does not touch the audio engine.
- **Do not regress** the Pavlovian two-clip sequence, the duck constants (18% / 300ms / 1500ms), `useStationQueue`, `DirectStreamProvider`, `performance-commit.ts`, the persona migration, or `sessionOpeningDjRef`.
- **Do not hardcode** genre-to-phrase mappings. The directive steers; the model generates. If you find yourself writing a `Record<genre, string[]>`, stop — that is the rejected approach.
- **Fail open** when the station has no resolvable genre/scene: omit the vernacular directive and let the persona speak uncoloured. Never block a break.
- **Compose, don't override.** Vernacular layers on the persona; it does not replace the persona's character. Sarcastic Critic on a jazz station is still dry and opinionated — just with jazz vernacular, not as a different person.

## Process

1. Read every file listed above before editing: `src/types/dj.ts`, `src/lib/station-genre-profiles.ts`, `src/lib/dj/promptBuilder.ts`, `src/lib/dj/scriptGenerator.ts`, `src/app/api/generate-script/route.ts`, and the anti-repetition implementation. Understand how the persona directive, era directive, and vibe directive are composed today before adding the vernacular directive.
2. Thread the genre/scene into the context first (type change), then add `buildVernacularDirective`, then inject it at every system-prompt assembly point, then extend anti-repetition. Build bottom-up so each layer typechecks before the next.
3. If something in the current code contradicts the architecture above (e.g. a path that cannot receive a directive, or a genre that has no resolvable profile), **stop and ask** — do not silently work around it.
4. Do not introduce new bugs. Do not refactor opportunistically.
5. Run `npx tsc --noEmit` and `npm run lint` — both must pass with zero new errors.
6. Run the existing vitest suite (`npm test` or the dj test files) — no regressions.
7. Give a full summary: every file changed, the new `buildVernacularDirective`, every injection point, the anti-repetition extension, typecheck/lint/test results, and anything you could not fully verify (e.g. a live station session across multiple genres).

## Deliverable

Genre vernacular threaded into the prompt context, a `buildVernacularDirective` composed alongside the persona/era/vibe directives at every spoken surface, anti-repetition extended to cover vernacular phrasing, no UI / no Pro gate / no persistence change, typecheck + lint + tests passing, and a full summary for review before push.
