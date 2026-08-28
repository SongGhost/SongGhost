# SongHost — Tuning Backlog (post-WS-3/4/5 round)

**Status:** Living document. Read this before the big tuning round that follows WS-3, WS-4, and WS-5.
**Owner:** GLM 5.2 (designer) proposes; Larry approves; Grok implements.
**Last updated:** Aug 27 2026

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

**Status: DEFERRED (code-verified Aug 25 2026; revisit pre-production).** The original rationale ("restore the cost-saver to the most common break type, the song intro") is **stale after T7/T8/T9**: `song_intro` is no longer Pavlovian (it is a single-clip templated liner for the opener, single-clip TTS for mid-session). The remaining Pavlovian kinds (`artist_trivia`, `local_events`) fire mid-session, where `previousTrack` / `recentHistory` are almost always present (`src/app/api/generate-script/route.ts:1131-1134` derives `previousTrack` from `recentHistory`; the companion path always passes `recentHistory = sessionPlayedRef.current.slice(-2)`). That makes `baseContextAware` true (`route.ts:1225-1240`), so the `!contextAware` cache gate (`route.ts:1264` and `:1448`) never opens mid-session. Net effect: the `cached_lore_breaks` table effectively never fires today, and extending it to two clips would deliver near-zero savings. Larry's call: defer until closer to production; let the ear test evaluate; revisit whether a lore-only cache (decoupled from the announcement, with an anti-repetition guard) is worth the schema migration.

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

---

## First live ear-test findings (Aug 25 2026)

**Source:** Larry's first full-stack ear test after WS-1–WS-5 shipped. All items below were verified by GLM 5.2 against the code this session before logging. File/line refs are current as of Aug 25 2026.

### Verified bugs

**T7 — Earcon fires AFTER the track starts, not in the pre-track silence.**
**Status: RESOLVED (Step 3 surgical fix, Aug 25 2026).** The opener is no longer a Pavlovian two-clip `song_intro`. Track 1 is a single ducked liner (`intro_ramp`: song starts, then one DJ clip; `hard_pause`: short station-ID in silence, then hard-launch). Mid-session `song_intro` is also single-clip with no earcon. Pavlovian gating of Track B until lore completes remains the contract for `artist_trivia` / `local_events` only.

**T8 — No earcon on the session opener (first song of a playlist / station switch).**
**Status: RESOLVED (Step 3 surgical fix, Aug 25 2026).** `isLoreSegmentKind` no longer includes `song_intro`. `resolveEarconSrc({ kind: "song_intro" })` returns null. The opener is a single rotated liner with no earcon.

**T9 — Earcon scope too wide (fires on every lore-type break, not just lore/weather/concert).**
**Status: RESOLVED (Step 3 surgical fix, Aug 25 2026).** Earcons fire only for `artist_trivia`, `local_events` (weather or concert), and `roots_teaser`. Plain `song_intro` (opener and mid-session) has no earcon.

**T10 — "You just heard…" recap names an old-station track on switch.**
**Status: RESOLVED (code-verified Aug 25 2026; live re-confirm on next ear test).** Live-path recap history is wiped on station switch (`sessionPlayedRef.current = []` in `src/app/page.tsx:769` for the companion path; prefetch buffers cleared in `useStationQueue.ts:467` and `AudioPlayer.tsx:747`). Post T7/T8/T9 the opener is a templated liner with no recap, so track 1 of a new station cannot name a previous track. The `actualPlaybackHistory` named in the original entry lives only in quarantined `webOrchestrator.ts`, which is not the live dial.

**T11 — Raw `<break time="300ms"/>` SSML tag visible in the Broadcast Log transcript.**
**Status: RESOLVED (code-verified Aug 25 2026).** `startDjSegment` now runs `stripAllSsmlTags` on the trimmed script before storing it and deriving teleprompter `lines`, so the Broadcast Log and teleprompter show display-ready text (breaks become `...`).

### Not a bug (verified — no action)

**N1 — Multiple earcons stacking (weather + concert + lore at once).**
A single break is one `DjSegmentKind` only. `local_events` carries a single `localEventSubkind` of either `"weather"` *or* `"concert"` (`src/types/dj.ts:235`) — never both in one break. So you cannot get weather + concert + lore stacked in a single break with overlapping earcons. At most one earcon per break. Across *consecutive* breaks you could hear a weather earcon then a concert earcon back-to-back, which is by design. No fix needed.

### Verified design questions (decisions needed)

**T12 — Location: restore a manual Broadcast City override; tiering TBD.**
**Status: RESOLVED (Aug 26 2026).** Broadcast City input mounted in Host Settings; local content (weather/concerts/city) now driven solely by manual homeCity; auto-geolocation no longer drives local content; no IP-geo fallback when homeCity is blank. **Open (tiering only):** is entering a home city a Pro feature or Free? Larry's lean: probably not too useful for Free except the teasers — discuss tiering in the tuning round.

**T13 — Song Radio / Artist Radio payload yield + seed-artist weighting.**
Two curation paths, **different targets** (verified Aug 25 2026, corrected after console-log review):
- **AI Curator** (`/api/curate-playlist`): asks GPT-4o-mini for exactly 10 tracks (`route.ts:56`), resolves to YouTube, drops failures → ≤10. **Still open** (unchanged by T34).
- **Song Radio** (`/api/song-radio`, `song-radio-` station prefix): **RESOLVED by T34 (Aug 26 2026)** for the count/seed-floor items. Pull target is now `SONG_RADIO_RECOMMENDATION_COUNT = 30` with a 25-track delivery trim; the searched artist is anchored at 4–6 Last.fm great songs (seed cap 6, everyone else 2). Larry's earlier 13-track / single-seed-song result was the old 15-target + max-2 cap path.
- **Artist Radio** (`/api/artist-radio`): targets 30, primary pool (seed artist, Tier 1) + similar pool (Last.fm, 4 each from 8), resolves to YouTube `limit: 30` (`route.ts:175`), drops resolve failures, slices to 30 (`route.ts:182`). **Still open** if the same quality issues (loose similar artists / non-hit picks) show up here — that is a separate follow-up, not T34.

