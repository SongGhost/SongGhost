┌─────────────────────────────────────────────────────────────────────────┐
│                          SONGHOST DEVELOPMENT ROADMAP                 │
└─────────────────────────────────────────────────────────────────────────┘

## North Star

> **Put your phone in your pocket, listen to music, and learn more about what you hear.**

SongHost is a broadcast radio experience first. The product succeeds when a listener can launch a station, put the phone away, and stay in the music — with a host who teaches them something about what they just heard. The cockpit UI exists to tune and launch; the real product lives in the speaker.

---

## Current Status — Phase 5F: GTM Filings & Store Submission

**Shipped: Phase 5A–5E (Statutory Engine Pivot & Direct Stream Integration) — code complete; dial not yet swapped.** SongHost is a continuous **statutory non-interactive radio** engine under SoundExchange **§114** (non-interactive webcasting) and **§112** (ephemeral recordings). The **target** statutory music bus is **`DirectStreamProvider`**: native HTML5 `<audio>`, mix-bus `musicGain()` ducking on the element, and a single `MediaElementAudioSourceNode` analyser tap via `captureMediaElement` (never a second source node). Track 1 uses a zero-frame `launchHoldActive` lock (`hard_pause` at `0:00` or `intro_ramp` pre-ducked at `DUCK_RATIO = 0.18`); prefetch buffers stay isolated from the live session graph. `AudioPlayer` hardcodes `suppressLocalAudio = false` so the licensed HTML5 element is never frozen for a companion SDK. **Today's dial does not run DirectStream** — it plays full-length music through the YouTube IFrame (`useYouTubePlayer` → `YouTubeTrackProvider`), fed by hardcoded `youtubeId`s in `station-seeds.ts` and ungated `resolveTrackVideoId` on Artist Radio / Album Radio / AI Curator / `/api/station-tracks`. The iframe defaults to a hidden 320×180 host; a test-only header **YT View** toggle (Aug 24 2026) can surface it in the dock at 320×200 without remounting — see `docs/MUSIC_PROVIDER_ANALYSIS_YOUTUBE.md` §10. `DirectStreamProvider` attaches only on rows with HTTP `streamUrl`/`previewUrl` and no `youtubeId` — today only the search-launched station path with Full Songs (Dev) off (30s iTunes previews). Pocket mode is therefore already broken on the dial.

Spotify Web Playback SDK and Apple MusicKit JS are **not** launch blockers. They remain in-tree as quarantined reference adapters under `src/lib/audio/legacy/`. The **YouTube IFrame API is the current dial transport**, not quarantined — preset seeds, Artist Radio, Album Radio, AI Curator, and `/api/station-tracks` stamp `youtubeId` in production, and `AudioPlayer` selects `YouTubeTrackProvider` because `resolveDirectStreamUrl` refuses any row with a `youtubeId`. The "Full Songs (Dev)" toggle does not gate the dial — it only gates `/api/song-radio` and `/api/recommendations` YouTube lookups. `useWebOrchestrator` forces `companionActive: false`. Connection chrome is unmounted from the main radio flow: there is no `MusicSourceHeader` component; home `HeavyRotationShelf` is not imported; boot MUST NOT auto-open Step 2 ("Connect Spotify").

Phases 1–4 are complete. Commercial rails shipped ahead of this pivot (Clerk auth, Postgres cloud sync for memory slots / saved stations, Free/Pro metering, Stripe Checkout + webhooks, Clean Mode, Pro voice / pace / commentary gates). Phase 7 extended commentary, anti-repetition lore, and weather/daypart context are live. PWA installability (Phase 8) ships with the app shell.

**Still open in this phase:** 5F GTM filings, PRO licenses, and store submission. Do not start store submission until DirectStream + statutory queue + ROU hold on real devices (they do in-tree; 5F is legal/ops). A dedicated B2B catalog vendor client (e.g. 7digital / Songtradr) is not in-tree yet — DirectStream plays licensed `streamUrl` when present, else an HTTP `previewUrl` stand-in via `resolveDirectStreamUrl` **only after** strict title/artist equality (`itunesTitlesMatch` / `itunesArtistsMatch`; `lookupITunesTrack` returns `null` on miss). Live TRACE 4 on the DirectStream bus is VoiceNode-only (`Prefetch buffer ready` vs `DJ Voice on-air`).

