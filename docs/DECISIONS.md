# SongHost — Decision Log

A running history of decisions made during doc/code review and engineering work. Newest entries at the top. Each entry is dated and references the evidence behind it. This log records *decisions and their rationale*; it is not a changelog of every edit.

---

## D27 — Aug 28 2026: Mobile overlay round 2 — portaled full-screen search, memory rail cue, teleprompter reposition, sheet chevron, sticky sub-pills

**Decision (mobile search — true full screen):** The previous "full-screen" search (`fixed top-0 z-[60]`) was trapped inside the dashboard's `relative z-10` wrapper (`src/app/page.tsx:3370`), so its `z-[60]` was bounded by a z-10 stacking context and painted **under** the sticky header (z-50, root context) — the SongHost logo stayed visible and the results strip was squeezed. Same class of stacking-context bug as Drive Mode T38. Fix: when search is open on mobile (<768px), the panel is now portaled to `document.body` via `createPortal`, escaping the z-10 trap. Overlay root: `fixed inset-0 z-[200] flex flex-col overflow-hidden bg-[#09090b]` + inline `height: 100dvh` (dynamic viewport height — shrinks when the on-screen keyboard opens, so the results list gets the visible space above the keyboard and scrolls). Safe-area padding top/bottom. `z-[200]` is above the header (z-50) and dock (z-50); Drive Mode (z-[210]) is not reachable while search is open, so no conflict. A 100ms `ignoreDismissRef` guard suppresses the Escape/tap-outside/focus-out dismiss paths right after open so the portal focus-jump doesn't instantly re-close it. The text `< CLOSE` row is replaced by a single small `X` icon top-right. Desktop (≥768px) is unchanged — in-page card, no portal, `absolute z-[100]` dropdown.

**Decision (search control row + marquee help):** On mobile the controls are now two rows: Row 1 = input (`flex-1`) + mic (`h-11 w-11`, no longer full-width) + tuner (hidden on dashboard); Row 2 = full-width PLAY/GENERATE. Fixes the `flex flex-col xs:flex-row` bug (`xs`=480px, so 360px stacked input/mic/PLAY into three rows). The rotating search hint is now a custom `IdleSearchHint` overlay (not a native `placeholder`, which browsers truncate): absolutely positioned over the input, marquee-scrolls only when the text overflows (ResizeObserver-measured), reuses the existing `songhost-marquee` keyframe via `--marquee-shift`, respects `prefers-reduced-motion`, `aria-label` carries the full text for screen readers, `key={rollingPromptText}` restarts it every 5s. Desktop placeholder behavior unchanged.

**Decision (memory rail cue):** `MemoryToolbar` presets were scrollable (`overflow-x-auto`) but `no-scrollbar` hid the cue and `min-w-[72px]` showed only ~1 preset on 360px. Fix: `min-w-[64px]` (two fit), plus left/right fade-edge overlays (`from-[#09090b] to-transparent`) that appear conditionally based on `scrollLeft` vs `scrollWidth - clientWidth` (tracked via `onScroll` + ResizeObserver). No behavior change to tune/save/clear.

**Decision (teleprompter reposition):** `ScriptTeleprompter` was `fixed bottom-[calc(...+7rem)] right-4 z-[60]` — same z as the expanded `MobilePlayerSheet` (z-[60]), so it floated over the sheet's `TransportControls` (Play cut in half, taps hit the panel). A prior 7rem bump didn't clear the transport, which sits higher in the sheet body. Fix: on mobile the teleprompter is now top-anchored `fixed left-2 right-2 top-[calc(env(safe-area-inset-top)+3.25rem)] z-[65] max-h-[40vh] overflow-y-auto` — above the sheet (z-65 > z-60) and never near the bottom transport. Desktop stays bottom-right z-[60], unchanged.

**Decision (sheet chevron):** The expanded-player ⌄ chevron did nothing because it sat inside the drag-handle div whose `onPointerDown={handleDragStart}` calls `setPointerCapture` on the parent — pointer capture stole the synthesized click, so `onClick={close}` never fired (only Escape closed it). Fix: `onPointerDown`/`onPointerUp` `stopPropagation` on the chevron button so the parent doesn't capture for chevron taps. Drag physics unchanged.

