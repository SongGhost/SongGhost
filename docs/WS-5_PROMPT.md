# WS-5: Host Studio Vibe Chips — Grok Build Prompt

## Context

SongHost ships WS-1 through WS-4. The listener-authored station direction already exists as `vibePrompt` / `customDirectives`: Host Studio → `stationConfigs[stationId].vibePrompt` → `resolveStationSettings()` → `buildVibeDirective(vibePrompt)` in `src/lib/dj/promptBuilder.ts` (quoted/bounded steer, fail-open on empty), persisted cross-device via `/api/user/sync` in `users.preferences` JSONB. Today `clampHostTuningForTier` (`src/lib/dj/scriptGenerator.ts` line 185) forces Free `customDirectives = ""` — so Free users cannot use custom directives at all.

WS-5 adds **Vibe Chips**: one-click preset chips that populate the existing `vibePrompt` path (they do NOT build a parallel directive system). Pro gets 5 preset chips + a custom text box; Free gets 1 teaser chip that applies a short preview vibe for 1–2 breaks then shows the upgrade nudge.

## Architecture decisions (agreed with the designer — do not redesign)

- **Chips populate `vibePrompt`, they are not a separate system.** Selecting a chip writes the preset's vibe string into the `vibePrompt` field (the same field the custom text box writes). Do NOT build a parallel chip store, a separate directive, or a new persisted field. One source of truth: `vibePrompt`.
- **Single-select, replace.** One chip active at a time. Picking a chip replaces the custom text box content with that chip's vibe string. Typing in the custom text box clears the active chip (the text becomes the vibe). Selecting a chip again replaces the text. No stacking, no appending.
- **Pro: 5 preset chips + custom text box.** The 5 chips are a starting set (tunable by the designer after ear test); each carries a short vibe string that `buildVibeDirective` already knows how to steer with. Proposed labels + steer shape (Grok implements these as the initial set; the designer may retune the strings later):
  1. **Late Night** — "intimate, hushed, after-hours warmth — like a 3 AM drive-time host"
  2. **Hype** — "big energy, fist-pump, like a peak-hour floor-filler set"
  3. **Storyteller** — "narrative, set the scene, lean into the story behind the track"
  4. **Deep Cuts** — "lean into the obscure, the B-sides, the forgotten takes"
  5. **Front Porch** — "easygoing, conversational, like a friend on the porch"
- **Free: 1 teaser chip, preview-then-lock.** The Free teaser chip applies a short preview vibe (use one of the Pro presets as the preview, e.g. "Late Night") for the next 1–2 voiced breaks, then reverts and surfaces the upgrade nudge. The full 5 chips are locked for Free (shown greyed/locked; clicking a locked chip opens the upgrade modal, same Pro visual language as the WS-4 `RootsTeaserBadge`).
- **Chips layer on the persona and vernacular, they do not replace them.** A vibe chip colours the host's tone; it does not override the persona character (Sarcastic Critic stays dry) or the WS-3 genre vernacular. `buildVibeDirective` already composes after the persona/era/vernacular directives — keep that order.

## The one architectural wrinkle (handle carefully)

`clampHostTuningForTier` forces Free `customDirectives = ""` (line 185). The Free teaser chip's preview vibe must reach the prompt for 1–2 breaks even though the listener is Free. Implement this as a **session-scoped preview-vibe window** that bypasses the Free clamp for a limited count of voiced breaks, then clears:

- The preview vibe is **session-scoped, NOT persisted.** It does not write to `stationConfigs.vibePrompt` (which stays `""` for Free) and does not sync to the cloud. It lives in a session ref/state that the prompt-build path reads when active.
- The clamp still forces Free `customDirectives = ""` EXCEPT when a live preview is active. When the preview window expires (after 1–2 voiced breaks), the preview clears and the clamp reasserts — Free `vibePrompt` is `""` again.
- After the preview window, surface the upgrade nudge (reuse the existing upgrade modal / Pro visual language; do not invent a new surface). The nudge is informational, not blocking.
- Pro users never use the preview window — they get the real chips + custom text box, persisted as `vibePrompt` as today.

State the chosen session-scoped representation in the summary and verify it does not leak the preview into the persisted Free `vibePrompt` or the cloud sync payload.

## Task

### 1. Define the chip presets

Add the 5 Pro preset chips as data (a small registry: id, label, vibe string). Place it next to the existing host/persona data (e.g. `src/data/` or alongside the persona config) — not in a new top-level module. Each chip's `vibe` string is what gets written into `vibePrompt` when selected. The Free teaser chip references one of these presets as its preview.

### 2. Wire the Host Studio UI

In the Host Studio / Host Settings surface (`src/components/player/HostBar.tsx`, `src/components/player/HostSettingsModal.tsx` — read them to find where `vibePrompt` is already edited), add:
- The 5 preset chips as one-click buttons (single-select; active chip highlighted). For Free, show all 5 greyed/locked; clicking opens the upgrade modal.
- The custom text box (Pro only; for Free it is hidden or locked with the same Pro treatment). Typing replaces the active chip selection.
- The 1 Free teaser chip (distinct from the locked 5) — clearly labelled as a preview, using the existing Pro accent language. Clicking starts the preview-vibe window.
- The active chip + text persist as `vibePrompt` via the existing `setVibePrompt` host-state setter (debounced 400ms — do not bypass the debounce).