**Still open after Phase 5 (post-launch expansions):** format-aware Pause–Talk–Resume + dual-phase audio spotlight on the DirectStream mix-bus (Phase 6), Bandsintown/News feeds + R2 city audio cache (Phase 6), Deepgram Aura TTS (Phase 7), Live Ghost WebRTC + CarPlay/Android Auto (Phase 8), Media Casting / Google Cast & AirPlay of the DirectStream session (Phase 9).

---

### PHASE 1: Core Foundation & UI Polish ✅
- [x] Engine Hardening (throttled retries, audio-unlock coordination, resilient replenishment)
- [x] Smart Catalog Shuffle (tiered weighted ordering + artist-adjacency repair)
- [x] Drag-and-Drop Queue Reordering & Anti-Repetition Queue Engine (24-hr history window + Fisher-Yates)
- [x] Personal Saved Playlists (save live queue as custom station) & 1–6 Physical Presets
- [x] Unified Design System Refactor (Dark charcoal palette, centralized `#2992cf` CSS accent variables)

### PHASE 2: Zero-Gap Broadcast Audio Engine ✅
- [x] Dual-Track Audio Pipeline (Music Track + DJ Voice Node)
- [x] Dynamic Sidechain Ducking (Smooth Web Audio API gain node ramps)
- [x] Audio Pre-Fetcher (Generates next DJ intro 20s before track end)
- [x] Zero-Latency DJ Prefetch Engine (`lib/dj/prefetchEngine.ts`) — 30s lookahead → `/api/generate-script` + `/api/generate-voice` → `prefetchedBreaksMap`
- [x] Duck vs Pause Transition Rules — live DirectStream / `AudioPlayer` always ducks at mix-bus `DUCK_RATIO` (18% / 300 ms / 1500 ms restore). Format-aware pause-or-5% ambient (`resolveBreakTransitionPolicy` / `EXTENDED_BREAK_AMBIENT_FLOOR`) is consumed by quarantined companion only; Pause–Talk–Resume on DirectStream is Phase 6
- [x] Station Stingers, Vinyl Scratch FX & Premature Audio Truncation Guards

> **Lookahead footnote:** The historical `20s` pre-fetcher (`LOOKAHEAD_SECONDS` in `dj-prefetch.ts`) was superseded by the unified `30s` lookahead constant (`LOOKAHEAD_SECONDS = PREFETCH_LOOKAHEAD_SECONDS = 30`). DirectStream / AudioPlayer is the live clock. There is no exported `COMPANION_PREFETCH_NEAR_END_MS`. Quarantined companion uses private `companionPrefetchNearEndMs(format)` = `getPrefetchLeadSeconds(format) * 1000`; `spotifyRemote.ts` still exports `SPOTIFY_NEAR_END_MS = 30_000` as the REST-poll default.

### PHASE 3: Studio Voice, Interactive Player & Mobile Polish ✅
- [x] Step 3A: Audio-Reactive Canvas Visualizer & Genre-Adaptive Themes
- [x] Step 3B: Station Personalization, Pacing, Host Overrides & 1–6 Memory Toolbar
- [x] Step 3C: On-Air Teleprompter, Track Feedback/Banning & History Drawer
- [x] Step 3D: Mobile Player Sheet, Pull-to-Refresh Lock & Memory Garbage Collection
- [x] Step 3E: Search Mode Standardization (Song Radio, Artist Mix, Artist Radio, Full Album, AI Curator)

### PHASE 4: Native Audio Integrations, Shared Links & Studio Engine ✅
- [x] Step 4A: Native Audio Stream Integration (Spotify Web Playback SDK & Apple MusicKit JS)
- [x] Step 4B: Shared Link Auth Gate (`/s/[id]` streaming account gate & custom DJ audio hydration)
- [x] Step 4C: Playful Unauthenticated Fallback Screen & Viral Onboarding CTAs
- [x] Step 4D: Studio Authoring Console (`/studio` custom voice break & script generator)

