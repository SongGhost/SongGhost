# SongHost Commercial Music Infrastructure Journey & Market Audit

This canonical document details the architectural, legal, technical, and vendor evaluation journey for **SongHost**—an AI-powered broadcast radio platform featuring continuous non-interactive music playback, dynamic DJ voice overlays, hyper-local/catalog scripting, and Station Blueprint authoring. It serves as a thorough, technical benchmark to document 100% of the project's starting point, evaluated pathways, technical roadblocks, and commercial realities, providing an exact reference to periodically audit the state of the music streaming API industry.

---

## 1. Executive Summary & Product Blueprint

* **Product North Star:** A seamless "pocket-mode" broadcast radio experience where a listener launches a station, puts their phone away, and stays immersed in music while an AI host teaches them about what they hear.
* **Core Technological Achievement:** SongHost's internal audio orchestration, statutory queue manager, and compliance engines are 100% built and validated. This includes the native HTML5 `DirectStreamProvider`, mix-bus sidechain ducking, zero-frame launch holds, isolated prefetch buffers, §114 DMCA queue rules, and the SoundExchange Reports of Use (ROU) performance logger.
* **The Commercial Bottleneck:** No turnkey, cost-effective B2B commercial music API exists in the market today that allows an independent startup to offer dynamic, user-curated AI radio with a full commercial catalog on a pay-as-you-go model without 5-to-6-figure upfront Minimum Guarantees (MGs) ($75,000+/year tech floors) or severe API/TOS restrictions.

---

## 2. Comprehensive Evaluated Pathways & Technical Roadblocks

SongHost systematically investigated every potential technical architecture and commercial music delivery model. The detailed breakdown below outlines the specific mechanics, roadblocks, and final status for each path.

### Phase 1: Consumer Streaming Services (YouTube, Spotify, Apple Music)

The original prototype leveraged major consumer streaming platforms as companion transports. While technically functional for basic playback, all three failed due to severe API Terms of Service (TOS) restrictions and mobile operating system constraints.

#### 1. YouTube IFrame API

* **Technical Concept:** An offscreen YouTube IFrame embedded in the client dock (`fixed -left-[9999px]`) executing search queries and video playback.
* **Aug 24 2026 (test harness, not a product change):** A default-off **YT View** header toggle can surface that same iframe in the dock at 320×200 without remounting. See `docs/MUSIC_PROVIDER_ANALYSIS_YOUTUBE.md`. Default remains hidden.
* **Aug 24 2026 (empirical, logged-out Chrome):** Visible 320×200 embed of Taste `z9Q9OzL_wI8` (Sabrina Carpenter Official Lyric Video) played full-length with **no in-stream ad**. The **same video id** on `youtube.com/watch` **did** play an ad. Hidden-player-as-the-cause is out. Embed vs watch-page serving is the open question. Do not productize dry embeds. DJ pause/duck still ran and remains a TOS problem. Details: analysis doc §2–§4; decision D5.
* **Roadblocks & Failures:**
  1. *Audio Modification / Ducking Prohibitions:* YouTube Developer Policies strictly forbid programmatically altering, ducking (`player.setVolume()`), or overlaying third-party audio streams over video audio.
  2. *Commercial Paywall Restrictions:* YouTube API TOS forbids gating or embedding streams inside paid or subscription applications.
  3. *Ad Injection Disruptions:* Unpredictable pre-roll and mid-roll video ads corrupt the backend's 30-second DJ pre-fetch calculations, causing voice breaks to collide with commercials or song intros.
  4. *Pocket Mode Destruction:* Mobile browsers (iOS Safari / Android Chrome) throttle or freeze background video elements when the screen is off or the app is minimized (`PAUSED` state), destroying Pocket Mode.
* **Final Status:** Quarantined in-tree under `src/lib/audio/legacy/useYouTubePlayer.ts`.

#### 2. Spotify Web Playback SDK & Web API

* **Technical Concept:** Spotify OAuth PKCE authentication flow and Web Playback SDK integration for Connect transport and catalog recommendations.
* **Roadblocks & Failures:**
  1. *TOS Commercial Bans:* Spotify Developer TOS explicitly prohibits using its SDKs/APIs to build commercial radio applications or competing streaming services.
  2. *Ducking & Modification Rules:* Programmatically sidechaining Spotify's stream volume (`player.setVolume(0.18)`) to insert AI voice breaks violates Spotify's audio modification guidelines.
  3. *Top-of-Funnel Friction:* Requires every end-user to possess an active Spotify Premium subscription ($11+/mo), excluding 80%+ of potential listeners.
  4. *Mobile Browser Throttling:* Web Playback SDK WebSockets and background audio sessions drop when mobile browsers enter background power-saving modes.