**Decision (sticky sub-pills):** Decade/genre sub-pills scrolled with the page and tucked under the sticky header (z-50) → unclickable when scrolling to cards; the scroll arrows were `hidden sm:flex` (hidden on mobile) and `scrollbar-none` hid the native bar → no scroll cue. Fix: sub-pills row is now `sticky top-[calc(env(safe-area-inset-top)+2.75rem)] z-30 bg-[#09090b]` (sticks below the header, solid bg so cards don't show through), and the left/right arrows are `flex` on mobile (visible cue). Top pills (All/Decades/Genres/My Mixes/My Stations) and card carousels unchanged.

**Open (live test):** the sticky sub-pill offset (2.75rem) clears the header; if the sticky search bar (~3rem) covers the stuck sub-pills on the DECADES view, bump the offset to ~5.5rem.

**Code:** `src/components/studio/SearchSection.tsx`, `src/components/search/SmartSearchBar.tsx`, `src/components/MemoryToolbar.tsx`, `src/components/teleprompter/ScriptTeleprompter.tsx`, `src/components/player/MobilePlayerSheet.tsx`, `src/components/studio/StationBrowser.tsx`.

**Not touched (no regression):** audio engine, mix-bus, DirectStream, statutory queue, ROU, `TrackProvider`, `useYouTubePlayer`, `DriveModeOverlay`, `MobilePlayerSheet` drag physics, search API route, launch handlers, `runStationLaunch` `finally`→`onClose`, `dismissMobileSearchAfterLaunch`, `suppressFocusOpenRef` guard, `Cmd/Ctrl+K` handler, `globals.css` (reused existing `songhost-marquee` keyframe).

---

## D26 — Aug 28 2026: STUDIO PUBLISH requires sign-in; mobile polish round (Drive Mode entities/centering, GENERATE scrim, scrolling title, full-screen search, header wrap)

**Decision (publish gate):** `handlePublish` in `src/app/studio/page.tsx` now gates on Clerk `isSignedIn`. A guest hitting PUBLISH STATION gets an inline "Sign in to publish" banner with a Clerk `SignInButton mode="modal"` and **no** cloud POST is attempted — same pattern as memory dials (`MemoryDialBar` `gateTune`/`gateAssign`). The signed-in publish path (POST `/api/studio/save-station` + `saveStudioMix` + share modal) is unchanged. `/api/studio/save-station`, `useStudioStations`, and `UserPreferencesContext` are untouched. Chosen by Larry over a "guest local-only publish" option: keep one clear gate (sign-in) rather than a silent local/no-op split.

**Decision (mobile 360×800 polish, shipped across `f0312fd` / `59dbc51` / `988befa` / `f5bc336`):**
- **Header wrap** — `BrandHeader` wraps to two rows below `sm`; RADIO/STUDIO stay on row 1, FREE/Sign In on row 2. `DevTierBadge` shows short FREE/PRO below `sm`. Signed-in avatar and `sm+` header unchanged.
- **Scrolling title (marquee)** — `TrackMetadata` marquee-scrolls the title and artist/album line when they overflow their box (ResizeObserver-measured); disabled for `prefers-reduced-motion`; screen readers get the full text via `aria-label`. No controls removed; compact row layout unchanged. `globals.css` adds the `songhost-marquee` keyframe.
- **Full-screen mobile search** — on mobile (<768px) search opens as a full-screen dialog that **replaces** the dashboard (no PLAY behind a scrim to dead-tap). Results render in-flow with one scrollbar; a Close button returns to the dashboard. Desktop (≥768px) search keeps its `absolute` dropdown. `SearchResultsBody` extracted shared between both paths.
- **Playlist z-index** — `QueueModal` raised `z-50` → `z-[70]` so Playlist opens in front of the now-playing sheet (`z-[60]`), same band as Host Settings. Not portaled.
- **Drive Mode entities** — YouTube Data API `snippet.title` carries literal HTML entities (`&#39;`/`&bull;`); `cleanVideoTitle` in `src/lib/youtube/youtube-search.ts` now decodes named + numeric entities (two-pass for double-encoding) at ingest. No renderer touched; no `dangerouslySetInnerHTML`.
- **Drive Mode art centering** — the Drive "art" square is the YouTube host iframe (320×200) clipped into a 200×200 box; both saver branches now `flex items-center justify-center` so the 320px iframe centers in the 200px clip (symmetric crop). Visible window stays 200×200 (ToS-safe). Provider/embed-size untouched.
- **GENERATE scrim** — `runStationLaunch` `finally` now calls `onClose`; `SearchSection` `dismissMobileSearchAfterLaunch` suppresses `onFocusCapture` reopen for 300ms after launch. Drawer closes on completion and can't bounce back on post-launch focus restore.

**Code:** `src/app/studio/page.tsx`, `src/components/player/TrackMetadata.tsx`, `src/app/globals.css`, `src/components/search/SmartSearchBar.tsx`, `src/components/studio/SearchSection.tsx`, `src/components/layout/Header.tsx`, `src/components/header/Header.tsx`, `src/components/ControlDeck.tsx`, `src/components/QueueModal.tsx`, `src/lib/youtube/youtube-search.ts`, `src/components/AudioPlayer.tsx`.

**Not touched (no regression):** audio engine, mix-bus, DirectStream, statutory queue, skip limiter, ROU, `TrackProvider`, `useYouTubePlayer`, `embed-size.ts`, `DriveModeOverlay` internals, `MobilePlayerSheet`, `WebPlayer`, search API route, `/api/studio/save-station`, `/api/user/sync`, `user_play_logs`.

---

## D25 — Aug 28 2026: Marketing email opt-in (keep guest playback) + legal pages + admin opted-in list

**Decision (guest playback stays):** Guests keep playing catalog stations, search, radio, Studio, and Drive Mode exactly as today. Login unlocks saving (memory dials, saved stations, cloud sync) — not playback. The guest banner's false "unlock full-track streaming" claim was removed; it now reads "save presets, build your library, and sync across devices." Chosen by Larry over a hard login wall: keep first-listen adoption, capture consent at signup instead.

**Decision (consent capture + storage):** Onboarding modal adds an explicit, **unchecked-by-default** marketing email opt-in ("Email me about new stations and SongHost news."). Choice is staged in `localStorage` (`songhost:marketing-optin`) for guests and persisted to the `users` row on first `/api/user/sync` after sign-in. The DB row is the source of truth; an unchecked skip never mutes an existing grant. New `users` columns: `marketing_opt_in` (boolean, NOT NULL, default false) + `marketing_opt_in_at` (timestamptz, nullable). Migration `drizzle/0000_add_users_marketing_opt_in.sql` (baseline; repo had no prior migrations). `/api/user/sync` `applyMarketingOptIn` persists consent without clobbering an existing grant timestamp when unchanged; a body with only `marketingOptIn` is accepted; omitting the field leaves consent alone.

**Decision (legal + extraction):** `/privacy` and `/unsubscribe` pages added (placeholder legal copy — **owner must supply lawyer-approved wording before sending any email**). `/unsubscribe` lets a signed-in user toggle `marketing_opt_in` off/on via existing `/api/user/sync` (no new endpoint; no email-address opt-out by guessing). Footer links to both. `GET /api/admin/marketing-list` is a read-only, admin-gated (`verifyAdminAccess`) export of opted-in users (`{ id, email, marketingOptInAt }` only), capped at 10000. `scripts/export-marketing-list.ts` CLI mirrors it (JSON/CSV). **No email is sent** by any of this — consent capture and storage only.

**Tier 2 curation also completed this session:** 43 extra-genre stations curated (7 batches), `src/data/station-seeds.ts` now 57 stations / 2561 tracks.

**Code:** `src/components/auth/OnboardingModal.tsx`, `src/lib/db/schema.ts`, `drizzle/0000_add_users_marketing_opt_in.sql`, `src/app/api/user/sync/route.ts`, `src/app/page.tsx` (banner), `src/app/privacy/page.tsx`, `src/app/unsubscribe/page.tsx`, `src/app/unsubscribe/UnsubscribeControls.tsx`, `src/components/Footer.tsx`, `src/app/api/admin/marketing-list/route.ts`, `scripts/export-marketing-list.ts`.

**Open (before sending email):** lawyer-approved privacy/unsubscribe copy; an email-sending integration + per-user unsubscribe token links (`?token=...`); listening-segment joins (opted-in users × `user_play_logs`) for targeted campaigns.

---

## D24 — Aug 27 2026: Orchestrator + Coder Subagent Mode (WORKFLOW.md)

**Decision:** Step 3 execution no longer requires the developer to open a separate chat and paste a prompt. GLM 5.2 (designer/orchestrator) now launches a Grok coder subagent (`cursor-grok-4.6-high-fast`) directly via the Task tool, reviews the diff against the prompt, runs/relays verification, commits, syncs canonical docs, and reports a plain-language summary to Larry. Larry is the approver/reviewer of summaries and deployed results, not the middleman. Surgical-only, directive-only prompts (no pre-written snippets), saved to `public/prompts/` for auditability. Grok never commits/pushes. The 5-Step cycle remains the canonical reference for *what* must happen; this defines *how* Step 3 runs. When the in-session shell is unavailable (Windows sandbox-backend limitation), the orchestrator hands Larry the exact `git` commands.

**Code:** `docs/WORKFLOW.md`.

---

## D23 — Aug 27 2026: Preset preview seeds-only + always-on station art (T40, T41)

**Decision:** (a) Preset station previews show the 40 authored seeds instantly (Fisher–Yates shuffled) and drop the `/api/station-tracks` top-up that caused a ~20s "0 tracks" wait (cold YouTube-ID + MusicBrainz enrichment). Chosen by Larry as **seeds-only** over a background top-up. Trade-off accepted: the 43 extra-genre stations with no deep pool show only their 3 authored seeds in preview (live playback still replenishes from the catalog). A `loading` prop shows "Loading station…" for the Inspired pre-fetch path. (b) The preview-modal header now shows the station name + a 44px card thumbnail (live now-playing art → `stationArtworkUrl` daily pick → seed/cover), stylized to the light modal theme. (c) When a track image 404s (invalid/reused youtubeId on some extra-genre stations), `StationCard` and the modal thumbnail fall back to the station accent-color gradient instead of the gray Disc3 icon — a stopgap until the Tier 2 deep-pool curation workstream (author ~40 real songs + valid YouTube IDs + iTunes artwork per station, batched 5–8 at a time). `shouldUseAccentGradient` (Inspired empty-art path) unchanged.

**Code:** `src/app/page.tsx`, `src/components/StationPreviewModal.tsx`, `src/components/cards/StationCard.tsx`.

---

## D22 — Aug 27 2026: Skip-break timing + stall watchdog (T39) — DRAFT (pending GLM 5.2 finalization)

**Decision:** Three playback intercepts plus YT error-code passthrough. (1) An 8s stall watchdog arms on YouTube `videoId` change (live YouTube path only). First `onPlaying` / skip / unmount / real `onError` clear it; if it fires, `handlePlaybackError()` runs (records the failed ID, falls back to preview or removes the track). Arms on load, not pause/reseek, so a later Mode B lore/`hard_pause` pause cannot false-trigger. (2) A manual skip (`skipNext` → `justSkippedRef`) still runs `planDjSegment` and still commits `nextState` (cadence advances), but a voiced plan is forced silent for that one following track. Already-silent plans are left alone. Suppressed only when `!isSessionOpening` — Track 1 still always gets `full_break` `song_intro`. (3) `onLoreComplete` / `onBreakExit` stamp `restoreRampEndsAtRef = Date.now() + RESTORE_RAMP_MS + 200`; a track that loads while that restore is in flight is forced silent the same way. `RESTORE_RAMP_MS` stays 1500; +200 ms is a margin only. (4) `useYouTubePlayer` `onError` forwards numeric YT codes; `handlePlaybackError` still takes no args.

**Code:** `src/components/AudioPlayer.tsx`, `src/lib/audio/legacy/useYouTubePlayer.ts`.

---

## D21 — Aug 27 2026: Drive Mode containing-block fix (T38) — DRAFT (pending GLM 5.2 finalization)

**Decision:** Drive Mode overlay and the promoted YouTube iframe are descendants of the bottom dock. The dock's `backdrop-blur-xl` creates a CSS containing block for `position:fixed` children, so they were trapped relative to the thin dock bar instead of the viewport (dashboard showed through; video floated wrong). While Drive Mode is on, the dock drops blur and the translucent bg/border and becomes a solid opaque bar at `z-[210]` (normal mode unchanged: `z-50` + `backdrop-blur-xl`). `DriveModeOverlay` drops Prev/Play/Next — the dock is the single set of controls; the overlay owns background + title/artist + a video-slot spacer. The iframe is repositioned bottom-anchored just above the dock (`8rem` / `sm:8.5rem` + safe area), `z-[210]`, 196×110 / 248×140 — not top-center. Same DOM node, no remount. Supersedes T36. Layout fix, not a full YouTube TOS claim.

**Code:** `src/components/ControlDeck.tsx`, `src/components/studio/DriveModeOverlay.tsx`, `src/components/AudioPlayer.tsx`.

---

## D20 — Aug 26 2026: Mothball Spotify catalog calls (phased), Step 1 of 3 (T31)

**Decision:** `POST /api/station/generate` no longer calls Spotify `getRecommendations`. Track lists come from the shared iTunes + Last.fm + YouTube catalog-builder (`fetchGenreTracks` + `finalizeStationCatalog` in `src/lib/station/catalog-builder.ts`) — the same engine as `/api/station-tracks`. Request body and `StationTunerResult` stay the same; Spotify extras (`targetEnergy`, `targetPopularity`, `yearFilter`) are dropped. `catalogDepth` is a source-based deep-cuts proxy (pool size 60–200 + Last.fm similar-artist widening), not a per-track popularity score. `energy` is stored as `energyLevel` and echoed — no precise catalog effect in this step. Spotify library files stay in the repo, not deleted. Other Spotify callers (`/api/song-radio`, `/api/recommendations`, `/api/search`, `/api/user/top-tracks`) are unchanged. No cache on generate (one-shot fresh builds). Steps 2–3 remain: song-radio/search, then user top-tracks.

**Code:** `src/app/api/station/generate/route.ts`, `src/lib/station/catalog-builder.ts`, `src/lib/station-genre-profiles.ts` (0–100 → pool 60–200), `src/components/studio/TuneStationPanel.tsx` (`StationTunerResult`).

---

## D19 — Aug 26 2026: AI-curated “Inspired” stations from a search launch (T29)

**Decision:** After a searchbar launch, a parallel `POST /api/inspired-stations` (one `gpt-4o-mini` JSON call) returns 5 session-ephemeral blueprints on an “Inspired” pill (auto-selected). Cards stream in with a staggered fade (`INSPIRED_CARD_STAGGER_MS = 120`). Click resolves tracks via `POST /api/station/generate` and the Advanced Tuning launch path. Save persists a blueprint to My Stations. Statutory non-interactive radio — blueprints only; no licensing model change.

**Code:** `src/app/api/inspired-stations/route.ts`, `src/lib/inspired-stations.ts`, `src/components/studio/StationBrowser.tsx`, `src/components/cards/StationCard.tsx`, `src/app/page.tsx`.

---

## D18 — Aug 26 2026: Station card artwork rotation (T28)

**Decision:** Idle decade/genre/saved cards use a deterministic cover-of-the-day (YouTube thumbnail from station tracks: `hashStationId(station.id) + daySeed`). The active card shows live now-playing art and falls back to the daily pick when idle. Custom `coverUrl` stays fixed. Studio Mix cards (`mixArtworkUrl`) are unchanged. Brief fade-in on artwork change.

**Code:** `src/components/studio/stationArtwork.ts`, `src/components/studio/StationBrowser.tsx`, `src/components/common/ArtworkImage.tsx`.

---

## D17 — Aug 26 2026: Natural Pace “Always tell me what’s playing” toggle (T27)

**Decision:** New global preference `UserPreferences.alwaysAnnounceSongs` (default ON), shown in Host Settings only for Natural Pace (`short_breaks`). When ON, the scheduler keeps a session ledger of announced songs: long-intro (≥3s) silent-gap tracks get a ducked song ID (does not reset lore cadence); 2+ unannounced short-intro tracks get a catch-up recap on the next full break. When OFF, Natural Pace is unchanged (silent gaps, breaks every 2–4, only some songs named). No station-level override.

**Code:** `src/types/user.ts`, `src/lib/dj/scheduler.ts` (`announcedTrackIds`, `canDuckAnnounce`, `buildCatchUpRecapPlan`), `src/components/player/HostSettingsModal.tsx`, `src/components/player/HostBar.tsx` (`AlwaysAnnounceSongsToggle`).

---

## D16 — Aug 26 2026: “Every Song” rework; weather once-per-session; city only with weather (T24–T26)

**Decision:** Talkative pacing voices every track from 2 onward with a song ID. Extended formats get lore (`artist_trivia`, or weather/concert when those take priority); standard format is a quick song ID only. A station-ID sweeper plays every 3–5 songs **with** the song ID (`includeStinger`), not instead of it, and never with lore. The old every-other-song “sweeper with no title” pattern is gone (`talkative.alternateStinger = false`). Weather `local_events` fires at most once per session (songs 3–10). `homeCity` is used only for weather/concert; no casual city banter; Time Capsule “city” means the track’s scene, not home. Auto-geolocation no longer drives local content; manual `homeCity` only.

**Code:** `src/lib/dj/scheduler.ts`, `src/types/station.ts` (`CHATTER_PACING_PROFILES.talkative`), `src/lib/dj/promptBuilder.ts` (`time_capsule` scene-city rule; weather banter ban), `src/lib/dj-intro.ts` (`homeCityForScriptRequest`), `src/lib/location/weather.ts`.

---

## D15 — Aug 26 2026: YouTube viewer always-on + ambient art; mobile deck transport-only; Drive Mode keeps video visible (T19–T23)

**Decision:** The dock YouTube viewer is always visible at 320×200 (no off-screen hide) with an ambient blurred-album-art background. Test caption and header YT View toggle are retired (`src/lib/youtube/viewer-toggle.ts` remains in-tree, unused). Mobile compact deck is transport-only (now-playing + Play/Next + Drive Mode); like/ban and Host Controls move to the expanded sheet. Drive Mode overlay (`z-[200]`) reserves the bottom dock so video + small transport stay visible (`pb-[340px] md:pb-[300px]`). Dock z-index is conditional: `z-50` normally, `z-[210]` only while Drive Mode is active. Decade/genre sub-pills are a single-row horizontal slider.

**Code:** `src/components/AudioPlayer.tsx` (`yt-player-host`), `src/components/ControlDeck.tsx`, `src/components/studio/DriveModeOverlay.tsx`, `src/components/player/MobilePlayerSheet.tsx` (`hostControlsSlot`), `src/components/studio/StationBrowser.tsx` (sub-pills).

---

## D14 — Aug 26 2026: Dashboard condensed to one station row; mic voice search; Advanced Tuning hidden (T17/T18)

**Decision:** Dashboard top is: top nav → search (mic dictation via Web Speech API `useVoiceSearch`) → Memory bar → one `StationBrowser` row with All / Decades / Genres / My Mixes / My Stations pills + decade/genre sub-pills. Four station rows collapsed into one. Memory bar sits directly below search. Advanced Tuning icon is hidden (`onToggleTuner` not passed); the Spotify-recommendations error on that path was not fixed, only hidden; tuner code and `POST /api/station/generate` are retained. (T31 later rewired generate off Spotify; the icon stays hidden.)

**Code:** `src/components/studio/StationBrowser.tsx`, `src/hooks/useVoiceSearch.ts`, `src/components/search/SmartSearchBar.tsx`, `src/app/page.tsx`.

---

## D13 — Aug 25 2026: Host Studio Vibe Chips (WS-5)

**Decision:** Vibe Chips are one-click presets that write the existing `vibePrompt` field — not a parallel chip store, not a separate directive, not a new persisted key. One source of truth: `vibePrompt` → `buildVibeDirective`. Pro gets 5 chips + a custom text box (single-select, replace). Free gets 1 teaser chip that colours the next 1–2 voiced breaks via a session-scoped preview window, then reverts and opens the existing upgrade modal. The 5 Pro chips stay visible but locked for Free (same Pro lock language as WS-4 `RootsTeaserBadge`).

**Behavior:** Single-select, replace — one chip active at a time; picking a chip replaces the text box content; typing anything that is not an exact chip string clears the highlight. Pro persists via the existing `setStationConfig` → 400ms `setVibePrompt` debounce. Free persisted `vibePrompt` stays `""`. Chips colour tone via `buildVibeDirective` after persona / era / vernacular — they do not replace those axes.

**Initial chip set (designer may retune strings after ear test):**

| Label | Vibe string written into `vibePrompt` |
|-------|----------------------------------------|
| Late Night | intimate, hushed, after-hours warmth — like a 3 AM drive-time host |
| Hype | big energy, fist-pump, like a peak-hour floor-filler set |
| Storyteller | narrative, set the scene, lean into the story behind the track |
| Deep Cuts | lean into the obscure, the B-sides, the forgotten takes |
| Front Porch | easygoing, conversational, like a friend on the porch |

**Free teaser:** previews **Late Night**. Session representation: module-level `{ vibe, remainingBreaks }` in `src/lib/dj/vibePreview.ts` (default `VIBE_PREVIEW_VOICED_BREAKS = 2`). Independent of WS-4 `teaserSlotCount`. Never written to `stationConfigs.vibePrompt` / cloud JSONB — verified by a no-leak test asserting the serialized cloud payload does not contain the preview vibe string. `clampHostTuningForTier` still forces Free `customDirectives = ""` unless the generate-script request sets `vibePreviewActive: true`. Mid-session Pro → Free downgrade strips persisted `vibePrompt` from every station config and ends the preview window.

**Open for designer (ear-test round):** (1) keep 2 voiced breaks or drop to 1? (2) keep Late Night as the teaser or pick another chip? (3) retune any of the five strings after a live ear test? (4) any copy change on the Host Studio chip row / teaser button?

**Code:** `src/data/vibe-chips.ts`, `src/lib/dj/vibePreview.ts`, `src/lib/dj/scriptGenerator.ts` (clamp exception), `src/app/api/generate-script/route.ts`, `src/lib/dj-intro.ts`, `src/lib/audio/legacy/webOrchestrator.ts`, `src/components/player/HostSettingsModal.tsx`, `src/components/player/HostBar.tsx`, `src/context/UserPreferencesContext.tsx`, `src/types/station.ts`, plus tests.

**Not touched (no regression):** Pavlovian two-clip FSM, duck constants (18% / 300ms / 1500ms), `useStationQueue`, `DirectStreamProvider`, `performance-commit.ts`, persona migration, `sessionOpeningDjRef` invariant, ChatterPacing windows, WS-3 vernacular injection (reused, not refactored), WS-4 `roots_teaser` cadence, `FREE_MONTHLY_BREAK_LIMIT`.

**Not verified:** A live Pro session applying a chip and hearing the next break take that colour; a live Free teaser → two breaks → upgrade nudge. Deferred to the post-WS-3/4/5 tuning round (`docs/TUNING_BACKLOG.md`).

---

## D12 — Aug 25 2026: Roots & Branches Pro Teaser (WS-4)

**Decision:** Free listeners hear a short Roots & Branches *teaser* on every 7th voiced break. The full `roots_branches` commentary format stays Pro-gated (`clampHostTuningForTier` still forces Free `lore: "standard"`). The teaser is a new `DjSegmentKind` `"roots_teaser"` — not a `commentaryFormat` value and not a flag on `song_intro` — so it stays out of `isLoreSegmentKind` / the Pavlovian two-clip path. This representation was chosen because a flag on a `song_intro` would have fallen into the Pavlovian two-clip sequence, and a new `commentaryFormat` value would have fought the Free clamp that forces `standard`; a new kind stays out of both while still occupying the voiced slot ChatterPacing already scheduled.

**Cadence:** Session-scoped `teaserSlotCount` increments on each voiced break when `isPro === false`. Hit 7 → that slot becomes a teaser instead of the standard/stinger plan, then the counter resets. ChatterPacing windows are unchanged; the teaser occupies the voiced slot they already scheduled. `FREE_MONTHLY_BREAK_LIMIT` stays `Number.POSITIVE_INFINITY` (re-tying teasers to a 30-break paywall is T6 in `docs/TUNING_BACKLOG.md`, a separate strategic decision — not WS-4).

**Script shape:** teaser earcon (`/audio/earcons/teaser/open.mp3`, fail-closed) → one clip (single-clip Mode A, NOT the Pavlovian two-clip sequence): (1) 14–18 word musicology taste from the assigned pillar, (2) in-character sign-off that softly names Roots & Branches on Pro (no "upgrade now" / subscribe / click-to-unlock — character-first, not an ad), (3) vernacular-coloured contextual outro. Whole clip ≤ 36 words. Persona voice and WS-3 genre vernacular still apply; anti-repetition still applies.

**Tier:** Pro never hears the teaser and the counter does not run. Mid-session Free → Pro clears `teaserSlotCount`, drops pending/warmed teasers, and aborts a teaser that has not started speaking; a teaser already on air is left to finish.

**Visual:** Inline "Pro Preview" badge (`RootsTeaserBadge`, existing Pro accent language) on the teleprompter, live transcript row, and Drive Mode while the teaser is on air — not on full Pro `roots_branches`, not after the break ends.

**Code:** `src/types/dj.ts` (`roots_teaser`, `isRootsTeaserKind`), `src/lib/dj/scheduler.ts` (`ROOTS_TEASER_VOICED_INTERVAL = 7`, `applyRootsTeaserCadence`), `src/lib/dj/earcon.ts` (`EARCON_TEASER`), `src/lib/dj/promptBuilder.ts`, `src/app/api/generate-script/route.ts`, `src/lib/dj-intro.ts`, `src/lib/audio/legacy/webOrchestrator.ts`, `src/components/AudioPlayer.tsx`, `src/components/player/HostBar.tsx` (`RootsTeaserBadge`), `src/components/teleprompter/ScriptTeleprompter.tsx`, `src/components/history/BroadcastHistoryDrawer.tsx`, `src/components/studio/DriveModeOverlay.tsx`, plus tests.

**Not touched (no regression):** Pavlovian two-clip FSM, duck constants (18% / 300ms / 1500ms), `useStationQueue`, `DirectStreamProvider`, `performance-commit.ts`, persona migration, `sessionOpeningDjRef` invariant, ChatterPacing windows, WS-3 vernacular injection (reused, not refactored), `FREE_MONTHLY_BREAK_LIMIT`.

**Not verified:** A live Free session playing through seven voiced breaks (earcon + taste + sign-off + outro + badge, then reset) was not run on-air. Deferred to the post-WS-3/4/5 tuning round (`docs/TUNING_BACKLOG.md`).

---

## D11 — Aug 25 2026: Genre Vernacular — invisible, LLM-generated, prompt-layer only (WS-3)

**Decision:** Genre vernacular is the third axis on the dial (Voice / Persona / Vernacular). It is an **invisible prompt-layer** steer, not a feature or a knob. The station's resolved scene (e.g. "classic country", "Britpop") is threaded into `DJPromptContext.genreScene` and a `buildVernacularDirective` tells the model to speak like someone who lives inside that scene — native vocabulary, cadence, and reference points, not a tourist. The model generates fresh vernacular each break; no phrases are injected.

**Architecture (agreed, not redesigned here):** LLM-generated, not hardcoded phrase lists (the canned `Record<genre, string[]>` approach was rejected — it goes stale and sounds robotic). Directive-only. The existing anti-repetition engine (`recentBreakHistory`, last 6 aired scripts) is the single source of truth — extended to also ban reused genre slang, scene nicknames, and vernacular catchphrases. No parallel vernacular repetition store.

**Scope:** Applied to every LLM-spoken surface — DJ lore clips, DJ announcement clips (colour the name-drop only; still title + artist, no extra lore), weather asides, concert callouts, LLM station stingers. Canned Track-#0 launch liners (non-LLM templates) and Studio `customText` (TTS-only) are left alone. Scene resolution reuses `getStationGenreProfile` via `resolveGenreSceneLabel` — no second genre table. Missing/unresolvable scene → directive omitted (fail open, never block a break).

**No UI / no Pro gate / no persistence change:** No Host Studio knob, no Pro gate, no preferences or migration change. Vernacular is derived at prompt-build time from the active station, not stored.

**Code:** `src/types/dj.ts` (`genreScene`), `src/lib/station-genre-profiles.ts` (`resolveGenreSceneLabel`), `src/lib/dj/promptBuilder.ts` (`buildVernacularDirective` + injection + anti-rep extension), `src/app/api/generate-script/route.ts` (resolve scene; inject on lore and legacy paths), `src/lib/dj-intro.ts`, `src/lib/dj/prefetchEngine.ts`, `src/components/AudioPlayer.tsx`, `src/app/page.tsx`, `src/lib/audio/legacy/webOrchestrator.ts` (pass `stationId` / `seedGenres` so the server resolves the scene — payload only; no FSM/duck/queue change), plus tests.

**Not touched (no regression):** Pavlovian two-clip FSM, duck constants (18% / 300ms / 1500ms), `useStationQueue`, `DirectStreamProvider`, `performance-commit.ts`, persona resolver/migration, `sessionOpeningDjRef` invariant, ChatterPacing windows.

**Not verified:** A live multi-genre session (Britpop vs country vs jazz, consecutive breaks) was not run — needs the app on-air with the LLM. Deferred to the post-WS-3/4/5 tuning round (see `docs/TUNING_BACKLOG.md`).

---

## D10 — Aug 25 2026: Pavlovian two-clip break architecture (earcon → gap → lore → ducked announcement); Host Studio display fixes (Free voice label, Pro-persona clamp)

**Decision:** Two workstreams shipped together (WS-6 Part A + Part B).

1. **WS-6 Part B — Pavlovian Architecture.** Lore-type breaks (`song_intro`, `artist_trivia`, `local_events`) are split from one speech clip into two: an earcon cue → ~500ms commentary gap → **lore clip** (spoken in the gap after song A, not ducked) → track B starts → duck to 18% over 300ms → **announcement clip** (track name + artist, over the ducked bed) → restore over 1500ms. Stinger, recap, and up_next stay single-clip. Earcon selection by sub-kind: `lore/open` for song_intro/artist_trivia, `weather/open` vs `concert/open` for local_events via a new `localEventSubkind` field on `DjSegmentPlan`. `teaser/open.mp3` is reserved for WS-4 and not wired. Two TTS calls per lore break; word caps split (opening lore ≤32 + announcement ≤13; mid-session lore ≤20 + announcement ≤13). Anti-repetition (`excludedFacts` / `user_lore_history`) stays on the lore clip. Fail-closed: missing earcon skips to the lore clip; a failed announcement clip restores track B so the listener is never left ducked. Session-opener (track 1) plays welcome lore before the track, then ducks and announces.

2. **WS-6 Part A — Host Studio display fixes.** (A1+A3) A Free listener whose saved persona resolves to a Pro persona no longer sees it selected in the Host Studio modal; selection is clamped to Standard Broadcast via `getEffectivePersona`, Pro cards stay locked, and a note explains the lock. Persisted `activePersonaId` is unchanged. (A2) The Free player bar now shows the selected OpenAI voice label (per the `resolveHostDisplayName` code comment's intent); Pro still shows the persona name.

**Pre-existing inconsistency (not a WS-6 regression):** The companion (DirectStream / iTunes preview) announcement path uses Mode A's 600ms duck ramp / 800ms swell, not the SOP's 300ms / 1500ms. The YouTube live dial uses mix-bus 300/1500 (correct). Aligning the companion path is a follow-up.

**Code:** `src/lib/dj/earcon.ts` (new), `src/types/dj.ts`, `src/lib/dj/scheduler.ts`, `src/lib/dj/promptBuilder.ts`, `src/lib/dj/scriptGenerator.ts`, `src/lib/dj-intro.ts`, `src/lib/dj/prefetchEngine.ts`, `src/lib/audio/dj-prefetch.ts`, `src/lib/audio/legacy/webOrchestrator.ts`, `src/lib/audio/legacy/useWebOrchestrator.ts`, `src/app/api/generate-script/route.ts`, `src/components/AudioPlayer.tsx`, `src/app/page.tsx`, `src/components/player/HostBar.tsx`, `src/components/player/HostSettingsModal.tsx`, plus tests.

**Not touched (no regression):** `mix-bus.ts` (duck 18% / 300ms / restore 1500ms / headroom 1.35), `useStationQueue`, `DirectStreamProvider`, `performance-commit.ts`, persona resolver / migration, `sessionOpeningDjRef` invariant (still armed only on `stationId` / `queueGeneration` change), ChatterPacing windows.

---

## D9 — Aug 25 2026: OpenAI voice catalog swap (13 voices, gpt-4o-mini-tts); ElevenLabs mothballed from live dial; 4-persona reconstruction; DjPersonality + DjMood removed; Pro tier reintroduced for host personality

**Decision:** Three workstreams shipped together (WS-1 + WS-2 + WS-2.1).

1. **WS-1 — OpenAI voice catalog swap.** Free and Pro now share OpenAI's full 13-voice `gpt-4o-mini-tts` catalog (ash, ballad, cedar, coral, sage, marin, verse added to the original 6). `gpt-4o-mini-tts` chosen over `tts-1` for the `instructions` parameter (steerable prosody) at negligible cost difference. ElevenLabs is mothballed from the Host Studio live dial (UI picker removed, `ttsProvider` hardcoded `"openai"` on the live path) but kept in-tree for admin-only WS-7 Director's Cut pre-renders. 2000-char input limit enforced via `assertOpenAiTtsInputLength`.

2. **WS-2 — Persona reconstruction.** The 6 named hosts (Henry, Sloane, Miles, Devon, Kira, Jasper) plus the `DjPersonality` / `DjMood` overlay are replaced by **4 character-driven personas**: Standard Broadcast (Free), Warm Companion / Sarcastic Critic / The Musicologist (Pro). The live dial is now 3 independent axes — **Voice** (all 13, never gated), **Persona** (1 Free + 3 Pro), **Vernacular** (WS-3, not built here). Each persona carries a `systemPrompt` (LLM writes the words) and a `ttsInstructions` string (steers `gpt-4o-mini-tts` delivery — e.g., Sarcastic Critic sounds deadpan, not politely AI). Genre no longer picks the host; new stations default to Standard Broadcast. Artist Radio maps scenes to the closest persona as a bridge. Saved-station migration maps old host ids → new personas via `LEGACY_PERSONA_ALIASES`; the listener's stored `preferredVoice` is never rewritten (`LEGACY_PERSONA_VOICE` is fallback only). Visualizer palettes remapped: Standard Broadcast = new Studio Amber; the 3 Pro personas inherit the closest old host's palette.

3. **WS-2.1 — ProUpgradeModal copy fix.** Upgrade pitch updated from the dead 6-host / ElevenLabs line to the 3 Pro personas + steerable delivery.

**Pro tier reintroduced.** `STRATEGIC_PLAN_V1.md` §10 previously stated "Free app, full stop. No Pro tier." Spotify SDK limitations forced a Pro tier back for host personality and format features. Music and commentary are never gated — Pro gates host persona, format, and (WS-3+) vernacular / vibe-chip surfaces.

**Code:** `src/data/personas.ts`, `src/types/dj.ts`, `src/types/user.ts`, `src/types/station.ts`, `src/lib/dj/personaConfig.ts`, `src/lib/dj-resolver.ts`, `src/lib/dj/promptBuilder.ts`, `src/lib/dj/scriptGenerator.ts`, `src/lib/dj/voice-settings.ts`, `src/lib/tts.ts`, `src/types/voice.ts`, `src/app/api/generate-voice/route.ts`, `src/app/api/generate-script/route.ts`, `src/app/api/studio/voice-preview/route.ts`, `src/app/page.tsx`, `src/components/AudioPlayer.tsx`, `src/lib/audio/legacy/useWebOrchestrator.ts`, `src/lib/audio/legacy/webOrchestrator.ts`, `src/components/player/HostBar.tsx`, `src/components/player/HostSettingsModal.tsx`, `src/components/player/ProUpgradeModal.tsx`, `src/lib/visuals/theme-palette.ts`, plus migration paths in `src/lib/user/preferences.ts`, `src/lib/saved-stations.ts`, `src/lib/station/*`, `src/lib/artist-radio.ts`, `src/lib/studio/manifest.ts`, `src/data/stations.ts`, `src/data/extra-genres.ts`, `src/data/extra-decades.ts`.

**Not touched (no regression):** `useStationQueue`, `DirectStreamProvider`, `mix-bus.ts` (still duck to 18% over 300ms, restore over 1500ms), `performance-commit.ts`.

---

## D8 — Aug 24 2026: 5s prompt rotation; 200 prompts with expanded genre coverage; per-track trash restored; stronger search prominence

**Decision:** Slow the idle rolling-prompt rotator to **5s** (`IDLE_PLACEHOLDER_MS = 5000`). Expand `SEARCH_PROMPTS` from 100 to **200** (ids 1–200, **40 per mode**). New coverage: country, roadhouse blues, bluegrass, gospel, Americana, classical/film-score, Afrobeat, Latin (salsa/cumbia/mariachi), funk, disco, new wave, grunge, trip-hop, ambient, rockabilly, neo-soul, desert blues. Restore per-track trash: `QueueModal` shows remove on **every** row; `removeTrack` no longer early-returns on future indices (drag-reorder stays upcoming-only). Strengthen search prominence (confident, not loud) and change the headline to **YOUR STATION STARTS HERE.**

**Code:** `src/components/search/SmartSearchBar.tsx`, `src/data/search-prompts.ts`, `src/hooks/useStationQueue.ts`, `src/components/QueueModal.tsx`, `src/components/studio/SearchSection.tsx`.

---

## D7 — Aug 24 2026: Removed floating FREE pill + FULL SONGS toggle; Song Radio now always resolves full YouTube IDs; search bar gets 100 randomized rolling prompts + prominence treatment; memory hint becomes hover/tap tooltip.

---

## D6 — Aug 24 2026: Statutory §114 caps, skip limiter, and queue obfuscation DEFERRED

**Decision:** Disable (do not delete) SongHost’s self-imposed SoundExchange §114 admission caps, skip limiter, and upcoming-queue obfuscation so we can ship YouTube as the player under a **listener-driven curation** model. Restore listener controls (prev, jump-to, reorder upcoming, insert-next, shuffle remaining). Show the real upcoming queue. Restore search pills **Artist Mix** and **Full Album**. Keep ROU / `user_play_logs` logging. Keep `statutory-rules.ts` and `skip-limiter.ts` in-tree as pass-throughs for possible later re-use.

**Rationale:** A YouTube-curation product does not need §114 self-limiting. The statutory path stays available if the catalog/transport swap happens later. This does **not** change YouTube’s own terms (ducking / talk-over / background-play remain separate issues).

**Not decided:** DirectStream as the live dial; SoundExchange filings; re-enabling caps.

**Code:** `validateStatutoryAdmission` / `filterStatutoryAdmissions` always admit; `canSkip` / `recordSkip` always allow; `useStationQueue` listener controls restored; `QueueModal` shows real upcoming rows and allows upcoming drag-reorder; search pills + `onLaunchAlbum` → `launchAlbumDeepDive`. Prompt: Step 3 Surgical Fix Execution (unwind statutory rules + restore search curation pills), Aug 24 2026.

---

## D5 — Aug 24 2026: Taste embed vs watch — hidden-player ads hypothesis fails; do not productize dry embeds

**Decision:** Record Larry’s Aug 24 Chrome tests as the empirical result for D4’s open ads question. Update `docs/MUSIC_PROVIDER_ANALYSIS_YOUTUBE.md` to match. Do **not** treat “no ads in the IFrame” as a product feature or a reason to keep the player hidden.

**Evidence:**
- SongHost, YT View **on** (visible 320×200), not signed into YouTube or SongHost, free mode: Artist Radio played `z9Q9OzL_wI8` (Sabrina Carpenter – Taste, Official Lyric Video) and other full-length IDs. `[YouTubeViewer]` showed `PLAYING` with content duration immediately, `ENDED` matching `dur`, `visible=true`. No in-stream ad observed. No pre-roll fingerprint.
- youtube.com `/watch?v=z9Q9OzL_wI8` in the same Chrome world: Larry saw an ad. Console shows the same DoubleClick `viewthroughconversion` / `followon_view` pixel that also fired in the embed when no ad was seen — so that pixel is measurement, not “an ad played.”
- Same profile got an ad on the watch page, so a profile-wide YouTube ad blocker is unlikely. MetaMask `contentscript.js` noise is on both surfaces.

**What this closes:** The §4 hypothesis that the hidden / 180px player was the *reason* Taste had no ads. Visible 320×200 still had no in-stream ad; the watch page of the **same id** did. Remaining question is embed vs watch-page ad serving, not “are we blocking ads” (we are not).

**Still not decided (same as D4):** Whether YouTube stays a shipping provider, whether the player stays visible in production, or how to handle ads/DJ collision. DJ pause/duck (`hard_pause` / `intro_ramp`) still ran in the visible test and remains a terms problem.

**Protocol / details:** `docs/MUSIC_PROVIDER_ANALYSIS_YOUTUBE.md` §2–§4, §9.

---

## D4 — Aug 24 2026: YouTube dock viewer is a test harness, not a product surface

**Decision:** Add a surgical, default-off **YT View** toggle (header, left of FREE MODE) that restyles the existing YouTube IFrame into the bottom dock at 320×200 and calls `player.setSize`. The iframe MUST NOT remount. This exists only to run the visible vs hidden ads test on Premium and non-Premium accounts.

**Not decided:** Whether YouTube stays a shipping provider, whether the player stays visible in production, or how to handle ads/DJ collision. Empirical ads result is in D5 / `docs/MUSIC_PROVIDER_ANALYSIS_YOUTUBE.md`; those product questions remain open.

**Code:** `src/lib/youtube/viewer-toggle.ts`, `src/lib/youtube/embed-size.ts`, `DevTierBadge` in `src/components/header/Header.tsx`, host class swap in `AudioPlayer.tsx`, `YouTubeTrackProvider.setViewerLayout` / `setSize` in `TrackProvider.ts`. Storage key `songhost_youtube_viewer`.

**Protocol:** `docs/MUSIC_PROVIDER_ANALYSIS_YOUTUBE.md` §10.

---

## D3 — Aug 22 2026: Discrepancy #1 truth established; four docs corrected

**Decision:** Adopt the read-only Grok audit (Aug 22 2026) as the verified ground truth for the audio transport, and correct every doc that contradicted it.

**Truth established (verified against code):**
- The **live dial transport is the YouTube IFrame** (`useYouTubePlayer` → `YouTubeTrackProvider`).
- Preset seeds (`station-seeds.ts`), Artist Radio, Album Radio, AI Curator, and `/api/station-tracks` stamp `youtubeId` in production.
- `resolveDirectStreamUrl` refuses any row that already has a `youtubeId`, so `AudioPlayer` selects `YouTubeTrackProvider` for those rows.
- `DirectStreamProvider` is the **target** statutory bus. It attaches only on rows with HTTP `streamUrl`/`previewUrl` and no `youtubeId` — today only the search-launched station path with "Full Songs (Dev)" off (30s iTunes previews).
- The "Full Songs (Dev)" toggle does **not** gate the dial — it only gates `/api/song-radio` and `/api/recommendations` YouTube lookups (env-gated: `NODE_ENV=development` or `NEXT_PUBLIC_ENABLE_DEV_TOGGLE=true`).
- Pocket mode is **already broken** on the dial (cross-origin iframe; Web Audio can't tap; iOS/Android pause on lock).
- Spotify and Apple MusicKit are quarantined under `src/lib/audio/legacy/`; YouTube is **not** quarantined — it is the current dial.

**Docs corrected:**
- `docs/ARCHITECTURE.md` — 7 edits (opening, §1 overview, tech-stack table, §2.1, §3, YouTube invariant label, invariant 21).
- `docs/AUDIO_ORCHESTRATION_SPEC_2.md` — 3 edits (header, quarantine rule, invariant 21).
- `docs/ROADMAP.md` — 3 edits (Phase 5 status, quarantine line, Step 5A checkbox corrected from `[x]` to `[~]`).
- `docs/WORKFLOW.md` — 4 edits (active milestone, single-transport priority, SOP audit rule, state priority contract).

**Not touched (already accurate):** the Song Radio rows in `ARCHITECTURE.md` (498, 625, 637) and `WORKFLOW.md` lines 8–12.

**Rationale:** Docs were asserting DirectStream as the live bus, which is false today. Keeping docs as the source of truth requires they describe current reality, not the target. The target is preserved in every edit as the explicit goal.

---

## D2 — Aug 22 2026: Cursor rule `agent-discipline.mdc` created

**Decision:** Add a workspace rule codifying two disciplines: (1) verify claims against code before stating them as fact; (2) make no unagreed edits to project docs — propose the exact change and get approval first.

**File:** `.cursor/rules/agent-discipline.mdc`

**Rationale:** Doc drift happened because earlier assertions about the transport were not checked against the code. The rule makes verification and change-control the default for future sessions.

---

## D1 — Aug 22 2026: "Song Radio" spoken-brand leak fixed; Artist Radio / Artist Mix parked

**Decision:** Route the stinger spoken path through `resolveSpokenStationBrand` so a station whose spoken brand differs from its display name is announced correctly. Artist Radio and Artist Mix still leak the raw display name and are **not** fixed in this pass.

**Rationale:** The stinger path was the highest-traffic leak. Artist Radio / Artist Mix need their own brand-resolution handling and were parked to avoid a rushed, inconsistent fix; they are flagged for the search-redesign cleanup note.

**Status:** Stinger path fixed. Artist Radio / Artist Mix — open.