> **Post-pivot note:** Step 4A shipped the companion SDK path. Those adapters are now quarantined under `src/lib/audio/legacy/` (Phase 5A) and are not the production music bus. Shared-link playback and `/studio` authoring remain live and are adapted in Steps 5B / 5E to statutory DirectStream + Station Blueprint profiles.

### PHASE 5: Statutory Engine Pivot & Direct Stream Integration ✅ (5A–5E shipped; 5F remaining)

**Product target (met in-tree):** a launchable statutory non-interactive radio engine. The listener tunes a station profile; `useStationQueue` generates a compliant stream; `DirectStreamProvider` delivers HTTP audio with mix-bus `musicGain()` ducking, zero-frame Track-1 launch holds, and isolated prefetch buffers; SoundExchange Reports of Use are committed for every licensed performance past 30 seconds.

**Shipped ahead of this pivot (prior commercial rails — do not regress):**
- [x] User Authentication & Cloud Persistence (Clerk / Postgres station sync)
- [x] Memory Slot Cloud Sync (`user_memory_slots` + `/api/user/sync`)
- [x] Saved Stations Cloud Sync (`user_saved_stations` + `/api/user/sync`)
- [x] Default Guest Policy: Unauthenticated sessions default to clean mode (`allowExplicit = false`)
- [x] Catalog Filtering (`/api/recommendations` + `/api/station-tracks`): Drop explicit tracks from candidate pools
- [x] DJ Directives (`promptBuilder.ts`): Enforce clean broadcast standards during clean mode
- [x] User Preference Toggle: Expose "Allow Explicit Content" switch in Host Settings Drawer
- [x] ProUpgradeModal & Pro Voice lock states (HostBar gates ElevenLabs/Cartesia hosts; Stripe Checkout)
- [x] Free Tier Usage Metering & Quotas (`user_usage_limits`, `/api/user/usage`, 30 breaks / 30 days; Pro unlimited)
- [x] DJ Pace Restriction (Short Breaks default for Free tier) (Host Studio locks SILENT / EVERY SONG / LONG BREAKS; `/api/generate-script` forces `balanced` / `standard`)
- [x] Stripe Webhook Listener & Pro State Sync (`/api/webhooks/stripe` → Clerk `unsafeMetadata.tier` + Postgres `users.tier`)
- [x] Stripe Integration: Free vs Pro tiers with TTS/LLM usage rate limits
- [x] Owner Admin Dashboard & Financial Metrics (`/admin` + `/api/admin/stats`, `verifyAdminAccess` via `ADMIN_USER_IDS` / Clerk `metadata.role`)

---

#### Step 5A: Legal & Platform Architecture Realignment ✅
- [x] Audit Spotify, Apple Music, and YouTube developer policies — companion SDKs cannot be the statutory webcast transport; keep them as reference adapters only
- [x] Isolate legacy SDK hooks under `src/lib/audio/legacy/` (Spotify Web Playback SDK, Apple MusicKit JS, companion orchestrator / OAuth). **YouTube IFrame is NOT quarantined — it is the current dial transport** (`useYouTubePlayer` → `YouTubeTrackProvider`); preset seeds, Artist Radio, Album Radio, AI Curator, and `/api/station-tracks` stamp `youtubeId` in production. Target: swap the dial to `DirectStreamProvider` once seeds stop carrying `youtubeId` and catalog routes stop calling `resolveTrackVideoId`.
- [~] Confirm new station launches no longer attach to quarantined `TrackProvider` / companion adapters — **not yet true for YouTube**: launches still attach to `YouTubeTrackProvider` (see line above). Spotify/Apple companion attachment is removed; YouTube dial attachment remains until the transport swap.
- [x] Leave historical FSM, OAuth, telemetry, and ducking contracts intact inside the quarantine (do not delete)
- [x] Unmount connection chrome from the main flow (no `MusicSourceHeader` component; home `HeavyRotationShelf` not imported; `shouldAutoStageHeavyRotation()` returns `false`); `useWebOrchestrator` returns `companionActive: false`; post-Clerk boot MUST NOT auto-open Step 2 ("Connect Spotify")

