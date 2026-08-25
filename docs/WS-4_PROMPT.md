# WS-4: Roots & Branches Pro Teaser — Grok Build Prompt

## Context

SongHost ships three workstreams: WS-1 (13 OpenAI voices), WS-2 (4 personas), WS-6 (Pavlovian two-clip break), WS-3 (genre vernacular). The `roots_branches` commentary format already exists as a **Pro-gated** format (25–32 words, one musicology beat, Mode A ≤15s) in `src/app/api/generate-script/route.ts` (`LORE_WORD_TARGETS.roots_branches`) and `src/lib/dj/promptBuilder.ts` (`buildCommentaryFormatDirective("roots_branches")`). Today `clampHostTuningForTier` (`src/lib/dj/scriptGenerator.ts` line 177) forces Free users to `lore: "standard"` (line 182) — so Free users NEVER hear `roots_branches`.

WS-4 adds a **Free-tier teaser** of the locked Pro `roots_branches` format: a short, earcon-cued preview that ends with an in-character sign-off (doubling as a soft upgrade nudge) and a contextual outro, plus a visual Pro badge. The full `roots_branches` format stays Pro-gated. The `teaser/open.mp3` earcon was reserved in WS-6 (`src/lib/dj/earcon.ts`) and is NOT yet wired — WS-4 wires it.

## Architecture decisions (agreed with the designer — do not redesign)

- **Teaser cadence: once every 7 voiced breaks** for a Free user. Not every break, not once per session — every 7th voiced break is a teaser instead of a standard break. Use a session-scoped counter that increments on each voiced break and fires the teaser when it hits 7, then resets. Do NOT re-enable the Free monthly break metering — it stays at `Number.POSITIVE_INFINITY`. (Re-tying teasers to a 30-break paywall is a separate strategic decision, logged in `docs/TUNING_BACKLOG.md` T6, not part of WS-4.)
- **Sign-off purpose: in-character + soft upgrade nudge.** The persona signs off in character AND softly names the unlock — e.g. the persona says who they are and that this was a taste of Roots & Branches, with the full dive on Pro. It is NOT an explicit "upgrade now" CTA, and it is NOT pure flavor with no mention of Pro. It lands between: character-first, with a genuine (not pushy) pointer to Pro.
- **Pro users never hear the teaser.** A Pro listener gets the full `roots_branches` format as today; the teaser is a Free-only surface. When a Free user upgrades mid-session, the teaser counter stops and they get full `roots_branches`.
- **Teaser is a single clip, not the Pavlovian two-clip sequence.** The teaser is short and self-contained: teaser earcon → one short script (the taste + sign-off + contextual outro). It does NOT split into lore + announcement. It plays ducked over the incoming track like a standard break (Mode A), with the teaser earcon preceding it. Do not run it through `runPavlovianTransition`.

## Task

### 1. Wire the `teaser/open.mp3` earcon

`src/lib/dj/earcon.ts` currently maps `lore/open`, `weather/open`, `concert/open` and explicitly does NOT wire `teaser/open`. WS-4 wires it. Add a teaser earcon path resolved when the break is a Roots & Branches teaser (a new segment kind or a flag — see below). The earcon plays fail-closed (missing/unloadable file skips to the script, never blocks a break), consistent with the existing `playEarconFailClosed` behavior. Reuse the existing earcon playback helpers — do not duplicate them.

### 2. Introduce the teaser as a distinct break type

Introduce a way for the scheduler/orchestrator to know a given voiced break is a Roots & Branches teaser (not a standard break, not a full `roots_branches`). Decide the cleanest representation reading the current code: either a new `DjSegmentKind` value (e.g. `"roots_teaser"`), or a flag on `DjSegmentPlan` (e.g. `isProTeaser?: boolean`), or a `commentaryFormat` value of `"roots_teaser"`. Pick the one that composes cleanest with the existing `isLoreSegmentKind` / Pavlovian / ChatterPacing logic and does NOT force a teaser through the two-clip Pavlovian path. State which you chose and why in the summary. The teaser must:
- Be excluded from `isLoreSegmentKind` (so it does NOT trigger the Pavlovian two-clip sequence).
- Be excluded from the ChatterPacing voiced-break accounting in a way that still lets it replace a standard break on the 7th count (i.e., the 7th voiced slot becomes a teaser instead of the standard break that would have fired there).
- Use the `teaser/open.mp3` earcon, not `lore/open`.

### 3. Teaser script generation