**T14 — End-of-queue behavior (verified working — document only).**
The queue is infinite, not a fixed list that ends. `replenishQueue` (`useStationQueue.ts:720`) fires when the queue runs low: for artist-radio stations it calls `/api/station-tracks` with the seed artist (top unique artist in the queue, `:766`) to fetch more, deduped against played tracks and appended (`:802`); if that returns nothing it falls back to seed-based recommendations (`:806`). **Fixed playlist stations** (album deep dives) are the exception — they do NOT replenish (`:723`); they end. So a Manchester Orchestra station grabs fresh tracks; it doesn't stop at 13. No fix; confirm in the ear test and document.

**T15 — DJ break content: stinger location overload + time_capsule city conflation + persona steering.**
**Status: PARTIALLY RESOLVED (Aug 26 2026).** (a) Every Song stinger cadence rewritten — T24; stinger no longer carries listener city. (b) Time Capsule city conflation fixed — T26. (c) Persona `ttsInstructions` steering is still a tuning-round ear-test item (T2).
Larry's settings: Sarcastic Critic, Marin, Every Song, Sonic Time Capsule. Verified what's coded:
- **"Every Song"** = `talkative` pacing (`station.test.ts:86`): `minGap=1, maxGap=2, alternateStinger=true` → host on every track, alternating `full_break` ↔ `stinger`. The `stinger` is the "Station ID" liner. That's why the log is ~half Station ID / half Intro/Trivia/Up Next.
- **Stingers are short templated liners** — they don't carry the persona, so they sound neutral and include station name + genre + **listener location**. Major source of "Salt Lake City" repetition.
- **Sonic Time Capsule** (`promptBuilder.ts:875`) asks for "era context… the city, scene, clubs, radio, fashion… around the track's moment" — i.e., the *track's* scene city (e.g., Seattle 1991). But the listener's `homeCity` (Salt Lake City) is also in the prompt, and the LLM is **conflating** the two — dropping the listener's city into the "city" slot. Second source of Salt Lake City over-reference.
- **Sarcastic Critic** persona: full_breaks *should* carry it via `ttsInstructions` + systemPrompt, but the log's Intros read neutral. Either persona steering is too soft, or the `time_capsule` directive (55–75 words, era context) is dominating the character voice.

**Decisions needed (tuning levers):** (a) stinger template — drop or de-emphasize listener city; (b) time_capsule directive — disambiguate "track's scene city" from "listener city" so the LLM stops conflating them; (c) persona `ttsInstructions` — steer harder for Sarcastic Critic so full_breaks actually sound dry. All three are prompt/constant tweaks, not architecture.

### Console-log confirmations (Aug 25 2026 live test)

**T7 confirmed.** Opener (Manchester Orchestra "I Know How To Speak", video `g0YbQuuz01k`): `[YouTubeViewer] PLAYING pos=0.0` fired first, then `[SongHost TRACE] DJ voice audio .play()` + `DJ Voice on-air` at ~pos=3.4. The track played ~3.4s of music BEFORE the DJ voice (lore) started — matches Larry's "song started ~2s then earcon/DJ came in." The earcon→gap→lore-in-silence sequence did NOT gate Track 1's start; Track 1 auto-advanced first. Same pattern repeated on every station switch (e.g., `stationSelected alternative-rock` → `bpOSxM0rNPM` PLAYING pos=0.0 → two DJ voice clips over it). **Note:** no earcon-specific log line exists in the client, so the earcon firing itself isn't directly visible — only the symptom (track audible before DJ voice) is confirmed.

**T15.1 confirmed.** Break-request log lines alternate `Requesting DJ script/TTS...` (single-clip — stinger/standard) and `Requesting Pavlovian lore + announcement TTS...` (two-clip — lore-type full_break). Long-format breaks logged `scenario: 'hard_pause'` with `djAudioDurationSec` ~15–17.5s (e.g., `SAlAuGMLhXc` 17.52s, `hTWKbfoikeg` 15.912s, `_OsGggLrCRc` 15.72s) — Mode B (track paused, DJ talks in silence), matching Sonic Time Capsule. Short breaks logged `scenario: 'intro_ramp'` ~4–5s — Mode A (talk over intro). The long formats landed ONLY on full_break slots; stingers stayed single-clip short. Confirms "Every Song + long format = documentary on ~half the tracks, stinger on the other half."

**Not a bug — working as designed (verified in log):** Duck/restore lifecycle healthy — `DJ voice restore ramp` (600/800/1500ms) fired after every break, no stuck-ducked state. Lookahead prefetch working — `Prefetch buffer ready` preceded each track `ENDED`. Pavlovian two-clip confirmed — two `DJ Voice on-air` lines per `Requesting Pavlovian...` break. No abort/error logs.

**T10 NOT directly confirmable from this log.** The log shows `DJ Voice on-air` sample counts, not script text, so the "you just heard" wording can't be verified here. Only the structural precondition is visible (opener plays over an already-started track with prior `actualPlaybackHistory` carried from the previous station). The wording itself still needs a script-text capture or the broadcast-log transcript of that specific break.

**Noise to ignore:** `googleads.g.doubleclick.net` CORS errors are YouTube's own ad-tracking pixels being blocked by the browser — not SongHost. `[Violation] 'setTimeout'/'requestAnimationFrame'/'message' handler took <N>ms` are Chrome performance hints, not errors. `Clerk has been loaded with development keys` is a Vercel-preview Clerk-instance notice, not a bug.

### Small instrumentation task (approved Aug 25 2026)