#### Step 5B: Direct Stream Audio Provider (`DirectStreamProvider.ts`) ✅
- [x] Build `DirectStreamProvider` in `src/lib/audio/DirectStreamProvider.ts` adhering to the `TrackProvider` interface contract (`src/types/audio.ts`)
- [x] Evolve the existing HTML5 path (`Html5TrackProvider` in `TrackProvider.ts`) into the statutory-radio transport — native `<audio>` + mix-bus `musicGain()` on the element + a single `captureMediaElement` analyser tap
- [x] Connect the stream into `src/lib/audio/mix-bus.ts` so DJ voice uses native sidechain ducking (`DUCK_RATIO` 18% / 300 ms in / 1500 ms restore). Duck is applied once on the element — never a second `MediaElementAudioSourceNode`
- [x] Wire `AudioPlayer` + `useDirectStreamPlayer` + `useStationQueue` so preset, curator, artist-radio, and blueprint launches attach to DirectStream only (`suppressLocalAudio` hardcoded `false`)
- [x] Preserve first-song invariant: pause until audio unlock → arm `launchHoldActive` (default `hard_pause`) → play from position 0 under the hold (`hard_pause` stays paused at `0:00`; `intro_ramp` may play only at `DUCK_RATIO = 0.18`) → emit on-playing once per track load. `beginPlaybackFromStart` / `ensurePlayback` / `applyUnlock` honor the hold. Exposed: `setLaunchHold`, `releaseLaunchHold`, `isLaunchHoldActive`, `getLaunchHoldActive`, `getLaunchHoldMode`
- [x] Isolated prefetch buffers on the production bus: `VoiceNode.preload()` sets `muted = true` / `volume = 0` before `.src` and does not attach to the live session `AudioContext` or `MediaElementAudioSourceNode`. TRACE 4 is a **single-emitter** split on the live DirectStream bus: `[SongHost TRACE 4] Prefetch buffer ready` **only** in `VoiceNode.preload()`; `[SongHost TRACE 4] DJ Voice on-air` **only** in `VoiceNode.play()` (skipped when the abort signal has already fired). Legacy `DJ Voice buffer ready` and duplicate lookahead TRACE 4 emissions are removed from `dj-intro.ts` / `AudioPlayer.tsx` / `prefetchEngine.ts`.
- [x] Bounded retry / skip on stream or catalog errors (`MAX_STREAM_RETRIES = 3`, stall watch) — never a synchronous infinite skip loop

#### Step 5C: Musicology Recommendation & DMCA Statutory Queue Engine ✅
- [x] Integrate **Last.fm API** for artist similarity and acoustic / folksonomy tags (`src/lib/catalog/lastfm.ts` → `/api/recommendations`, `/api/station-tracks`)
- [x] Integrate **MusicBrainz** for ISRCs, release credits, and confirmed `releaseYear` (era lock stays strict — undated candidates are rejected)
- [x] Resolve DirectStream URLs onto queue rows via `resolveDirectStreamUrl` (`streamUrl` → HTTP `providerTrackId` → non-YouTube `previewUrl`); persist via `updateTrackAt`, never in-place mutation
- [~] Enforce DMCA statutory queue rules in `useStationQueue` / `src/lib/queue/` — **DEFERRED D6 (Aug 24 2026); code retained, caps disabled** (see [DECISIONS.md](./DECISIONS.md) D6):
  - **3-hour rolling artist/album admission** in `statutory-rules.ts`: max **4** tracks by the same featured artist / **3** consecutive; max **3** tracks from the same album / **2** consecutive (`STATUTORY_WINDOW_MS`)
  - **60-minute sliding skip limiter** in `skip-limiter.ts`: max **6** skips per window (`SKIP_WINDOW_MS`); exhaustion refuses the skip and leaves the on-air track playing
  - **Queue-end similar-artist refill:** background replenishment preserves Dev Mode `youtubeFallback`; §114 consecutive-artist rejection (`MAX_CONSECUTIVE_ARTIST = 3`) retries Last.fm similar artists so Song Radio / Artist Radio continue past Track 3 without raising statutory caps