* **Final Status:** Quarantined in-tree under `src/lib/audio/legacy/useWebOrchestrator.ts`.

#### 3. Apple MusicKit JS

* **Technical Concept:** MusicKit JS session integration powered by Apple Developer Tokens.
* **Roadblocks & Failures:**
  1. *Section 10 Audio Synchronization Clause:* Apple's Developer Agreement explicitly forbids synchronizing or overlayering MusicKit audio content with external audio (AI DJ speech nodes).
  2. *Mandatory Media Controls:* Apple requires apps to provide standard user-initiated media controls (instant play, pause, rewind, scrub), directly violating statutory non-interactive webcasting queue rules.
  3. *Background Suspension:* Mobile Safari and WebKit view controllers kill background audio scripts during screen-off events.
* **Final Status:** Quarantined in-tree under `src/lib/audio/legacy/AppleMusicContext.tsx`.

### Phase 2: System-Level Background Overlay ("Option B")

* **Technical Concept:** Shift SongHost from a music player into a standalone background "DJ Companion." The user plays music through their own native music app (Spotify, Apple Music, YouTube Music), while SongHost runs in the background, monitors system playback, pauses/ducks the OS audio focus, delivers a lore break, and resumes playback.
* **Roadblocks & Failures:**
  1. *The iOS Architectural Wall:* Apple's `MPNowPlayingInfoCenter` API is strictly write-only for the active foreground app. iOS provides **zero public APIs** for a background app to inspect what track an external app is playing. Without track/artist metadata, the AI prompt engine cannot generate commentary or liner notes.
  2. *Android Permission Friction:* Android allows reading active `MediaSession` metadata, but requires forcing the user through deep system menus to grant a high-risk `NotificationListenerService` permission.
  3. *OS Background Execution Limits:* Requesting audio focus to deliver a DJ break turns SongHost into the active player; returning audio focus to Spotify leaves SongHost idle in the background. Both iOS and Android aggressively terminate idle background processes, causing the overlay to miss subsequent song transitions.
* **Final Status:** Rejected as technically impossible on iOS and unviable on Android.

### Phase 3: Commercial B2B Music Vendor Evaluations

Following the realization that consumer APIs and system overlays were unviable, SongHost evaluated professional B2B music infrastructure providers.

| Vendor / Provider | Architecture & Capability | Financial & Contractual Requirements | Primary Technical & Business Blockers | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Tuned Global** | Enterprise turnkey music backend, Content Delivery APIs, catalog ingestion. | **$75,000+/year** tech fee floor + 5-to-6-figure major label MGs + $10k–$100k legal consulting. | Pricing reflects enterprise interactive streaming and direct label sub-licensing; unviable for early-stage startups. | **Rejected** |
| **7digital / Songtradr** | 80M+ track catalog, REST API delivering raw stream endpoints, metadata, ISRCs. | **$15,000–$50,000+/year** tech commit + 5-to-6-figure label MGs. | Perfect technical match for `DirectStreamProvider`, but commercially blocked by enterprise fee walls. | **Rejected** |
| **Feed Media Group (Feed.fm)** | Pre-cleared §114 API/SDKs with native dual-stream audio ducking support. | ~$1,000+/month startup SaaS tier. | Closed menu of static genre stations. No dynamic station generation (cannot accept seed criteria/prompts), no open catalog search, black-box audio hides upcoming track metadata from the 30s DJ pre-fetch engine. | **Rejected** |
| **Self-Hosted Catalog (Cloudflare R2)** | `DirectStreamProvider` fetching MP3/WAV files stored in Cloudflare R2. | $0–$10/month hosting (R2) + track purchasing. | Sourcing tens of thousands of commercial tracks manually (Play MPE, DJ pools) forces the developer to act as a full-time radio programmer. Unviable at scale. | **Unviable at Scale** |

### Consolidated Vendor & Transport Evaluation Matrix

