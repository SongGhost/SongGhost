┌─────────────────────────────────────────────────────────────────────────┐
│                          SONGHOST DEVELOPMENT ROADMAP                 │
└─────────────────────────────────────────────────────────────────────────┘

## Current Status — Pre-Launch Ready

**Product engine is launch-capable.** Phases 1–4 are complete. Phase 5 commercial rails (Clerk auth, Postgres cloud sync for memory slots / saved stations, Free/Pro metering, Stripe Checkout + webhooks, Clean Mode, Pro voice / pace / commentary gates) are implemented. Phase 7 extended commentary, anti-repetition lore, and weather/daypart context are live. PWA installability (Phase 8) ships with the app shell.

**Still open before public SaaS launch (Phase 5A / 5D):** multi-device dogfooding cooloff, marketing landing page, Sentry / PostHog, and Legal/Terms. Post-launch expansions remain: dual-phase audio spotlight (Phase 6), Bandsintown/News feeds + R2 city audio cache (Phase 6), Deepgram Aura TTS (Phase 7), Live Ghost WebRTC + CarPlay/Android Auto (Phase 8).

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
- [x] Duck vs Pause Transition Rules — standard ducks to 25% (companion) / 18% (YouTube); extended formats pause (or 5% ambient floor)
- [x] Station Stingers, Vinyl Scratch FX & Premature Audio Truncation Guards

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

### PHASE 5: Commercial Productization, Cooloff & Public SaaS Launch 🔜
- [ ] Step 5A: Dogfooding & Real-World Testing Cooloff (Multi-device listening & prompt tuning)
- [x] Step 5B: User Authentication & Cloud Persistence (Clerk / Postgres station sync)
  - [x] Memory Slot Cloud Sync (`user_memory_slots` + `/api/user/sync`)
  - [x] Saved Stations Cloud Sync (`user_saved_stations` + `/api/user/sync`)
- [x] Step 5C: Explicit Content Filter & Subscription Billing Engine
  - [x] Default Guest Policy: Unauthenticated sessions default to clean mode (`allowExplicit = false`)
  - [x] Catalog Filtering (`/api/recommendations` + `/api/station-tracks`): Drop explicit tracks from candidate pools
  - [x] DJ Directives (`promptBuilder.ts`): Enforce clean broadcast standards during clean mode
  - [x] User Preference Toggle: Expose "Allow Explicit Content" switch in Host Settings Drawer
  - [x] ProUpgradeModal & Pro Voice lock states (HostBar gates ElevenLabs/Cartesia hosts; Stripe Checkout)
  - [x] Free Tier Usage Metering & Quotas (`user_usage_limits`, `/api/user/usage`, 30 breaks / 30 days; Pro unlimited)
  - [x] DJ Pace Restriction (Short Breaks default for Free tier) (Host Studio locks SILENT / EVERY SONG / LONG BREAKS; `/api/generate-script` forces `balanced` / `standard`)
  - [x] Stripe Webhook Listener & Pro State Sync (`/api/webhooks/stripe` → Clerk `unsafeMetadata.tier` + Postgres `users.tier`)
  - [x] Stripe Integration: Free vs Pro tiers with TTS/LLM usage rate limits
- [ ] Step 5D: Production Infrastructure & Public Launch (Landing page, Sentry, PostHog, Legal/Terms)
  - [x] Owner Admin Dashboard & Financial Metrics (`/admin` + `/api/admin/stats`, `verifyAdminAccess` via `ADMIN_USER_IDS` / Clerk `metadata.role`)

### PHASE 6: Subscriber Personal DJ Engine (v1.1 Expansion) 📋
- [x] Public Station Sharing & OpenGraph Cards (`/s/[id]`, `/api/station/[id]`, ShareModal, dynamic OG/Twitter metadata)
- [ ] Dual-Phase Audio Orchestration (Phase 1 Speech Spotlight → Phase 2 Ducked Lead-In)
- [ ] Real-Time Local Context Integrations
  - [x] Open-Meteo Weather (shipped under Phase 7 weather/daypart pipeline)
  - [ ] Bandsintown Concerts
  - [ ] News API
- [ ] Unit Economics Engine (Cloudflare R2 hourly city audio caching & buffer stitching)

### PHASE 7: Screen-Off Deep Knowledge & Extended Commentary (v1.2 Expansion) ✅ / 🔜
- [x] Specialized Audio Formats: Roots & Branches, Sonic Time Capsule & Director's Cut
- [x] Format-Aware Host Transitions (standard Duck–Talk–Swell @ 25%; extended Pause–Talk–Resume / 5% ambient)
- [x] Anti-Repetition Fact Engine (`lore_facts` / `user_lore_history` fact-graph DB schema & negative prompt injection)
- [x] Weather & Time-of-Day Contextual DJ Intros (`lib/location/weather.ts` → `/api/generate-script` → `promptBuilder` atmosphere directive; `homeCity` preference + client timezone headers for VPN-safe locale/clock)
- [ ] Cost-Optimized Extended TTS Pipeline (OpenAI `tts-1` / Deepgram Aura + LLM-generated SSML markup)
  - [x] OpenAI `tts-1` Free path + SSML pause tag prep for ElevenLabs
  - [ ] Deepgram Aura provider wiring

### PHASE 8: Live Ghost Creator Network & In-Car Dashboard (Post-Launch Expansion) 📋
- [ ] Studio Web Console (`/studio`) for Live DJ Broadcasts & WebRTC Mic Input
- [ ] Client-Side Playback Sync for Archived "Live Ghost" Episodes
- [x] PWA Manifest & Mobile Installability (`src/app/manifest.json` + layout `appleWebApp` / theme-color; Broadcast City `homeCity` VPN weather safeguard)
- [x] Production Error Boundaries & Health Endpoint (`src/components/ErrorBoundary.tsx` wraps app shell; `GET /api/health` Postgres + OpenAI/Clerk readiness probe)
- [ ] CarPlay & Android Auto High-Contrast Touch Dashboard