**T16 — Add earcon playback log line (debuggability).**
**Status: RESOLVED (code-verified Aug 25 2026).** `playEarconFailClosed` now logs `[SongHost TRACE] earcon src=… skipped=…` immediately after resolving the URL and before the empty-src early return, covering all call sites with no behavior change.

**T17 — Dashboard top-area UI condense.**
**Status: RESOLVED (Aug 26 2026).** Dashboard top area is now: top nav → search (mic voice search; Advanced Tuning icon hidden) → Memory bar → one `StationBrowser` row with All / Decades / Genres / My Mixes / My Stations pills and decade/genre sub-pills. Four station rows (Decades carousel, Genres carousel, SavedStationsSection mixes + saved) replaced. MemoryDialBar moved out of the ControlDeck `memorySlot` so it sits directly below search. No audio / Phase 2+ changes. Code: `src/components/studio/StationBrowser.tsx`, `src/hooks/useVoiceSearch.ts`, `src/components/search/SmartSearchBar.tsx`, `src/app/page.tsx`.

**T18 — Advanced Tuning dropdown hidden (Spotify-recommendations path).**
**Status: RESOLVED (Aug 26 2026).** Dashboard no longer passes `onToggleTuner` / `tunerOpen` into `SearchSection`, so the Advanced Tuning icon is hidden (`SmartSearchBar` still gates the button on `onToggleTuner`). `toggleTuner`, `tunerOpen`, `TuneStationPanel`, and `POST /api/station/generate` are kept in the code but unreachable from the UI. The route is **not** rewired to the live AI Curator path — that is a future decision. Spotify recommendations were later mothballed out of this endpoint (T31); the UI remains hidden.

**T19 — YouTube viewer always-on + ambient background.**
**Status: RESOLVED (Aug 26 2026).** The dock YouTube host is always visible at 320×200 (no off-screen hide). Test caption and header **YT VIEW** toggle are retired; `src/lib/youtube/viewer-toggle.ts` remains in-tree but is no longer consumed. Ambient layer is a blurred/zoomed/darkened copy of `liveArtworkUrl` (not video pixels — cross-origin iframe cannot be sampled); empty art falls back to a warm amber radial on dark slate. Viewer is now always visible; this is not a claim that YouTube TOS compliance is fully "fixed."

**T20 — Mobile deck: remove "Tap to Resume Radio", add Drive Mode toggle.**
**Status: RESOLVED (Aug 26 2026).** Compact portrait dock always shows the now-playing row. When `isSpotifySyncPending && onStandbyResume`, Play calls `onStandbyResume` (same on the expanded mobile sheet); normal play/pause is unchanged otherwise. `DriveModeToggle` is mounted in the mobile host-controls row so Drive Mode is reachable on portrait without crowding the song title. Wake-lock / store logic is unchanged (reused component).

**T21 — Station sub-pills wrapping into a multi-row grid.**
**Status: RESOLVED (Aug 26 2026).** Decade and genre sub-pill rows in `StationBrowser.tsx` were `flex flex-wrap`, folding dozens of genre pills into ~6 rows and shoving the card row down. Changed both sub-pill containers to a single-row horizontal scroll slider (`overflow-x-auto scrollbar-none flex-nowrap`, pills `shrink-0 whitespace-nowrap`). Top pills (5) left as `flex-wrap`.

**T22 — Drive Mode overlay covers the always-on YouTube viewer (TOS).**
**Status: RESOLVED Aug 26 2026, then REGRESSED; superseded by T36, then T38 (Aug 27 2026).** Original fix: `DriveModeOverlay` (`fixed inset-0 z-[200]`) hid the dock (`z-50`) and its 320×200 YouTube viewer. Dock z became conditional (`z-50` normally, `z-[210]` while Drive Mode on). Larry's Aug 27 test showed the video was still covered, so T36 tried a fixed top-center iframe window + overlay restructure. T38 is the current approach (containing-block root-cause: drop `backdrop-blur-xl` in Drive Mode). See T38.

**T23 — Mobile compact deck too dense to read.**
**Status: RESOLVED (Aug 26 2026).** Compact portrait row held now-playing + Play/Next + like/ban, and a second row held the full Host Controls Bar + Drive Mode. Reorganized: compact row is now now-playing + Play + Next + Drive Mode only; like/ban stays in the expanded sheet (already there); Host Controls Bar is desktop-only in the dock and moves into `MobilePlayerSheet` via a new `hostControlsSlot` prop for mobile.

**T24 — Every Song rework (stinger no longer every other song; lore when extended format).**
**Status: RESOLVED (Aug 26 2026).** `talkative` no longer alternates a bare stinger (no title/artist) with a full break. Every track from 2 onward is a voiced `full_break` that includes the song ID. Lore (Pavlovian `artist_trivia`, or `local_events` when concert/weather takes priority) fires only when an extended commentary format is selected; `standard` is a quick song ID (`song_intro`, no earcon). A station-ID stinger still plays every 3–5 voiced breaks as a palette cleanser, **alongside** the song ID (`includeStinger` on the plan) — never instead of it, and never with lore. Opener unchanged. `alternateStinger` is false on the talkative profile; legacy numeric pacing 1 still alternates.

**T25 — Weather once per session (song 3–10).**
**Status: RESOLVED (Aug 26 2026).** Weather `local_events` is no longer a random per-break coin flip for the whole session. It may fire at most once, and only when the session track number is 3–10 inclusive (`weatherDelivered` + `sessionTrackCount` on scheduler state). After it airs, no more weather until station switch. Concert subkind priority is unchanged.

**T26 — City only with weather (weather tone + Time Capsule conflation).**
**Status: RESOLVED (Aug 26 2026).** Listener city is injected only for `local_events` (weather/concert) prompts. Weather copy names the city once with the actual conditions and forbids casual scene-setting banter. Sonic Time Capsule "city/scene/clubs" is explicitly the **track's** scene city, never `homeCity`. Lore breaks do not receive `homeCity` / `listenerCity` from `dj-intro` script requests.