| Provider / Model | Technical Architecture | Cost / Commercial Requirements | Primary Blockers & Failures | Status |
| :--- | :--- | :--- | :--- | :--- |
| **YouTube IFrame API** | Embed iframe (`-left-[9999px]`), offscreen fallback | $0 (Ad-supported) | Audio modification/ducking bans; commercial app paywall bans; ad injection breaks 30s DJ pre-fetch; screen-on battery drain kills Pocket Mode. | **Quarantined** |
| **Spotify Web Playback SDK** | Companion JS SDK, Web API, OAuth PKCE flow | $0 + User Spotify Premium Account ($11+/mo) | Commercial radio app TOS bans; third-party audio ducking bans; top-of-funnel friction; mobile browser audio throttling. | **Quarantined** |
| **Apple MusicKit JS** | MusicKit JS SDK, Developer Token | $0 + User Apple Music Subscription ($11+/mo) | Section 10 audio synchronization bans; mandatory standard media controls conflict with radio rules; mobile OS background walls. | **Quarantined** |
| **Tuned Global** | Enterprise turnkey music backend & Content Delivery APIs | **$75,000+/year** tech fee floor + 5-to-6-figure label MGs + $10k–$100k legal consulting | Built for enterprise telcos/fitness apps; pricing reflects interactive direct-label deals. Unviable for startups. | **Rejected** |
| **7digital / Songtradr** | 80M+ track catalog, REST API, raw audio streams, ISRCs | **$15,000–$50,000+/year** tech commit + label MGs | Technical fit for `DirectStreamProvider`, but commercially blocked by enterprise fee walls. | **Rejected** |
| **Feed Media Group (Feed.fm)** | Pre-cleared §114 API/SDKs, dual-stream audio ducking | ~$1,000+/month startup tiers | Closed menu of static genre stations. No dynamic seed generation, no custom "Song/Artist Radio", black-box audio blocks lore pre-fetch. | **Rejected** |
| **Self-Hosted Catalog (Cloudflare R2)** | `DirectStreamProvider` fetching MP3/WAV from R2 buckets | $0–$10/mo hosting (R2) + track purchasing | Manual file sourcing (Play MPE, stores) forces the team to act as a full-time radio programmer. Non-starter for broad catalogs. | **Unviable at Scale** |
| **System DJ Overlay (Option B)** | Background process reading device audio & interrupting | $0 | **iOS Wall:** `MPNowPlayingInfoCenter` is write-only; **Android Wall:** Requires alarming `NotificationListenerService` security settings; OS suspends background tasks. | **Rejected** |

---

## 3. The Statutory Non-Interactive Architecture (§114 / §112)

To bypass direct record label negotiations and six-figure minimum guarantees, SongHost engineered a **statutory non-interactive radio engine** under SoundExchange **17 U.S.C. § 114** (webcasting) and **§ 112** (ephemeral recordings). Under § 114, record labels cannot refuse a statutory license as long as the platform adheres to strict non-interactive programming constraints.

```text
  [ Station Blueprint / Seed ] ──► [ useStationQueue (§114 Rules) ]
                                            │
                                            ▼
  [ DirectStreamProvider ] ◄── (Duck 18%) ─── [ VoiceNode (30s Prefetch) ]
            │
            ├─► [ Mix-Bus Analyser Tap ]
            └─► [ user_play_logs (>30s) ] ──► [ SoundExchange Monthly ROU ]
```

### Core Engine Integration Mechanics

1. **Primary Transport (`DirectStreamProvider`):** An un-suppressed native HTML5 `<audio>` element. Mix-bus `musicGain()` ducks the element volume directly; a single `captureMediaElement` opens an analyser tap into `mix-bus.ts`.
2. **Sidechain Ducking Matrix:**
   * Duck Target: **18%** of master (`DUCK_RATIO = 0.18`).
   * Duck-In Ramp: **300 ms** linear (`DUCK_RAMP_MS`).
   * Mid-Session Restore Ramp: **1500 ms** (`RESTORE_RAMP_MS`).
   * Opener Restore Ramp: **600 ms** (`STATION_LAUNCH_RESTORE_MS`).
   * Voice Headroom Boost: **1.35×** on Web Audio speech nodes (never ducked).
3. **Zero-Frame Launch Hold (`launchHoldActive`):** Synchronously holds Track 1 transport at `intro_ramp` (pre-ducked at 18% from `0:00`) or `hard_pause` (`0:00` for confirmed cold vocal intros `< 3s`) before any audible frame plays, preventing unducked music leaks prior to opener speech.
4. **Isolated 30s DJ Prefetch Engine:** Lookahead pre-fetch (`PREFETCH_LOOKAHEAD_SECONDS = 30`) fetches DJ scripts and synthesizes TTS into `VoiceNode.preload()`. Preload stays completely off the live AudioContext graph (`muted=true`, `volume=0`) to prevent graph corruption.
5. **DMCA § 114 Statutory Queue Rules:**
   * *Artist Cap:* Max 4 tracks by the same featured artist in a rolling 3-hour window (`STATUTORY_WINDOW_MS`); max 3 consecutive.
   * *Album Cap:* Max 3 tracks from the same album in a rolling 3-hour window; max 2 consecutive.
   * *Skip Limiter:* Max 6 skips per 60-minute sliding window (`SKIP_WINDOW_MS`).
   * *Queue Obfuscation:* `QueueModal` masks upcoming track titles ("Up Next: Smart Station Stream", "Later in the Stream").
   * *No Reverse Scrub / Instant Replay:* Reverse scrubbing, instant track replays, and unplayed row drag-and-drop are disabled.
