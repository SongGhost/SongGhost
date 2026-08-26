# SongHost — Tuning Backlog (post-WS-3/4/5 round)

**Status:** Living document. Read this before the big tuning round that follows WS-3, WS-4, and WS-5.
**Owner:** GLM 5.2 (designer) proposes; Larry approves; Grok implements.
**Last updated:** Aug 26 2026

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
- **AI Curator** (`/api/curate-playlist`): asks GPT-4o-mini for exactly 10 tracks (`route.ts:56`), resolves to YouTube, drops failures → ≤10.
- **Song Radio** (`/api/song-radio`, `song-radio-` station prefix): target `SONG_RADIO_RECOMMENDATION_COUNT = 15` (`src/lib/song-radio.ts:5`). Seed track at index 0 + Last.fm/MusicBrainz similar-artist mix, `applyArtistCap` (max 2 per act), drops rows lacking an iTunes `previewUrl`/`streamUrl`. Larry's live log showed `trackCount: 13` for `song-radio-the-national-...` and `song-radio-...-manchester-orchestra` → 15 target minus ~2 drops (artist cap / preview misses). **NOT a 30-target miss** — the 30 figure is the Artist Radio path (`ARTIST_RADIO_PAYLOAD_SIZE = 30`, `artist-radio.ts:15`).
- **Artist Radio** (`/api/artist-radio`): targets 30, primary pool (seed artist, Tier 1) + similar pool (Last.fm, 4 each from 8), resolves to YouTube `limit: 30` (`route.ts:175`), drops resolve failures, slices to 30 (`route.ts:182`).

Larry's 13-track result with only the first song by the searched artist = **Song Radio** (target 15) where `applyArtistCap` (max 2/act) plus preview-URL drops left ~1 seed-artist track at index 0 and ~12 similar-artist tracks in the tail. **Decisions needed:** (a) raise `SONG_RADIO_RECOMMENDATION_COUNT` from 15 to 25+ to meet Larry's "at least 25" ask; (b) decide seed-artist weighting — `applyArtistCap` max-2 limits the seed artist to ≤2 tracks; Larry wants more seed-artist songs, so either raise the cap for the seed artist specifically or add an explicit seed-artist floor in the final slice.

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
**Status: RESOLVED (Aug 26 2026).** Dashboard no longer passes `onToggleTuner` / `tunerOpen` into `SearchSection`, so the Advanced Tuning icon is hidden (`SmartSearchBar` still gates the button on `onToggleTuner`). `toggleTuner`, `tunerOpen`, `TuneStationPanel`, and `POST /api/station/generate` are kept in the code but unreachable from the UI. The route is **not** rewired to the live AI Curator path — that is a future decision. Do not claim the Spotify-recommendations generate error is fixed; it is only hidden.

**T19 — YouTube viewer always-on + ambient background.**
**Status: RESOLVED (Aug 26 2026).** The dock YouTube host is always visible at 320×200 (no off-screen hide). Test caption and header **YT VIEW** toggle are retired; `src/lib/youtube/viewer-toggle.ts` remains in-tree but is no longer consumed. Ambient layer is a blurred/zoomed/darkened copy of `liveArtworkUrl` (not video pixels — cross-origin iframe cannot be sampled); empty art falls back to a warm amber radial on dark slate. Viewer is now always visible; this is not a claim that YouTube TOS compliance is fully "fixed."

**T20 — Mobile deck: remove "Tap to Resume Radio", add Drive Mode toggle.**
**Status: RESOLVED (Aug 26 2026).** Compact portrait dock always shows the now-playing row. When `isSpotifySyncPending && onStandbyResume`, Play calls `onStandbyResume` (same on the expanded mobile sheet); normal play/pause is unchanged otherwise. `DriveModeToggle` is mounted in the mobile host-controls row so Drive Mode is reachable on portrait without crowding the song title. Wake-lock / store logic is unchanged (reused component).

**T21 — Station sub-pills wrapping into a multi-row grid.**
**Status: RESOLVED (Aug 26 2026).** Decade and genre sub-pill rows in `StationBrowser.tsx` were `flex flex-wrap`, folding dozens of genre pills into ~6 rows and shoving the card row down. Changed both sub-pill containers to a single-row horizontal scroll slider (`overflow-x-auto scrollbar-none flex-nowrap`, pills `shrink-0 whitespace-nowrap`). Top pills (5) left as `flex-wrap`.

**T22 — Drive Mode overlay covers the always-on YouTube viewer (TOS).**
**Status: RESOLVED (Aug 26 2026).** `DriveModeOverlay` (`fixed inset-0 z-[200]`) hid the dock (`z-50`) and its 320×200 YouTube viewer, breaking the always-on visibility we just shipped and conflicting with YouTube TOS. Dock z is **conditional**: `z-50` normally, `z-[210]` only while Drive Mode is on so the dock punches above the overlay. A global bump to `z-[210]` would have hidden the mobile sheet and onboarding modal; the conditional z avoids touching any other layer. Overlay `<main>` gets responsive bottom padding (`pb-[340px] md:pb-[300px]`) so the big controls clear the dock. The iframe is not moved (no remount). This is a layout fix, not a claim of full TOS compliance.

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

**T15.1 — "Every Song" + a long format is an extreme combo (design discussion).**
Verified Aug 25 2026. `commentaryFormat` (Roots & Branches / Sonic Time Capsule / Director's Cut) applies **only to `full_break` slots** — a `stinger` is always a 3-second station-ID sweeper and never carries the format (`promptBuilder.ts:1494`). "Every Song" = `talkative` pacing = `alternateStinger=true` (`station.test.ts:86`), so it alternates `full_break` ↔ `stinger` every track. Therefore **"Every Song + Director's Cut" = a ~30–45s Mode B documentary on every OTHER song**, with a 3s stinger on the alternating tracks — not a Director's Cut after every song. Format lengths (verified `promptBuilder.ts:865`): Roots & Branches 25–32 words ~12–14s (Mode A, 30s prefetch); Sonic Time Capsule 55–75 words ~20–28s (Mode B, 45s prefetch); Director's Cut 80–110 words ~30–45s+ (Mode B, 60s prefetch). Lore is LLM-generated fresh per break (GPT-4o-mini), steered by the format directive + persona + vernacular; `user_lore_history` / `excludedFacts` act as a negative anti-repetition ledger, not a positive fact source (`factEngine.ts`). **Open for the tuning round:** should selecting a long format (Time Capsule / Director's Cut) auto-widen pacing so documentaries don't land every other track, or keep it fully the listener's choice (and surface the consequence in the UI)? Larry flagged "Every Song + Director's Cut" as feeling talk-heavy during the ear test.