- [~] Obfuscate forward track titles in `QueueModal.tsx` (statutory non-pre-published playlist): first upcoming row **"Up Next: Smart Station Stream"**; later rows **"Later in the Stream"**; no jump-to-index / drag-reorder of unplayed rows — **DEFERRED D6; real upcoming queue and listener reorder restored**
- [x] Keep iTunes Search as a dated-catalog helper until MusicBrainz / B2B release dates fully replace it; it is not a music transport. Live identity gates: `itunesTitlesMatch` / `itunesArtistsMatch` (strict parentheticals such as `(Reimagined)` required; feature tags stripped). `lookupITunesTrack` returns `null` on miss — never title-only `includes` or rank-0 `songs[0]`. Seed launches (`SmartSearchBar.runStationLaunch`, `/api/search` `gateTrackSeeds`, `/api/song-radio` `catalogPreviewUrl`) MUST pass title/artist equality before binding preview URLs. `DirectStreamProvider.load()` rejects stamp mismatches and URL-only iTunes/mzstatic provider IDs that lack title/artist identity.
- [ ] Dedicated B2B catalog vendor client (e.g. 7digital / Songtradr) to mint licensed `streamUrl`s — remaining catalog vendor work, not a DirectStream transport gap

#### Step 5D: SoundExchange Compliance Telemetry (ROU Logger) ✅
- [x] Create Postgres `user_play_logs` Drizzle schema (`userId` nullable, `isrc`, `trackTitle`, `artistName`, `albumTitle`, `durationSec`, `playedAt`, unique `playSessionId`)
- [x] Commit a performance-log row when a licensed DirectStream track has been on-air **>30 seconds** (`PERFORMANCE_COMMIT_SECONDS` in `src/lib/rou/performance-commit.ts`; gate in `useDirectStreamPlayer.ts` `onTimeUpdate`)
- [x] Unique `playSessionId` (`${stationId}:${trackId}:${queueIndex}:${queueGeneration}`) — client `committedSessionIdRef` plus `onConflictDoNothing` on `user_play_logs_play_session_uidx`
- [x] Resolve ISRC from MusicBrainz before insert (`POST /api/play-logs`); persist stream URL + ISRC on the queue row
- [x] Build `scripts/export-rou.ts` (`npm run export-rou`) for monthly SoundExchange headerless ASCII pipe-delimited Reports of Use (ATP = COUNT per recording)
- [x] Quarantined companion adapters must not write statutory ROU rows — they are not the production bus

#### Step 5E: Studio Blueprint & Memory Dial Adaptation ✅
- [x] Refactor `/studio` from track sequencer to **Station Blueprint Builder** (`TuneStationPanel` `seedsOnly` — seed criteria, vibe directives, host rules, caller voicemails; `TrackSequenceBuilder` is not mounted)
- [x] Persist blueprints via `/api/studio/save-station` as Station Profile JSON — playback regenerates a fresh statutory stream; it does not treat the blueprint as an on-demand playlist
- [x] Refactor Memory Presets (1–6) to store Station Profile JSON (`normalizeMemoryPresets()`; always exactly 6 entries) plus a parked **`StationConfig`** snapshot (`user_memory_slots.stationConfig` / `UserPreferences.stationConfigs`)
- [x] Adapt `user_saved_stations` / `user_memory_slots` so recalled dials dynamically generate a fresh statutory stream through `useStationQueue` + `DirectStreamProvider`
- [x] Preserve caller voicemail stems as `kind: "call_in"` breaks (R2-hosted); authored liner cue lists must not reintroduce interactive sequencing

#### Step 5F: Go-To-Market (GTM), Compliance Filings & Monetization Enablement
- [ ] File Copyright Royalty Board (CRB) **$50 Notice of Use**
- [ ] Pay SoundExchange **$1,000 annual minimum fee**
- [ ] Apply for ASCAP / BMI / SESAC / GMR PRO blanket licenses
- [ ] Unblock native Apple In-App Purchase (IAP) and Stripe **$9.99/mo** subscription checkout (Stripe webhooks + Free/Pro sync already shipped; close the App Store IAP path and public checkout)
- [ ] Production ops: marketing landing page, Sentry, PostHog, Legal / Terms
- [ ] Public **App Store** / **Google Play** submission (DirectStream + statutory queue + ROU logger must be live first)
- [ ] Screen-off / pocket resilience on the DirectStream path (PWA background audio, lock-screen transport, no silent death) — ship-blocker for store review