6. **SoundExchange Performance Logger (ROU):** Plays lasting **>30 seconds** (`PERFORMANCE_COMMIT_SECONDS = 30`) automatically commit a performance log row to Postgres `user_play_logs` with MusicBrainz ISRC resolution and unique `playSessionId` (`${stationId}:${trackId}:${queueIndex}:${queueGeneration}`). Generates monthly pipe-delimited ASCII Reports of Use (ROU).

### Statutory Regulatory & Compliance Costs (Phase 5F Baseline)

* **CRB Notice of Use:** $50 filing fee with the Copyright Royalty Board.
* **SoundExchange Annual Minimum Fee:** $1,100 per station/channel due annually by January 31 (100% credited against accrued monthly performance liability within the same calendar year).
* **2026 Statutory Royalty Rates:** $0.0028 per performance (nonsubscription) / $0.0032 per performance (subscription).
* **PRO Blanket Licenses:** Public performance rights clearance via ASCAP, BMI, SESAC, and GMR.

*The Critical Reality:* SoundExchange administers statutory licenses and royalty collection, but **does not host, store, or serve audio files**.

---

## 4. The "Stripe for Music" Venture Opportunity

The complete absence of a developer-friendly music API creates a massive venture-scale market opportunity.

```text
[ Developer App ] ──► [ npm install @music/sdk ] ──► [ Universal Music API ] ──► [ Signed Stream + Auto-ROU ]
```

### Why the Primitive Doesn't Exist Today

1. **Master Contract Sublicensing Bans:** Major record labels (UMG, Sony, Warner) include strict non-sublicensing clauses in master agreements, forbidding B2B clients from issuing open API keys to third-party developers.
2. **Dual-Licensing Matrix:** On-demand interactive streaming requires clearing both Master Recording Rights (Labels) and Publishing Rights (Mechanicals via The MLC + Performance via PROs).
3. **Minimum Guarantee (MG) Barriers:** Labels demand 6-figure MGs per territory annually. Existing B2B vendors pass these MGs onto developers as $75k+/year tech floors.

### Pitch Mechanics for a Capital-Backed Venture ($10M–$20M Pool)

* **Core Product:** A pay-as-you-go developer music API ($0.0030/stream retail vs $0.0018/stream wholesale).
* **Capital Deployment:** A $10M–$12M capital pool deployed as balance-sheet collateral to underwrite bulk master/publishing MGs with Universal, Sony, Warner, and Merlin, acting as a risk-pooling buffer for micro-app developers.
* **Automated Compliance Engine:** Native handling of §114 queue rules, geo-fencing, automated SoundExchange/PRO ROU generation, and metered Stripe billing.

---

## 5. Industry Re-Evaluation Checklist

When periodically inspecting the market to see if a viable commercial music API has emerged, evaluate candidate platforms against these **6 mandatory criteria**:

* [ ] **1. Open API Catalog Querying:** Can the API search arbitrary tracks/artists and return stream endpoints for dynamic "Song Radio" and "Artist Radio" seed generation?
* [ ] **2. Raw Stream Access:** Does the service expose an un-suppressed stream URL or raw PCM buffer that integrates with `DirectStreamProvider` and Web Audio sidechain ducking?
* [ ] **3. Metadata & Lookahead Transparency:** Does the API expose upcoming track metadata (ISRC, title, artist, release year) at least 30 seconds in advance to feed the DJ script pre-fetch engine?
* [ ] **4. Startup Pricing Tier:** Is there a self-serve or usage-based tier under $500/month without $15k–$75k annual setup commitments or 6-figure label minimum guarantees?
* [ ] **5. Pocket Mode Compliance:** Does stream delivery support native background audio sessions on iOS/Android without forcing an active, lit video screen?
* [ ] **6. Turnkey Licensing / Indemnification:** Does the provider cover SoundExchange § 114 statutory reporting and PRO performance rights, or provide a fully pre-cleared indemnified catalog?
