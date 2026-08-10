┌─────────────────────────────────────────────────────────────────────────┐
│                          SONGHOST DEVELOPMENT ROADMAP                 │
└─────────────────────────────────────────────────────────────────────────┘
  PHASE 1: Core Foundation & UI Polish ✅ (Completed)
   ├── Engine Hardening (throttled retries, audio-unlock coordination, resilient replenishment)
   ├── Smart Catalog Shuffle (tiered weighted ordering + artist-adjacency repair)
   ├── Drag-and-Drop Queue Reordering & Anti-Repetition Queue Engine (24-hr history window + Fisher-Yates)
   ├── Personal Saved Playlists (save live queue as custom station) & 1–6 Physical Presets
   └── Unified Design System Refactor (Dark charcoal palette, centralized #2992cf CSS accent variables)
       │
  PHASE 2: Zero-Gap Broadcast Audio Engine ✅ (Completed)
   ├── Dual-Track Audio Pipeline (Music Track + DJ Voice Node)
   ├── Dynamic Sidechain Ducking (Smooth Web Audio API gain node ramps)
   ├── Audio Pre-Fetcher (Generates next DJ intro 20s before track end)
   └── Station Stingers, Vinyl Scratch FX & Premature Audio Truncation Guards
       │
  PHASE 3: Studio Voice, Interactive Player & Mobile Polish ✅ (Completed)
   ├── Step 3A: Audio-Reactive Canvas Visualizer & Genre-Adaptive Themes ✅
   ├── Step 3B: Station Personalization, Pacing, Host Overrides & 1–6 Memory Toolbar ✅
   ├── Step 3C: On-Air Teleprompter, Track Feedback/Banning & History Drawer ✅
   ├── Step 3D: Mobile Player Sheet, Pull-to-Refresh Lock & Memory Garbage Collection ✅
   └── Step 3E: Search Mode Standardization (Song Radio, Artist Mix, Artist Radio, Full Album, AI Curator) ✅
       │
  PHASE 4: Native Audio Integrations, Shared Links & Studio Engine ✅ (Completed)
   ├── Step 4A: Native Audio Stream Integration (Spotify Web Playback SDK & Apple MusicKit JS)
   ├── Step 4B: Shared Link Auth Gate (/s/[id] streaming account gate & custom DJ audio hydration)
   ├── Step 4C: Playful Unauthenticated Fallback Screen & Viral Onboarding CTAs
   └── Step 4D: Studio Authoring Console (/studio custom voice break & script generator)
       │
  PHASE 5: Commercial Productization, Cooloff & Public SaaS Launch
   ├── Step 5A: Dogfooding & Real-World Testing Cooloff (Multi-device listening & prompt tuning)
   ├── Step 5B: User Authentication & Cloud Persistence (Clerk / Postgres station sync) ✅
   ├── Step 5C: Explicit Content Filter & Subscription Billing Engine
   │    ├── Default Guest Policy: Unauthenticated sessions default to clean mode (allowExplicit = false) ✅
   │    ├── Catalog Filtering (/api/recommendations + /api/station-tracks): Drop explicit tracks from candidate pools ✅
   │    ├── DJ Directives (promptBuilder.ts): Enforce clean broadcast standards during clean mode ✅
   │    ├── User Preference Toggle: Expose "Allow Explicit Content" switch in Host Settings Drawer ✅
   │    ├── ProUpgradeModal & Pro Voice lock states ✅ (HostBar gates ElevenLabs/Cartesia hosts; Stripe Checkout scaffold)
   │    ├── Free Tier Usage Metering & Quotas ✅ (`user_usage_limits`, `/api/user/usage`, 30 breaks/30 days; Pro unlimited)
   │    └── Stripe Integration: Free vs Pro tiers with TTS/LLM usage rate limits
   └── Step 5D: Production Infrastructure & Public Launch (Landing page, Sentry, PostHog, Legal/Terms)
       │
  PHASE 6: Subscriber Personal DJ Engine (v1.1 Expansion)
   ├── Dual-Phase Audio Orchestration (Phase 1 Speech Spotlight -> Phase 2 Ducked Lead-In)
   ├── Real-Time Local Context Integrations (Open-Meteo Weather, Bandsintown Concerts, News API)
   └── Unit Economics Engine (Cloudflare R2 hourly city audio caching & buffer stitching)
       │
  PHASE 7: Screen-Off Deep Knowledge & Extended Commentary (v1.2 Expansion)
   ├── Specialized Audio Formats: Roots & Branches, Sonic Time Capsule & Director's Cut ✅
   ├── Anti-Repetition Fact Engine (user_lore_history fact-graph DB schema & negative prompt injection) ✅
   └── Cost-Optimized Extended TTS Pipeline (OpenAI tts-1 / Deepgram Aura + LLM-generated SSML markup)
       │
  PHASE 8: Live Ghost Creator Network & In-Car Dashboard (Post-Launch Expansion)
   ├── Studio Web Console (/studio) for Live DJ Broadcasts & WebRTC Mic Input
   ├── Client-Side Playback Sync for Archived "Live Ghost" Episodes
   └── CarPlay & Android Auto High-Contrast Touch Dashboard