### 3. Wire the preview-vibe window (Free only)

Implement the session-scoped preview-vibe window: when the Free teaser chip is clicked, set a session-scoped preview vibe (one of the preset vibe strings) and a countdown of 1–2 voiced breaks. The prompt-build path reads the preview vibe when active (overriding the Free clamp's `""`), and decrements the countdown on each voiced break; when it hits zero, clear the preview and surface the upgrade nudge. Reuse the WS-4 teaser-counter pattern as a model (session-scoped, resets, does not persist) — but do NOT couple this to the WS-4 Roots & Branches teaser counter; they are independent features.

### 4. Tier gating

- **Pro:** 5 chips + custom text box, persisted as `vibePrompt` (existing path, no clamp). Mid-session downgrade (Pro → Free) clears the persisted `vibePrompt` back to `""` and ends any active preview window — do not leave a Pro vibe active for a Free listener.
- **Free:** 1 teaser chip (preview-then-lock) + 5 locked chips (upgrade gate). Persisted `vibePrompt` stays `""`. The preview vibe is session-scoped only.
- Do not gate music or commentary. Vibe chips are a host-direction surface only.

## Constraints

- **Surgical.** Do not refactor the persona system, the Pavlovian FSM, the duck constants, the cache, the vernacular directive, or the WS-4 teaser. WS-5 layers chips on the existing `vibePrompt` path.
- **Do not regress** the Pavlovian two-clip sequence, duck constants (18% / 300ms / 1500ms), `useStationQueue`, `DirectStreamProvider`, `performance-commit.ts`, persona migration, `sessionOpeningDjRef` invariant, ChatterPacing windows, WS-3 vernacular injection, WS-4 `roots_teaser` cadence, or `FREE_MONTHLY_BREAK_LIMIT`.
- **One source of truth.** Chips write `vibePrompt`; no parallel chip directive. `buildVibeDirective` is the only vibe path.
- **No new Pro gates on music/commentary.** Chips gate host direction only.
- **Preview vibe is session-scoped, never persisted for Free.** Verify it does not leak into `stationConfigs.vibePrompt`, the cloud sync payload, or the persisted preferences for a Free listener.
- **Fail open** on a missing/empty chip vibe: omit the directive (existing `buildVibeDirective` already does this).

## Process

1. Read every relevant file before editing: `src/lib/dj/promptBuilder.ts` (`buildVibeDirective`, `sanitizeVibePrompt`), `src/lib/dj/scriptGenerator.ts` (`clampHostTuningForTier`), `src/lib/user/preferences.ts` (`vibePrompt` / `stationConfigs`), `src/lib/station/public-station.ts` / `resolveStationSettings`, `src/components/player/HostBar.tsx`, `src/components/player/HostSettingsModal.tsx`, and the host-state setter path. Understand how `vibePrompt` flows from UI → persistence → prompt before adding chips.
2. Define the chip registry, wire the UI (single-select replace + locked Pro chips + custom text box + Free teaser chip), wire the session-scoped preview-vibe window, handle tier gating + mid-session downgrade.
3. If something in the current code contradicts the architecture above (e.g. a path that cannot accept a session-scoped preview overriding the clamp, or a persistence point that would leak the preview), **stop and ask** — do not silently work around it.
4. Do not introduce new bugs. Do not refactor opportunistically.
5. Run `npx tsc --noEmit` and `npm run lint` — both must pass with zero new errors.
6. Run the existing vitest suite — no regressions. Add tests for: single-select replace behavior, Free clamp still forces persisted `vibePrompt = ""`, preview-vibe window expires after N breaks and clears, mid-session downgrade clears the vibe.
7. **Update the code docs** per the §14 model roles: add Vibe Chips to `docs/ARCHITECTURE.md` (the host-direction / `vibePrompt` section), `docs/ROADMAP.md` (WS-5 → DONE), and `docs/AUDIO_ORCHESTRATION_SPEC_2.md` (the vibe-chip / preview-vibe-window behavior if it touches the FSM — likely it does not, but document the prompt-build interaction). Also draft a `DECISIONS.md` D13 entry for the designer (GLM 5.2) to finalize — leave it as a draft, do not write the final D13 yourself.
8. Give a full summary: every file changed, the chip registry, the single-select replace behavior, the 5 preset labels + vibe strings, the Free teaser chip + preview-vibe window, the session-scoped representation chosen, tier gating + mid-session downgrade, typecheck/lint/test results, the doc updates, and anything you could not fully verify (e.g. a live Pro session applying a chip and hearing the vibe colour the next break).

## Deliverable

Host Studio Vibe Chips — 5 Pro one-click presets (single-select, replace the custom text box) + a Pro custom text box, 1 Free teaser chip (preview-then-lock via a session-scoped preview-vibe window that bypasses the Free clamp for 1–2 breaks then reverts + upgrade nudge), all writing the existing `vibePrompt` (one source of truth, no parallel chip system), preview vibe never persisted for Free, typecheck + lint + tests passing, code docs updated, D13 draft left for the designer, and a full summary for review before push.