**T27 — Natural Pace "Always tell me what's playing" toggle.**
**Status: RESOLVED (Aug 26 2026).** Natural Pace (`standard` chatter) now has a listener-facing toggle (`UserPreferences.alwaysAnnounceSongs`, default ON). When ON, the scheduler keeps an announced ledger: long-intro silent-gap tracks get a quick `song_intro` duck-announce (does not reset lore cadence); 2+ unnamed short-intro tracks are named in a catch-up recap on the next full break. When OFF, standard pacing is unchanged (silent gaps, breaks every 2–4, only some songs named). Every Song / Long Breaks / Music Only, the opener, weather, and city rules are untouched. Toggle is global (no station override). Host Settings shows it only under Natural Pace.

**T28 — Station card artwork rotation (cover-of-the-day + live now-playing).**
**Status: RESOLVED (Aug 26 2026).** Idle decade/genre/saved station cards no longer freeze on the first-track thumbnail. Each station without a custom `coverUrl` picks a deterministic cover-of-the-day from tracks that have a `youtubeId` (`hash(station.id) + daySeed`). Custom covers never rotate. The active station's card shows `nowPlaying.albumArt` while a track is playing, and falls back to its daily pick when idle. Studio Mix cards (`mixArtworkUrl`) are unchanged. Artwork src swaps fade in briefly; empty/invalid src still renders the icon immediately (no Next.js image GET).

**T29 — AI-curated Inspired stations from a searchbar launch.**
**Status: RESOLVED (Aug 26 2026).** After a searchbar launch (song radio, artist radio, AI Curator, album deep-dive), the station starts immediately and a parallel `POST /api/inspired-stations` call (one gpt-4o-mini JSON request) returns 5 session-ephemeral station blueprints. The new "Inspired" pill (after My Stations) auto-selects; skeleton while curating, then staggered fade-in (~120ms). Cards use an accent-color gradient until click; click resolves tracks via existing `POST /api/station/generate` and the Advanced Tuning launch path. Save persists the blueprint to My Stations (tracks still load on play). Clicking Inspired or catalog/saved does not regenerate the set. Statutory non-interactive radio — blueprints only; no licensing model change. Code: `src/app/api/inspired-stations/route.ts`, `src/lib/inspired-stations.ts`, `src/components/studio/StationBrowser.tsx`, `src/components/cards/StationCard.tsx`, `src/app/page.tsx`.

**T31 — Mothball Spotify in `/api/station/generate`; shared iTunes+Last.fm+YouTube catalog builder.**
**Status: RESOLVED (Aug 26 2026).** `POST /api/station/generate` no longer calls Spotify `getRecommendations`. Track lists come from the same iTunes + Last.fm + YouTube engine as `/api/station-tracks`, extracted into `src/lib/station/catalog-builder.ts` (`fetchGenreTracks` + `finalizeStationCatalog`). Request body and `StationTunerResult` response stay the same; Spotify extras (`targetEnergy`, `targetPopularity`, `yearFilter`) are dropped. `catalogDepth` is a source-based deep-cuts proxy (pool size 60–200 + Last.fm similar-artist widening), not a per-track popularity score. `energy` is stored and echoed as a legacy label with no precise catalog effect in this step. Spotify library files stay in the repo untouched. Other Spotify callers (`/api/song-radio`, `/api/recommendations`, `/api/search`, `/api/user/top-tracks`) are unchanged. Inspired / Advanced Tuning callers did not change. No cache on generate (one-shot fresh builds). Statutory non-interactive radio — no licensing change.

**T30 — Inspired card album art + seed-song-first + longer Inspired playlists.**
**Status: RESOLVED (Aug 26 2026).** Inspired cards show the seed song's album cover while browsing (real iTunes art, not the accent gradient). After the LLM returns 5 blueprints, five parallel iTunes song searches pick one seed track per card (`searchITunesSongs`, first hit with `artworkUrl`). Click passes that seed into `POST /api/station/generate`, which resolves its YouTube ID, places it as track 1, and builds the rest of the list from the blueprint (skipping the seed). Inspired launches request `limit: 50`; generate forwards `limit` as a catalog floor (no artificial 30-track cap). Accent-gradient in `StationCard` is now the fallback only when a blueprint has no seed art. Statutory non-interactive radio — the seed is a catalog track; the rest come from the existing licensed-catalog resolver. Code: `src/app/api/inspired-stations/route.ts`, `src/lib/inspired-stations.ts`, `src/lib/itunes.ts`, `src/app/api/station/generate/route.ts`, `src/app/page.tsx`.

