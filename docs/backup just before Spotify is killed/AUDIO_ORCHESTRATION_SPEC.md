# SongHost Audio Orchestration & DJ Engine Specification
**Version:** 1.0.0  
**Status:** Canonical Reference

---

## 1. Finite State Machine (FSM) & Mutex Locking

To guarantee zero double-DJ executions, overlapping voice clips, or desynchronized track ducking, the audio orchestrator MUST operate as a strict Finite State Machine.

```text
  [ IDLE ]
     │
     ▼
  [ PLAYING_MUSIC ] ──(Trigger Break)──► [ PREFETCHING_BREAK ]
                                                │
                 ┌──────────────────────────────┴──────────────────────────────┐
                 │ (Speech Duration <= 15s)                                    │ (Speech Duration > 15s)
                 ▼                                                             ▼
     [ MODE A: DUCKING_OUTRO ]                                    [ MODE B: FADE_TO_STATION_BED ]
                 │                                                             │
                 ▼                                                             ▼
     [ SPEAKING_DJ_INBAND ]                                       [ SPEAKING_DJ_STATION_BED ]
                 │                                                             │
                 ▼                                                             ▼
     [ SWELLING_INTRO ]                                           [ HARD_LAUNCH_TRACK_B ]
                 │                                                             │
                 └──────────────────────────────┬──────────────────────────────┘
                                                │
                                                ▼
                                         [ PLAYING_MUSIC ]


FSM States Defined
IDLE: Audio engine initialized, no tracks queued or playing.

PLAYING_MUSIC: Track audio playing at 100% volume gain (1.0).

PREFETCHING_BREAK: Fetching script from /api/generate-script and downloading/synthesizing TTS audio blob.

MODE A: DUCKING_OUTRO: Track A volume ducks from 100% (1.0) to target duck level (e.g. 18% or 0.18) over a 600ms linear ramp.

MODE A: SPEAKING_DJ_INBAND: DJ speech audio plays over ducked music. Track A finishes and Track B pre-rolls at ducked volume underneath speech.

MODE A: SWELLING_INTRO: Speech completes. Track B executes a logarithmic volume swell from ducked level to 100% (1.0) over 800ms.

MODE B: FADE_TO_STATION_BED: Track A fades out completely (0%) over 1500ms. Genre station bed loop fades in to 25% (0.25) volume.

MODE B: SPEAKING_DJ_STATION_BED: DJ delivers long-form commentary over station bed. Track B pre-rolls silently in background.

MODE B: HARD_LAUNCH_TRACK_B: Speech ends. Station bed pitch/volume decays over 400ms, and Track B launches at 100% (1.0) volume.

Single-Execution & Cleanup Rules
breakExecutedForCurrentTrack (boolean): Set to true instantly upon entering state #4 or #7. Blocks all subsequent break requests for the current track ID. Reset ONLY when trackId changes.

sessionEpoch (integer): Incremented ONLY on explicit user interactions — manual station selection / mix launch, host persona swap, or host settings edits. MUST NOT be incremented during automated track transitions, queue advances, `playNextTrack`, or Spotify `player_state_changed` track-end events. All async API promises check if (promiseEpoch !== currentSessionEpoch) and abort if mismatched. Prefetched DJ breaks remain valid across automated advances because `requestEpoch === sessionEpoch` is preserved.

currentAbortController: Active AbortController instance. Calling abort() cancels pending script fetches and TTS downloads, revokes object URLs, and flushes in-flight break state so the next track starts clean.

### 1.1 Audio Buffer Safety & Fallback Rules

**Zero-Byte Buffer Guard:** The orchestrator MUST verify `arrayBuffer.byteLength > 0` before initiating any volume fade or state transition into Mode A or Mode B. Empty TTS payloads MUST NOT proceed past `PREFETCHING_BREAK`.

**Failed Load Fallback:** If a TTS fetch returns an empty buffer or audio decoding / `AudioBufferSourceNode` load fails, abort Mode A / Mode B immediately and maintain **100% music playback gain**. Never execute volume fades (duck, fade-to-bed, or ramp-to-zero) on corrupted or 0-byte audio blobs. Restore or keep Spotify / companion music at full listening level and return to `PLAYING_MUSIC`.

### 1.3 Background Tab Teardown & Autoplay Prevention

Browsers throttle background tabs and the Spotify Web Playback SDK may drop / re-establish its WebSocket. On recovery the SDK can auto-resume local playback even when the listener left the deck paused.

**Requirement:** When a browser tab recovers from background throttling or WebSocket reconnection, the WebOrchestrator MUST reconcile SDK playback state with React UI state. If UI `isPaused === true`, any unexpected SDK play state MUST be immediately forced to `pause()`.

**Implementation rules:**

1. `useWebOrchestrator` listens for `visibilitychange` and window `focus`. After the document returns from hidden/idle, if UI pause intent is set, call `spotifyPlayer.pause()` and/or `audioContext.suspend()`.
2. `WebOrchestrator.pause()` MUST disconnect / stop active `AudioBufferSourceNode` speech nodes, suspend the shared speech AudioContext, and verify that Spotify pause is acknowledged (SDK `getCurrentState` / REST probe with a single re-issue).
3. On `player_state_changed` (and the REST poll stand-in), if `state.paused === false` while UI pause intent is true, force an immediate `spotifyPlayer.pause()`, keep shared track state `isPaused: true`, and do not treat the event as a live play / track-start.

### 1.4 Session Hydration & Station Queue Persistence

Spotify Connect playback survives a browser refresh; the React station queue does not unless it is explicitly persisted. If the queue engine falls back to a default preset on boot, `syncIndexToPlayingTrack` looks up the live SDK track against the wrong list and returns `-1`.

**Requirement:** The active station ID and generated queue MUST be persisted to `sessionStorage`. Upon page refresh, the queue engine MUST hydrate the active station queue before Spotify SDK playback resumes to prevent `syncIndexToPlayingTrack` lookup misses against fallback stations.

**Implementation rules:**

1. Persist `stationId` to `sessionStorage` key `songhost_active_station_id` and the live `queue` + `currentIndex` to `songhost_active_queue` whenever a station is launched, reordered, or advanced (`useStationQueue` + `page.tsx` `beginStationSession`).
2. On home-console mount, restore `activeStation` from `songhost_active_station_id` (plus the optional station snapshot in the queue blob) and initialize `queueRef` / `currentIndex` from `songhost_active_queue` **before** Heavy Rotation auto-stage or companion `resume()` / `onTrackStarted`.
3. `WebOrchestrator.resolveRestoredTrackUri()` / `resume()` MUST prefer the hydrated session-queue now-playing URI when the SDK has no playback context after refresh.
4. If `syncIndexToPlayingTrack` still cannot find the SDK track, log `[QueueSync] Playing track not found in active station queue` and follow **§1.5** — do **not** prepend the unrecognized track; auto-steer Spotify back onto the expected station-queue item.

### 1.5 Strict Station Queue Isolation & Rogue Track Correction

Spotify Web Playback / Connect may start a server-side Autoplay track (or any URI) that is not part of the listener's station queue. That event must never rewrite the Playlist.

**Rule:** Telemetry listeners MUST remain pure observers. Unrecognized tracks played by the Spotify SDK MUST NOT be prepended or mutated into `queueRef.current`. When `syncIndexToPlayingTrack` returns `-1`, the orchestrator MUST auto-steer playback back to the expected station queue track.

**Implementation rules:**

1. `useStationQueue.syncIndexToPlayingTrack` looks up the playing item in `queueRef.current` only. A miss (`alignIndex === -1`) logs `[QueueSync] Playing track not found in active station queue`, returns `-1`, and leaves `queueRef.current` unmodified — no `unshift`, prepend, splice, or synthetic inject. Session hydration belongs in mount / `resetQueue` (§1.4), never in this observer.
2. `page.tsx` `onTrackStarted`: if the sync result is `-1`, log `[QueueSync] Rogue track detected (${title}). Steering Spotify back to station queue.`, resolve the intended item as `queue[currentIndex + 1]` or `queue[currentIndex]`, and immediately `playTrack` / `WebOrchestrator.steerToStationUri` that URI (plus the following station-queue tail when URIs are available).
3. `WebOrchestrator.steerToStationUri` / `playTrack` force Spotify onto the station URI(s) **without** flushing `sessionEpoch` (this is a correction, not a station launch).
4. `adoptPlayingTrack` may align the playhead when the live item is already in queue; it MUST NOT inject unrecognized tracks.

---

## 4. TTS Synthesis Pipeline

Script generation (`/api/generate-script`) and shared prep (`src/lib/tts.ts`) produce the spoken payload. Downstream engines (ElevenLabs, OpenAI `tts-1`) receive only sanitized plain text.

### 4.1 TTS Input Sanitization

**SSML Stripping:** Strip or convert all XML / SSML tags (e.g. `<break time="..."/>`, `<say-as>`, and other markup) into natural punctuation (commas, periods, or ellipses) **before** dispatching text to third-party TTS engines that do not support raw XML payloads (including ElevenLabs REST and OpenAI `tts-1`). Raw SSML MUST never appear in the synthesis request body.

---

## 5. Host Retention & Client Persistence

The Model 3 Host Retention Engine (`src/lib/store/sessionStore.ts`) keeps the listener's chosen DJ persona sticky across channel changes **and** page refreshes.

### 5.1 localStorage keys

| Key | Value | Written when |
| --- | --- | --- |
| `songhost_active_host_id` | Persona / host id string (e.g. `jasper-reed`) | Explicit Host Studio persona pick (and any Host Settings edit that locks the current host) |
| `songhost_is_host_locked` | `"true"` / `"false"` | `lockHost()` / `resetHostLock()` |
| `songhost_dj_volume` | DJ voice gain string (`0`–`1`, default `0.85`) | Host Settings DJ Voice Volume slider |
| `songhost:prefs:<userId>` / `songhost:prefs:guest` | JSON `UserPreferences` blob (spec name: `songhost:preferences`) | Any Host Settings / prefs write. **MUST** include Host Studio tuning: `mood`, `personality`, chatter pace, commentary format, plus per-station copies under `stationConfigs[stationId]` |

Host Studio tuning parameters (`mood` and `personality`) **MUST** be serialized to `localStorage` under `songhost:prefs:*` (`songhost:preferences`) — both as global `UserPreferences` fields and, when a station is on air, as overrides on `stationConfigs[stationId]` — alongside pace, volume, and host lock state. A page refresh hydrates those values into live DJ tuning (`djTuning` / companion orchestrator) so Host Studio colour is fully retained.

The Host Studio summary pill (`HostBar` / `HostControlsBar`) **MUST** dynamically reflect the active `commentaryFormat` enum (`UserPreferences.commentaryFormat`, or `stationConfigs[stationId].commentaryFormat` when set) using the current Host Studio labels — `"Standard"`, `"Roots & Branches"`, `"Sonic Time Capsule"`, `"Director's Cut"`. It MUST NOT fall back to legacy knowledge-depth verbiage such as `"Basic Facts"`. Changing Lore & Commentary in Host Settings MUST update the pill immediately.

The host id / lock keys above remain the **authoritative** Host Retention stamps for persona identity and lock state. Legacy `songghost-prefs-*` blobs are migrated forward on hydrate.

### 5.2 Hydration priority (MUST)

On client store hydration (`hydrateSessionStore()` during app boot / refresh):

1. Read `savedHostId = localStorage.getItem('songhost_active_host_id')` and `savedHostLocked = localStorage.getItem('songhost_is_host_locked') === 'true'`.
2. If a non-empty `savedHostId` exists:
   - Set session `activeHostId = savedHostId`.
   - If `savedHostLocked === true`, set `isHostLocked = true`.
3. Station initialization / default-station loading on mount MUST check **`isHostLocked || savedHostId`** (`shouldRetainHost()`) **before** applying `station.defaultPersonaId` / `defaultHostId`. A restored host id **MUST take priority** over curated station defaults so a refresh cannot silently replace Jasper (or any locked pick) with the station's default DJ.
4. `resetHostLock()` clears both the in-memory lock and the persisted host id / lock keys so the next launch may auto-match again.

### 5.3 DJ TTS speech routing (MUST)

All companion DJ TTS audio MUST be decoded and played through the Web Audio API — **not** an unattached `HTMLAudioElement` — to prevent browser media-element mute / autoplay bugs:

1. Fetch the TTS payload as an `ArrayBuffer` and decode with `audioContext.decodeAudioData(arrayBuffer)`.
2. Create an `AudioBufferSourceNode` (`speechSource`) and assign the decoded buffer.
3. Create a dedicated `GainNode` (`speechGain`) seeded from `localStorage.getItem('songhost_dj_volume')` (fallback `0.85`), then scaled through the master / headroom voice-gain pipeline.
4. Connect **`speechSource → speechGain → audioContext.destination`**.
5. Ensure `audioContext.state === 'running'` (`resume()` when suspended) before `speechSource.start(0)`.
6. If an `HTMLAudioElement` fallback is unavoidable (Web Audio unavailable), set `audio.volume` and `audio.muted = false` **before** calling `audio.play()`.
