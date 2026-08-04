# SongGhost Development Roadmap

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                          SONGHOST DEVELOPMENT ROADMAP                 │
└─────────────────────────────────────────────────────────────────────────┘
  PHASE 1: Core Foundation & UI Polish ✅ (Completed)
   ├── Engine Hardening (throttled retries, audio-unlock coordination, resilient replenishment)
   ├── Smart Catalog Shuffle (tiered weighted ordering + artist-adjacency repair)
   ├── Drag-and-Drop Queue Reordering (pointer + keyboard accessible)
   ├── Personal Saved Playlists (save the live queue as a custom station)
   └── Charcoal & Off-White UI Refactor (deep charcoal / off-white palette, amber accents retained)
       │
  PHASE 2: Zero-Gap Broadcast Audio Engine ✅ (Completed)
   ├── Dual-Track Audio Pipeline (Music Track + DJ Voice Node)
   ├── Dynamic Sidechain Ducking (Smooth JS volume ramps)
   ├── Audio Pre-Fetcher (Generates next DJ intro 20s before track end)
   └── Station Stingers & Vinyl Scratch Sound Effects
       │
  PHASE 3: Studio Voice, Interactive Player & Mobile Polish ✅ (Completed)
   ├── Step 3A: Audio-Reactive Canvas Visualizer & Genre-Adaptive Themes ✅
   ├── Step 3B: Station Personalization, Pacing, Host Overrides & 1–6 Memory Toolbar ✅
   ├── Step 3C: On-Air Teleprompter, Track Feedback/Banning & History Drawer ✅
   └── Step 3D: Mobile Player Sheet, Pull-to-Refresh Lock & Memory Garbage Collection ✅
       │
  PHASE 4: Specialized Listening Modes & Native Audio Integrations
   ├── Step 4A: Album Deep Dives & DJ Lore Mode (Sequential albums, liner notes, track trivia)
   ├── Step 4B: Native Audio Stream Integration & Full-Stream Spectrum (Spotify Web SDK)
   ├── Step 4C: Community Station Sharing, Permalinks & Custom Voice Tuning
   └── Step 4D: Smart Adaptive Engine & Cross-Device Preference Weighting
       │
  PHASE 5: Commercial Productization, Cooloff & Public SaaS Launch
   ├── Step 5A: Dogfooding & Real-World Testing Cooloff (Multi-device listening & prompt tuning)
   ├── Step 5B: User Authentication & Cloud Persistence (Clerk / Supabase station sync)
   ├── Step 5C: Explicit Content Filter & Subscription Billing Engine
   │    ├── Default Guest Policy: Unauthenticated sessions default to clean mode (allowExplicit = false)
   │    ├── Catalog Filtering (/api/station-tracks): Drop explicit tracks from candidate pools
   │    ├── DJ Directives (promptBuilder.ts): Enforce clean broadcast standards during clean mode
   │    ├── User Preference Toggle: Expose "Allow Explicit Content" switch for logged-in accounts
   │    └── Stripe Integration: Free vs Pro tiers with TTS/LLM usage rate limits
   └── Step 5D: Production Infrastructure & Public Launch (Landing page, Sentry, PostHog, Legal/Terms)
       │
  PHASE 6: Live Ghost Creator Network & In-Car Dashboard (Post-Launch Expansion)
   ├── Ghost Studio Web Console (/studio) for Live DJ Broadcasts & WebRTC Mic Input
   ├── Client-Side Playback Sync for Archived "Live Ghost" Episodes
   └── CarPlay & Android Auto High-Contrast Touch Dashboard
```