Generate a short teaser script (shorter than full `roots_branches`'s 25–32 words — recommend ~14–18 words for the taste). The teaser script must contain, in order:
1. **One musicology beat** — a single sharp Roots & Branches-style detail about the track (sample origin, production lineage, session player, etc.). Reuse the `roots_branches` directive's musicology steer from `buildCommentaryFormatDirective`, but scoped to ONE beat, not the full 25–32 word dive.
2. **In-character sign-off + soft upgrade nudge** — the persona signs off in character and softly names the unlock. The sign-off must be character-first (Sarcastic Critic stays dry; Warm Companion stays warm; Standard Broadcast stays clean) and genuinely point to Pro without being pushy. Example shape (adapt to persona voice): "That's a taste of Roots & Branches — I'm [persona name], and the full dive lives on Pro." Do NOT use "upgrade now" / "subscribe" / "click to unlock" language. The persona says it like a host, not an ad.
3. **Contextual outro** — one line tying the teaser to the track/scene that just played or is coming, so it doesn't feel like a pasted-on ad. Reuse the genre vernacular directive (WS-3) so the outro carries the station's scene colour.

The teaser uses the persona's `systemPrompt` and `ttsInstructions` as today, plus the WS-3 vernacular directive. Anti-repetition (`recentBreakHistory`) still applies — do not repeat the same musicology beat or sign-off phrasing across consecutive teasers.

### 4. Visual Pro badge

Add a visual badge marking the teaser as a Pro preview. Read the existing Host Studio / teleprompter surfaces (`src/components/player/HostBar.tsx`, the teleprompter component, the broadcast history drawer) to find where break kinds are already surfaced in the UI, and add a "Pro Preview" / "Roots & Branches — Pro" badge that shows ONLY when the airing break is a teaser. The badge must:
- Be clearly a Pro marker (use the existing Pro visual language — do not invent a new color system).
- Not block or modal — it is informational, shown inline where the break is already displayed.
- Not appear for full `roots_branches` (Pro users) — only for the Free teaser.
- Disappear when the teaser ends.

### 5. Tier logic

- Free (`!isPro`): the 7th voiced break is a teaser; all other voiced breaks stay `standard` (forced by `clampHostTuningForTier` as today). The teaser is the ONLY place a Free user hears `roots_branches`-shaped content.
- Pro (`isPro`): no teaser ever; the user gets full `roots_branches` when their `commentaryFormat` is `roots_branches`. The teaser counter does not run for Pro.
- On mid-session upgrade (Free → Pro): stop the teaser counter and clear any pending teaser so the user transitions cleanly to the Pro experience with no stranded teaser.

## Constraints

- **Surgical.** Do not refactor the persona system, the Pavlovian two-clip FSM, the duck constants, the cache, or the vernacular directive. WS-4 layers a teaser path on top of the existing break machinery.
- **Do not regress** the Pavlovian two-clip sequence, duck constants (18% / 300ms / 1500ms), `useStationQueue`, `DirectStreamProvider`, `performance-commit.ts`, persona migration, `sessionOpeningDjRef` invariant, ChatterPacing windows, or the WS-3 vernacular injection.
- **Do not re-enable the Free break metering.** `FREE_MONTHLY_BREAK_LIMIT` stays `Number.POSITIVE_INFINITY`. The 30-break paywall tie is T6 in `docs/TUNING_BACKLOG.md`, a separate decision — do not implement it.
- **Teaser is Free-only.** Pro users never hear it.
- **Teaser is single-clip, not Pavlovian two-clip.** Do not route it through `runPavlovianTransition`.
- **Fail closed** on a missing teaser earcon — skip the earcon, play the script.
- **No new Pro gates on music/commentary.** The teaser is an additive Free surface; it does not gate anything that is currently free.

## Process

1. Read every relevant file before editing: `src/lib/dj/earcon.ts`, `src/lib/dj/scheduler.ts`, `src/lib/dj/promptBuilder.ts`, `src/lib/dj/scriptGenerator.ts` (`clampHostTuningForTier`), `src/app/api/generate-script/route.ts` (`LORE_WORD_TARGETS`, `buildCommentaryFormatDirective`), `src/lib/audio/legacy/webOrchestrator.ts` (break dispatch), `src/components/player/HostBar.tsx`, the teleprompter, and the tier context. Understand how a voiced break is currently scheduled, dispatched, and surfaced in the UI before adding the teaser path.
2. Decide the teaser's representation (new kind vs flag vs commentaryFormat value) and state the choice + rationale in the summary. Pick the one that composes cleanest with `isLoreSegmentKind` / Pavlovian / ChatterPacing.
3. Wire the earcon, add the teaser script generation, add the tier-gated 7-break cadence, add the visual badge, handle mid-session upgrade.
4. If something in the current code contradicts the architecture above (e.g. a path that cannot accept a teaser, or a ChatterPacing window that the 7-count would break), **stop and ask** — do not silently work around it.
5. Do not introduce new bugs. Do not refactor opportunistically.
6. Run `npx tsc --noEmit` and `npm run lint` — both must pass with zero new errors.
7. Run the existing vitest suite — no regressions. Add tests for the teaser cadence (7th break fires), tier gating (Pro never teasers), and mid-session upgrade clearing.
8. **Update the code docs** per the §14 model roles: add the Roots & Branches teaser to `docs/ARCHITECTURE.md` (the commentary-format / Pro-gating section), `docs/ROADMAP.md` (WS-4 → DONE), and `docs/AUDIO_ORCHESTRATION_SPEC_2.md` (the teaser break FSM). Also draft a `DECISIONS.md` D12 entry for the designer (GLM 5.2) to finalize — do not write the final D12 yourself, just leave a draft the designer can review.
9. Give a full summary: every file changed, the teaser representation chosen + why, the earcon wiring, the script shape, the 7-break cadence, the tier gating, the visual badge, the mid-session upgrade handling, typecheck/lint/test results, the doc updates, and anything you could not fully verify (e.g. a live Free session hitting the 7th break).

## Deliverable

A Free-tier Roots & Branches teaser (teaser earcon + short musicology taste + in-character sign-off with soft Pro nudge + contextual outro + visual Pro badge), firing once every 7 voiced breaks, Free-only, single-clip (not Pavlovian), with the `teaser/open.mp3` earcon wired, full `roots_branches` staying Pro-gated, Free metering unchanged, typecheck + lint + tests passing, code docs updated, and a full summary for review before push.