**T15.1 — "Every Song" + a long format is an extreme combo (design discussion).**
Verified Aug 25 2026. `commentaryFormat` (Roots & Branches / Sonic Time Capsule / Director's Cut) applies **only to `full_break` slots** — a `stinger` is always a 3-second station-ID sweeper and never carries the format (`promptBuilder.ts:1494`). "Every Song" = `talkative` pacing = `alternateStinger=true` (`station.test.ts:86`), so it alternates `full_break` ↔ `stinger` every track. Therefore **"Every Song + Director's Cut" = a ~30–45s Mode B documentary on every OTHER song**, with a 3s stinger on the alternating tracks — not a Director's Cut after every song. Format lengths (verified `promptBuilder.ts:865`): Roots & Branches 25–32 words ~12–14s (Mode A, 30s prefetch); Sonic Time Capsule 55–75 words ~20–28s (Mode B, 45s prefetch); Director's Cut 80–110 words ~30–45s+ (Mode B, 60s prefetch). Lore is LLM-generated fresh per break (GPT-4o-mini), steered by the format directive + persona + vernacular; `user_lore_history` / `excludedFacts` act as a negative anti-repetition ledger, not a positive fact source (`factEngine.ts`). **Open for the tuning round:** should selecting a long format (Time Capsule / Director's Cut) auto-widen pacing so documentaries don't land every other track, or keep it fully the listener's choice (and surface the consequence in the UI)? Larry flagged "Every Song + Director's Cut" as feeling talk-heavy during the ear test.

---

## Next up (planned, as of Aug 26 2026)

**T32 — Spotify mothball Step 2: `/api/song-radio` + `/api/search`.**
**Status: PLANNED.** Promote the existing iTunes + Last.fm fallback in `/api/recommendations` / `/api/song-radio` to primary (Spotify becomes the unused fallback, then removed from these endpoints). `/api/search` already has an iTunes fallback — promote it to primary. Spotify library files stay in-tree until Step 3. Do NOT touch `/api/user/top-tracks` here. T34 improved the Last.fm/iTunes Song Radio quality floor without removing the Spotify rec boost.

**T33 — Spotify mothball Step 3: `/api/user/top-tracks` → app play-history; optional lib deletion.**
**Status: PLANNED.** Replace Spotify-OAuth "your top songs" with SongHost's own play history (plays are already logged). After this, no endpoint calls Spotify; the Spotify library files (`src/lib/music/spotify.ts`, `src/lib/spotify/*`) and env (`NEXT_PUBLIC_SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`) can be deleted — confirm with Larry before deleting (he mothballed, not deleted, in case Spotify comes back).

**T34 — Song Radio quality tuning — Last.fm top tracks + match-score filter + seed-artist floor + 25-track target.**
**Status: RESOLVED (Aug 26 2026); refined Aug 27 2026.** Song Radio no longer uses arbitrary iTunes artist-search rows for similar-artist picks. Each artist (seed + similar) is filled from Last.fm `artist.gettoptracks` ranked by play count, then `filterGreatSongs` (keep tracks at ≥20% of that artist's #1). Similar artists are filtered to Last.fm match so loose names (Travis Scott / Travis Tritt on a Snow Patrol radio) drop out. The searched artist is anchored at 4–6 great songs (searched song at index 0 plus up to 4 more); similar artists contribute 2 each (1 if their great pool has fewer than 4). Pull target 30, deliver up to 25. Per-build Fisher–Yates shuffle of each great-songs pool; existing `exclude` / last-100 session memory unchanged. Spotify recs stay as an optional boost (T32 mothball is a separate follow-up). Artist Radio is untouched. Code: `src/lib/catalog/lastfm.ts`, `src/lib/similar-artists.ts`, `src/lib/song-radio.ts`, `src/app/api/song-radio/route.ts`.
**Aug 27 2026 refinement (after Larry's "The National" diag showed 11 tracks):** the Spotify rec path contributes 0 when no `spotifyTrackId` is passed (the mothball direction), so the Last.fm path carries the whole load and was choked by the strict 0.4 match filter (only 3 similar artists passed → 6 candidates → 11 tracks). Tuning: `SIMILAR_ARTIST_MATCH_THRESHOLD` 0.4 → **0.3**; `SIMILAR_ARTIST_FETCH_LIMIT` 12 → **18**; `OTHER_ARTIST_CAP` 2 → **3**; `SEED_ARTIST_EXTRA_PICKS` 4 → **5** (seed artist = 6 total); `SONG_RADIO_RECOMMENDATION_COUNT` 30 → **40**. Quality stays safe because `filterGreatSongs` keeps only each artist's actual hits. Diag enriched with `matchThreshold` + per-artist Last.fm match scores (`similarArtistMatches`) so future tuning is evidence-based. Verified by test: 25 tracks, 8 unique artists, 6 seed songs, loose matches still rejected. **Live confirm (Larry, Aug 27 2026): "The National" Song Radio returned 21 tracks — RESOLVED.**

**T35 — Unified Station Preview Modal (all card types → editable preview; Play auto-starts).**
**Status: RESOLVED (Aug 27 2026).** Every station card (Inspired, Decades/Genres presets, Saved/MyStations, Studio Mixes) now opens a single `StationPreviewModal` instead of launching immediately. The modal mirrors `QueueModal`'s look but operates on a local editable copy: delete, search/add (via `/api/song-search`), drag reorder, and a prominent **Play** button. Play launches from the edited list with NO async fetch, so the user gesture is fresh and music auto-starts. Inspired cards pre-fetch the full playlist on render (3 cards, down from 5) into `inspiredPreviewTracks`; the modal shows the pre-fetched list. Preset cards fetch ~20 catalog tracks from `/api/station-tracks`, merge with the 40 seeds (deduped by youtubeId/itunesTrackId/previewUrl), Fisher–Yates shuffle, cap at 60. Saved cards use persisted tracks. Mix cards use the mix manifest tracks. Each launch path mirrors its original (`launchInspiredStation` / `selectStation` / `launchStudioMix`) exactly — including `primeAudioOnGesture`, `armStationHandoff` (preset/saved only), `setStationConfig` eraLock/vibePrompt (mix only) — so DJ opener, first-song, and session-opening invariants hold. A stale-fetch guard (`previewFetchGenRef`) prevents an old catalog fetch from overwriting a newer preview. Code: `src/components/StationPreviewModal.tsx` (new), `src/app/page.tsx`, `src/components/studio/StationBrowser.tsx`.
**Refined Aug 27 2026 (T40):** the preset top-up path (fetch ~20 from `/api/station-tracks`, merge with 40 seeds, cap 60) and the `previewFetchGenRef` guard were removed — presets now show their 40 authored seeds instantly (shuffled). See T40. **Refined Aug 27 2026 (T41):** the modal header now shows the station name + card thumbnail. See T41.

**T36 — Drive Mode live YouTube window + mobile X fix (superseded by T38).**
**Status: SUPERSEDED by T38 (Aug 27 2026).** T22's conditional-z dock fix regressed (Larry's Aug 27 test: video still covered in Drive Mode). Intermediate approach: while Drive Mode is on, the existing YouTube iframe host (`containerRef` in `AudioPlayer.tsx`) was promoted via className only to `position: fixed; top: safe-area; centered; z-[210]` (above the overlay's z-200), sized 196×110 mobile / 248×140 desktop, capped at `min(196px, 100vw-160px)` so it can never overlap the X on narrow phones. The iframe was NOT re-parented or remounted. `DriveModeOverlay` dropped the big album-art square; layout was a top spacer (video-sized) → title/artist (small Host Live pill when DJ speaking) → transport controls. Mobile X root cause: the old art square overflowed upward over the header and covered the X (not a touch handler / stale closure). Fixed by removing the art square + giving the header and X `z-10` and `touch-action: manipulation`. That top-center + overlay-transport approach is history — T38 is the current containing-block fix. This was a layout fix, not a claim of full YouTube TOS compliance. Code (historical): `src/components/AudioPlayer.tsx`, `src/components/studio/DriveModeOverlay.tsx`.

**T37 — UI fixes batch (ADD A SONG label, upward search dropdown, brighter YT backdrop, mobile hero label hidden).**
**Status: RESOLVED (Aug 27 2026).** (a) `QueueModal` "SEARCH FOR A SONG" → "ADD A SONG"; the add-song results dropdown opens upward (`bottom-full mb-1`) so it stays usable at the bottom of the screen. (b) `AudioPlayer` ambient backdrop brightened: artwork `opacity-40` → `opacity-70`, gradient `from-black/60 via-black/40 to-black/70` → `from-black/30 via-black/20 to-black/50`. (c) `SearchSection` "YOUR STATION STARTS HERE." label hidden on mobile (`hidden sm:block`) so the keyboard doesn't crowd search results on phones. No audio/DJ changes. Code: `src/components/QueueModal.tsx`, `src/components/AudioPlayer.tsx`, `src/components/studio/SearchSection.tsx`.

**T38 — Drive Mode containing-block root-cause fix (supersedes T36).**
**Status: RESOLVED (Aug 27 2026).** T36's top-center iframe + overlay transport still failed: the dock's `backdrop-blur-xl` creates a CSS containing block for `position:fixed` descendants, so `DriveModeOverlay` (`fixed inset-0 z-[200]`) and the promoted YouTube iframe (`fixed z-[210]`) were trapped relative to the thin dock bar instead of the viewport (dashboard showed through; video floated wrong). Fix: while Drive Mode is on, the dock drops `backdrop-blur-xl` and the translucent bg/border, becoming a solid opaque bar at `z-[210]` (normal mode unchanged: `z-50` + `backdrop-blur-xl`). `DriveModeOverlay` drops the big Prev/Play/Next transport (and those props); the dock is the single set of controls. The overlay owns the full-screen background + title/artist (upper) + a video-slot spacer. The iframe is repositioned to `bottom-[calc(8rem+env(safe-area-inset-bottom))]` (mobile) / `sm:bottom-[calc(8.5rem+env(safe-area-inset-bottom))]`, centered, `z-[210]`, 196×110 / 248×140 — just above the dock, not top-center. Same DOM node, no remount. Layout fix, not a full YouTube TOS claim (same wording as T22/T36). Code: `src/components/ControlDeck.tsx`, `src/components/studio/DriveModeOverlay.tsx`, `src/components/AudioPlayer.tsx`.

**T39 — Skip-break timing + stall watchdog.**
**Status: RESOLVED (Aug 27 2026).** Three playback intercepts plus YT error-code passthrough. (1) **8s stall watchdog** — Vevo / geo-blocked YouTube embeds can sit on a black frame without firing YT `onError`. Arms on `videoId` change (YouTube path only: `videoId` truthy and not `suppressLocalAudio` / `isPreviewMode` / `isDirectStreamMode`). First `onPlaying` clears it; skip / unmount / real `onError` also clear it. If it fires, it logs and calls `handlePlaybackError()`. Arms on load, not on pause/reseek, so a later Mode B lore/`hard_pause` pause cannot false-trigger. (2) **Suppress DJ break after a manual skip** — `skipNext` sets `justSkippedRef = true`. In `handleNewTrack`, the next track still runs `planDjSegment` and still commits `djSchedulerRef.current = nextState` (cadence still advances), but if the plan was voiced it is forced to `transition = silent` / `plan = null` for that one track. Already-silent plans are left alone. Suppressed only when `!isSessionOpening` — Track 1 of a session still always gets its `full_break` `song_intro` (opener invariant preserved). (3) **Back-to-back restore-ramp guard** — `onLoreComplete` and `onBreakExit` stamp `restoreRampEndsAtRef = Date.now() + RESTORE_RAMP_MS + 200`. If the next track loads while that restore is still in flight, its voiced break is forced silent the same way as (2). Duck/restore constants are unchanged (`RESTORE_RAMP_MS` still 1500; +200ms margin only). (4) **YouTube error code passthrough** — `useYouTubePlayer` `onError` type is `(code?: number) => void` and forwards numeric YT error codes (150/101/etc.) instead of swallowing them. `handlePlaybackError` still takes no args; the code is available for future tuning. Code: `src/components/AudioPlayer.tsx`, `src/lib/audio/legacy/useYouTubePlayer.ts`.

**T40 — Preset station preview shows 40 seeds instantly (20s delay removed).**
**Status: RESOLVED (Aug 27 2026).** Clicking a preset decade/genre card previously waited ~20s on "0 tracks" while `openStationPreview` called `/api/station-tracks` (cold YouTube-ID resolution + MusicBrainz enrichment at 1.1s/req) to top the 40 seeds up to 60. Root cause: the cold catalog build, not a bug. Fix chosen by Larry: **seeds-only** — drop the top-up entirely. `openStationPreview` in `src/app/page.tsx` now Fisher–Yates shuffles `station.tracks` (the 40 authored seeds) and sets them immediately; `previewFetchGenRef` (the stale-fetch guard) was removed as unused on this path; `setPreviewLoading(false)` is set instantly. A new `loading?: boolean` prop on `StationPreviewModal` shows "Loading station…" while empty + loading (used by Inspired pre-fetch), and "Queue is empty — search for a song below." otherwise. Trade-off accepted: preset previews show the authored seed pool only (40 for main stations; **3 for the 43 extra-genre stations that have no deep pool** — see T41/Tier 2 curation). Live playback is unaffected — `replenishQueue` still tops the queue from the catalog during a session. Code: `src/app/page.tsx`, `src/components/StationPreviewModal.tsx`.

**T41 — Station preview modal header + always-on default station art.**
**Status: RESOLVED (Aug 27 2026).** (a) **Modal header** — `StationPreviewModal`'s header was hardcoded "Playlist" + count and ignored the station name/art it received. It now shows a 44px rounded thumbnail + the station name (bold, light-theme) + the track count + the unchanged X close. `src/app/page.tsx` passes `coverUrl` as `nowPlaying.albumArt` (when that station is on air) → `stationArtworkUrl(station, daySeed)` (the same daily-seeded card art) → `seedTrack.artworkUrl` → `coverUrl`, plus a new `accentColor` prop. (b) **Always-on default art** — some extra-genre stations have invalid/reused YouTube IDs (e.g. `90s-rave-edm` reuses `y6120QOlsfU`), so `stationArtworkUrl` returns a thumbnail that 404s and `ArtworkImage` fell back to the gray Disc3 placeholder. `StationCard` `ArtworkBlock` and the modal header thumbnail now pass an accent-gradient `fallbackIcon` (using the station `accentColor`) when an image fails, so no station ever shows the gray box-with-dots; the Disc3 icon remains only when there is no `accentColor`. `shouldUseAccentGradient` (the Inspired-empty-art path) is unchanged. This is a stopgap — the real fix for thin stations + missing art is the Tier 2 deep-pool curation workstream (author ~40 real songs + valid YouTube IDs + iTunes artwork per station, batched 5–8 at a time). Code: `src/components/StationPreviewModal.tsx`, `src/components/cards/StationCard.tsx`, `src/app/page.tsx`.

**Current deploy test checklist (T31, Vercel build affe1bd):**
- Inspired and Advanced Tuning launches land **30+ tracks** (not ~10).
- Spotify is out of the `/api/station/generate` path.
- `catalogDepth` slider has a coarse real effect (pool size / Last.fm widening); `energy` is a stored label with no precise effect (expected this step).
- Preset genre/decade stations, Artist Radio, Album Radio unchanged (they already used the iTunes+Last.fm+YouTube engine).
- If a station feels too generic or comes back short, the next lever is a Last.fm per-track popularity signal (separate follow-up).

**Still-open tuning items (ear-test, deferred):** T2 (persona `instructions` tuning), T3 (Pavlovian commentary gap + earcon gain), T4 (companion DirectStream/iTunes preview duck-ramp), T6 (Free break metering + paywall teasers), T13 (AI Curator yield; Artist Radio quality if the same loose-match / deep-cut issues show up — Song Radio count/seed-floor resolved by T34), T15 (DJ break content: stinger template, Sarcastic Critic steering), T15.1 ("Every Song" + long format combo — design decision pending).

---

## Aug 28 2026 — Mobile polish + marketing foundation + Tier 2 curation complete

**Tier 2 curation — COMPLETE.** All 43 extra-genre stations curated in 7 batches; `src/data/station-seeds.ts` now 57 stations / 2561 tracks. Methodology: hand-authored `[artist, title]` staple lists in `scripts/station-seed-sources.mjs` → `scripts/resolve-station-seeds.mjs` resolves to verified embeddable YouTube IDs. Larry trusted the methodology without per-station taste review.

**T42 — Phone header overlap (FREE MODE on RADIO/STUDIO).** RESOLVED (`f0312fd`). At 360px the header was one non-wrapping row; the right cluster (`shrink-0`) crushed the left, so RADIO/STUDIO spilled under the FREE MODE pill and were untappable. `BrandHeader` now wraps to two rows below `sm` (wordmark + RADIO/STUDIO on row 1; FREE + Sign In on row 2). `DevTierBadge` shows short FREE/PRO below `sm`. Signed-in avatar and `sm+` header unchanged.

**T43 — Bottom player title squeeze ("Cru…/Bana…").** RESOLVED (`f0312fd`, then `988befa` v2). First pass made `DriveModeToggle` icon-only on the compact row and wrapped `TrackMetadata` in `min-w-0 flex-1`, but the controls cluster left only ~122px so the title still ellipsized. v2 added a marquee in `TrackMetadata` (overflow-measured, `prefers-reduced-motion`-safe, `aria-label` full text) so long titles scroll into view without dropping controls. No controls removed; row layout unchanged. `globals.css` adds `songhost-marquee` keyframe.

**T44 — Search dropdown covers station PLAY + double scrollbar + fixed 320px height.** RESOLVED (`59dbc51`, then `988befa` v2). First pass made the backdrop `pointer-events-none` + a `pointerdown` dismiss, but the `absolute z-[100]` dropdown still sat on top of PLAY (dead tap) and the 244px/2-row list stayed. v2 makes mobile (<768px) search a full-screen `dialog` that replaces the dashboard (no PLAY behind a scrim); results render in-flow with one scrollbar; a Close button returns to the dashboard. Desktop (≥768px) keeps the `absolute` dropdown. `SearchResultsBody` extracted shared between both paths.

**T45 — Playlist opens behind now-playing sheet.** RESOLVED (`59dbc51`). `QueueModal` raised `z-50` → `z-[70]` so Playlist opens in front of the now-playing sheet (`z-[60]`), same band as Host Settings. Not portaled. Desktop dock → Playlist path unchanged. `docs/ARCHITECTURE.md` stacking table updated.

**T46 — Marketing email opt-in + storage + false-banner fix.** RESOLVED (`d6c634c`). Onboarding modal adds an unchecked-by-default opt-in; staged in `localStorage` for guests, persisted to `users.marketing_opt_in` / `marketing_opt_in_at` on first `/api/user/sync` after sign-in (`applyMarketingOptIn` — no clobber of an existing grant timestamp). Migration `drizzle/0000_add_users_marketing_opt_in.sql`. Guest banner copy corrected (removed the false "unlock full-track streaming" claim). Guest playback unchanged. See [DECISIONS.md](./DECISIONS.md) D25.

**T47 — Privacy + unsubscribe pages + admin opted-in list.** RESOLVED (`2f54d07`). `/privacy` and `/unsubscribe` routes added (placeholder legal copy — owner must supply lawyer-approved wording). `/unsubscribe` toggles `marketing_opt_in` via existing `/api/user/sync` (no email-address opt-out). Footer links to both. `GET /api/admin/marketing-list` is read-only, admin-gated, opted-in users only (`{ id, email, marketingOptInAt }`, cap 10000). `scripts/export-marketing-list.ts` CLI mirror. No email is sent. See [DECISIONS.md](./DECISIONS.md) D25.

**T48 — Drive Mode raw HTML entities + battery-saver art off-center + GENERATE scrim + STUDIO publish no-op.** RESOLVED (`f5bc336`). (a) YouTube `snippet.title` carries literal `&#39;`/`&bull;`; `cleanVideoTitle` now decodes named + numeric entities at ingest (two-pass). (b) Drive "art" is the YouTube iframe (320×200) clipped into a 200×200 box; both saver branches now center the 320px iframe in the 200px clip (symmetric crop, visible window stays 200×200). (c) `runStationLaunch` `finally` + `SearchSection` `dismissMobileSearchAfterLaunch` stop the mobile drawer from reopening after GENERATE. (d) `handlePublish` gates on `isSignedIn` — guests get a "Sign in to publish" prompt, no cloud POST. See [DECISIONS.md](./DECISIONS.md) D26.

**Deploy verification still open (Larry, 360×800 guest):** confirm header wrap, scrolling title, full-screen search + Close → station Play, Playlist from the sheet, Drive Mode entities/centering, GENERATE no scrim, STUDIO publish sign-in prompt.

---

## Aug 28 2026 — Mobile overlay round 2 (portaled full-screen search + dashboard overlays)

**T49 — Mobile search is a true full-screen portal (escapes the z-10 stacking trap).** RESOLVED. The prior `fixed top-0 z-[60]` overlay was trapped inside the dashboard `relative z-10` wrapper, so it painted under the z-50 header (logo stayed visible) and the results strip was squeezed; `position: fixed` also didn't react to the keyboard. Fix: `createPortal` to `document.body`, `fixed inset-0 z-[200]`, `height: 100dvh` (keyboard shrinks it), safe-area padding. Text `< CLOSE` → small X icon. 100ms `ignoreDismissRef` guard stops the portal focus-jump from re-closing. Desktop unchanged. See [DECISIONS.md](./DECISIONS.md) D27.

**T50 — Search control row + marquee help.** RESOLVED. Mobile: Row 1 = input + mic (`h-11 w-11`, no longer full-width); Row 2 = full-width PLAY. Fixes `flex flex-col xs:flex-row` (xs=480px → 360px stacked three rows). Rotating hint is now an `IdleSearchHint` overlay (not a native `placeholder`), marquee-scrolls on overflow via the existing `songhost-marquee` keyframe + `--marquee-shift`, `prefers-reduced-motion`-safe, `key={rollingPromptText}` restarts every 5s. Desktop placeholder unchanged.

**T51 — MEMORY rail scroll cue.** RESOLVED. `min-w-[72px]` → `min-w-[64px]` (two fit on 360px); left/right fade overlays conditional on `scrollLeft` vs `scrollWidth - clientWidth` (scroll + ResizeObserver). Rail was always scrollable — just had no cue.

**T52 — Teleprompter repositioned on mobile.** RESOLVED. Was `fixed bottom-[...+7rem] right-4 z-[60]` — same z as the expanded `MobilePlayerSheet` (z-[60]), floating over its transport (Play cut in half). Now mobile top-anchored `z-[65]` `top-[calc(...+3.25rem)]` `max-h-[40vh]` — above the sheet, never near the bottom transport. Desktop unchanged.

**T53 — Sheet chevron close.** RESOLVED. ⌄ did nothing: it sat in the drag-handle div whose `setPointerCapture` stole the click. `onPointerDown`/`onPointerUp` stopPropagation on the chevron; `onClick={close}` now fires. Drag physics unchanged.

**T54 — Decade/genre sub-pills sticky + scroll cue.** RESOLVED. Sub-pills now `sticky top-[calc(...+2.75rem)] z-30 bg-[#09090b]` (stick below the header, stay tappable while scrolling cards); arrows `hidden sm:flex` → `flex` (visible cue on mobile). Top pills + carousels unchanged. **Open:** if the sticky search bar covers the stuck sub-pills on DECADES, bump the offset to ~5.5rem.

**Deploy verification still open (Larry, 360×800 guest):** confirm search covers logo + dock; input+mic one row; PLAY full-width; rotating help readable; X closes; typing with keyboard → results scroll; tap result → launches no scrim; memory rail fades + scrolls; teleprompter top-anchored (transport tappable); sheet ⌄ closes; decade sub-pills stay tappable while scrolling cards.