### PHASE 6: Subscriber Personal DJ Engine (v1.1 Expansion) 📋
- [x] Public Station Sharing & OpenGraph Cards (`/s/[id]`, `/api/station/[id]`, ShareModal, dynamic OG/Twitter metadata)
- [ ] Format-aware Pause–Talk–Resume on **DirectStream / `mix-bus.ts`** (extended formats pause, or hold a 5% ambient floor; native Web Audio ducking — not Spotify SDK or YouTube iframe volume hacks)
- [ ] Dual-Phase Audio Orchestration (Phase 1 Speech Spotlight → Phase 2 Ducked Lead-In) on the DirectStream music node
- [ ] Real-Time Local Context Integrations
  - [x] Open-Meteo Weather (shipped under Phase 7 weather/daypart pipeline)
  - [ ] Bandsintown Concerts
  - [ ] News API
- [ ] Unit Economics Engine (Cloudflare R2 hourly city audio caching & buffer stitching)

> Quarantined companion Mode A/B remains reference-only. Phase 6 polish lands on the statutory DirectStream bus.

### PHASE 7: Screen-Off Deep Knowledge & Extended Commentary (v1.2 Expansion) ✅ / 🔜
- [x] Specialized Audio Formats: Roots & Branches, Sonic Time Capsule & Director's Cut
- [ ] Format-Aware Host Transitions — queued as Phase 6 polish on DirectStream native ducking (not companion SDK timing)
- [x] Anti-Repetition Fact Engine (`lore_facts` / `user_lore_history` fact-graph DB schema & negative prompt injection)
- [x] Weather & Time-of-Day Contextual DJ Intros (`lib/location/weather.ts` → `/api/generate-script` → `promptBuilder` atmosphere directive; `homeCity` preference + client timezone headers for VPN-safe locale/clock)
- [ ] Cost-Optimized Extended TTS Pipeline (OpenAI `tts-1` / Deepgram Aura + LLM-generated SSML markup)
  - [x] OpenAI `tts-1` Free path + SSML pause tag prep for ElevenLabs
  - [ ] Deepgram Aura provider wiring

### PHASE 8: Live Ghost Creator Network & In-Car Dashboard (Post-Launch Expansion) 📋
- [ ] Studio Web Console (`/studio`) for Live DJ Broadcasts & WebRTC Mic Input (extends the Phase 5E Blueprint Builder; does not restore a track sequencer)
- [ ] Client-Side Playback Sync for Archived "Live Ghost" Episodes over DirectStream
- [x] PWA Manifest & Mobile Installability (`src/app/manifest.json` + layout `appleWebApp` / theme-color; Broadcast City `homeCity` VPN weather safeguard)
- [x] Production Error Boundaries & Health Endpoint (`src/components/ErrorBoundary.tsx` wraps app shell; `GET /api/health` Postgres + OpenAI/Clerk readiness probe)
- [ ] CarPlay & Android Auto High-Contrast Touch Dashboard bound to the DirectStream HTML5 / Web Audio session

### PHASE 9: Media Casting — Google Cast & AirPlay (Feature Backlog) 📋
- [ ] Google Cast Web SDK Integration
  - Load the Google Cast Framework SDK (`cast_sender.js?loadCastFramework=1`)
  - Establish session management via `cast.framework.CastContext` to discover and connect to Google TV and Chromecast devices
  - Cast the **DirectStream** session (licensed stream URL + mix-bus voice overlays), not a quarantined YouTube iframe or Spotify Connect device
- [ ] AirPlay Target Picker (Apple TV / iOS / macOS)
  - Bind `HTMLMediaElement.webkitShowPlaybackTargetPicker()` on the DirectStream media element for native AirPlay target selection on Safari and iOS devices
- [ ] DirectStream Receiver Handoff
  - Hand the active licensed stream URL to the TV receiver so SongHost remains the statutory transport remote; do not dispatch quarantined YouTube Video IDs as the production path
- [ ] Dock Transport UI Component (`ControlDeck.tsx`)
  - Position a compact `<Cast />` icon (using `lucide-react`) inside the right-hand transport deck in `ControlDeck.tsx` alongside the volume slider and mode controls
