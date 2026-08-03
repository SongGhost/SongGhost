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
  PHASE 2: The Zero-Gap Broadcast Audio Engine
   ├── Dual-Track Audio Pipeline (Music Track + DJ Voice Node)
   ├── Dynamic Sidechain Ducking (Smooth JS volume ramps)
   ├── Audio Pre-Fetcher (Generates next DJ intro 20s before track end)
   └── Station Stingers & Vinyl Scratch Sound Effects
       │
  PHASE 3: Studio Voice & Hyper-Local Context Engine
   ├── Cartesia / ElevenLabs WebSocket Streaming Voice Integration
   ├── Hyper-Local Context Injection (Time of day, weather, news)
   ├── Phoneme Dictionary (Ensuring correct band/album pronunciations)
   └── Interactive "Call-In Request Line" Chatbot Modal
       │
  PHASE 4: Platform Connectors & Creator Studio
   ├── Official Spotify Web Playback SDK & Apple Music Kit Hooks
   ├── DJ Studio Builder (Customize persona snark, accent, and music rules)
   ├── Voice Cloning Studio (Upload custom voice for personal stations)
   └── Public Station Directory & Shareable URL Generation
       │
  PHASE 5: Live Ghost Creator Network
   ├── Ghost Studio Web Console (/studio) for Live DJ Broadcasts
   ├── WebRTC Live Mic Input with Automatic Sidechain Ducking over Track Queues
   ├── Session Manifest Engine (Server-side voice-stem recording + JSON timestamp logs — zero copyrighted music hosted on servers)
   ├── Client-Side Playback Sync for Archived "Live Ghost" Episodes
   └── Creator Micro-Subscriptions ($3–$8/mo) via Stripe Connect (80/20 platform revenue split)
       │
  PHASE 6: Mobile, In-Car & Commercial Readiness
   ├── Media Session API (Native lock screen, watch & steering wheel controls)
   ├── PWA Installation & Background Audio Playback
   └── CarPlay & Android Auto High-Contrast Touch Dashboard
