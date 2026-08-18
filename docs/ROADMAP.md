┌─────────────────────────────────────────────────────────────────────────┐
│                          SONGHOST DEVELOPMENT ROADMAP                 │
└─────────────────────────────────────────────────────────────────────────┘

## North Star

> **Put your phone in your pocket, listen to music, and learn more about what you hear.**

SongHost is a broadcast radio experience first. The product succeeds when a listener can launch a station, put the phone away, and stay in the music — with a host who teaches them something about what they just heard. The cockpit UI exists to tune and launch; the real product lives in the speaker.

---

## Current Status — Phase 5: Statutory Engine Pivot & Direct Stream Integration

**Active milestone: Phase 5 (Statutory Engine Pivot & Direct Stream Integration).** The primary product target is continuous **statutory non-interactive radio** under SoundExchange **§114** (non-interactive webcasting) and **§112** (ephemeral recordings), powered by `DirectStreamProvider` (native HTML5 `<audio>` + Web Audio `MediaElementAudioSourceNode` into `src/lib/audio/mix-bus.ts`).

Spotify Web Playback SDK, Apple MusicKit JS, and the YouTube IFrame API are **not** launch blockers. They remain in-tree as quarantined reference adapters under `src/lib/audio/legacy/` so historical FSM, OAuth, telemetry, and ducking contracts stay reviewable. New station launches attach to `DirectStreamProvider` only.

Phases 1–4 are complete. Commercial rails shipped ahead of this pivot (Clerk auth, Postgres cloud sync for memory slots / saved stations, Free/Pro metering, Stripe Checkout + webhooks, Clean Mode, Pro voice / pace / commentary gates). Phase 7 extended commentary, anti-repetition lore, and weather/daypart context are live. PWA installability (Phase 8) ships with the app shell.

**Execution order for this phase:** 5A legal/quarantine → 5B DirectStream bus → 5C musicology + statutory queue → 5D SoundExchange ROU telemetry → 5E Station Blueprint / Memory Dial → 5F GTM filings, PRO licenses, and store submission. Do not start store submission until 5B–5D hold on real devices.

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
- [x] Duck vs Pause Transition Rules — HTML5 / DirectStream remain format-aware (18% duck / pause-or-5% ambient on `mix-bus.ts`); quarantined companion adapters stay duration-based Mode A/B (see Phase 6)
- [x] Station Stingers, Vinyl Scratch FX & Premature Audio Truncation Guards

> **Lookahead footnote:** The historical `20s` pre-fetcher (`LOOKAHEAD_SECONDS` in `dj-prefetch.ts`) was superseded by the unified `30s` lookahead constant (`LOOKAHEAD_SECONDS = PREFETCH_LOOKAHEAD_SECONDS = 30`). DirectStream / AudioPlayer is the live clock. Quarantined YouTube / Spotify engines still share `COMPANION_PREFETCH_NEAR_END_MS = 30000` for reference only.

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

### PHASE 5: Statutory Engine Pivot & Direct Stream Integration ⬅ **ACTIVE**

**Product target:** a launchable statutory non-interactive radio engine. The listener tunes a station profile; `useStationQueue` generates a compliant stream; `DirectStreamProvider` delivers licensed audio into `mix-bus.ts` for native sidechain ducking; SoundExchange Reports of Use are committed for every performance past 30 seconds.

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

#### Step 5A: Legal & Platform Architecture Realignment (Completed / In Progress)
- [x] Audit Spotify, Apple Music, and YouTube developer policies — companion SDKs cannot be the statutory webcast transport; keep them as reference adapters only
- [ ] Isolate legacy SDK hooks under `src/lib/audio/legacy/` (YouTube IFrame, Spotify Web Playback SDK, Apple MusicKit JS, companion orchestrator / OAuth)
- [ ] Confirm new station launches no longer attach to quarantined `TrackProvider` / companion adapters
- [ ] Leave historical FSM, OAuth, telemetry, and ducking contracts intact inside the quarantine (do not delete)

#### Step 5B: Direct Stream Audio Provider (`DirectStreamProvider.ts`)
- [ ] Build `DirectStreamProvider` in `src/lib/audio/DirectStreamProvider.ts` adhering to the `TrackProvider` interface contract (`src/types/audio.ts`)
- [ ] Evolve the existing HTML5 path (`Html5TrackProvider` in `TrackProvider.ts`) into the statutory-radio transport — native `<audio>` + `MediaElementAudioSourceNode`
- [ ] Connect the stream node directly into `src/lib/audio/mix-bus.ts` so DJ voice uses native sidechain ducking (`DUCK_RATIO` 18% / 300 ms in / 1500 ms restore)
- [ ] Wire `AudioPlayer` + `useStationQueue` so preset, curator, artist-radio, and blueprint launches attach to DirectStream only
- [ ] Preserve first-song invariant: pause until audio unlock → play from position 0 → emit on-playing once per track load
- [ ] Bounded retry / skip on stream or catalog errors — never a synchronous infinite skip loop

#### Step 5C: Musicology Recommendation & DMCA Statutory Queue Engine
- [ ] Integrate **Last.fm API** for artist similarity and acoustic / folksonomy tags
- [ ] Integrate **MusicBrainz** for ISRCs, release credits, and confirmed `releaseYear` (era lock stays strict — undated candidates are rejected)
- [ ] Integrate B2B catalog stream APIs (e.g. 7digital / Songtradr) to resolve licensed audio URLs onto queue rows (`updateTrackAt`, never in-place mutation)
- [ ] Enforce DMCA statutory queue rules in `useStationQueue` / `src/lib/queue/`:
  - **4-artist / 3-album caps** per rolling 3-hour window
  - **6-skips-per-hour** listener limit (non-interactive webcasting)
- [ ] Obfuscate forward track titles in `QueueModal.tsx` (statutory non-pre-published playlist requirement — up-next titles must not be disclosed)
- [ ] Keep iTunes Search as a dated-catalog helper until MusicBrainz / B2B release dates fully replace it; it is not a music transport

#### Step 5D: SoundExchange Compliance Telemetry (ROU Logger)
- [ ] Create Postgres `user_play_logs` Drizzle schema (`userId`, `isrc`, `trackTitle`, `artistName`, `playedAt`)
- [ ] Commit a performance-log row when a DirectStream track has been on-air **>30 seconds** (sub-30s plays are not a Report of Use performance)
- [ ] Resolve ISRC from MusicBrainz / B2B metadata before insert; persist stream URL + ISRC on the queue row
- [ ] Build `scripts/export-rou.ts` for monthly SoundExchange CSV / text Reports of Use
- [ ] Quarantined companion adapters must not write statutory ROU rows — they are not the production bus

#### Step 5E: Studio Blueprint & Memory Dial Adaptation
- [ ] Refactor `/studio` from track sequencer to **Station Blueprint Builder** (seed criteria, vibe directives, host rules, caller voicemails)
- [ ] Persist blueprints via `/api/studio/save-station` as Station Profile JSON — playback regenerates a fresh statutory stream; it does not treat the blueprint as an on-demand playlist
- [ ] Refactor Memory Presets (1–6) to store Station Profile JSONs (`normalizeMemoryPresets()`; always exactly 6 entries)
- [ ] Adapt `user_saved_stations` / `user_memory_slots` so recalled dials dynamically generate a fresh statutory stream through `useStationQueue` + `DirectStreamProvider`
- [ ] Preserve caller voicemail stems as `kind: "call_in"` breaks (R2-hosted); authored liner cue lists must not reintroduce interactive sequencing

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
