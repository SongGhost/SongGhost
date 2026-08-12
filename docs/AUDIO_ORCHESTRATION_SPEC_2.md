# SongHost Audio Orchestration & DJ Engine Specification
**Version:** 2.0.0  
**Status:** Canonical Reference  
**Supersedes:** `docs/AUDIO_ORCHESTRATION_SPEC.md` (v1.0.0) for track-advance telemetry rules

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

sessionEpoch (integer): Incremented ONLY on explicit user interactions — manual station selection / mix launch, host persona swap, or host settings edits. MUST NOT be incremented during automated track transitions, queue advances, `playNextTrack`, Spotify `player_state_changed` track-end events, or mid-queue `onTrackStarted` / `syncIndexToPlayingTrack` hops. All async API promises check if (promiseEpoch !== currentSessionEpoch) and abort if mismatched. Prefetched DJ breaks remain valid across automated advances because `requestEpoch === sessionEpoch` is preserved.

currentAbortController: Active AbortController instance. Calling abort() cancels pending script fetches and TTS downloads, revokes object URLs, and flushes in-flight break state so the next track starts clean.

### 1.1 Audio Buffer Safety & Fallback Rules

**Zero-Byte Buffer Guard:** The orchestrator MUST verify `arrayBuffer.byteLength > 0` before initiating any volume fade or state transition into Mode A or Mode B. Empty TTS payloads MUST NOT proceed past `PREFETCHING_BREAK`.

**Failed Load Fallback:** If a TTS fetch returns an empty buffer or audio decoding / `AudioBufferSourceNode` load fails, abort Mode A / Mode B immediately and maintain **100% music playback gain**. Never execute volume fades (duck, fade-to-bed, or ramp-to-zero) on corrupted or 0-byte audio blobs. Restore or keep Spotify / companion music at full listening level and return to `PLAYING_MUSIC`.

### 1.2 Track Advance Telemetry & UI Synchronization

Spotify multi-URI launches auto-advance inside the Web Playback SDK / Connect queue. The station engine (`useStationQueue`) is **not** the playback authority for those hops — Spotify already moved — but the UI Playlist Modal highlight and Broadcast Log History still key off `useStationQueue.currentIndex` and `addToPlayHistory`.

**Requirement:** When Spotify starts a new track mid-queue (SDK `player_state_changed` or REST playback poll detects `incomingId !== lastTrackId` while playback is active), the orchestrator MUST emit `onTrackStarted` with live track metadata (`spotifyId`, `title`, `artist`). The page MUST call `useStationQueue.syncIndexToPlayingTrack(alignTo)` so `currentIndex` lands on the playing item.

**`syncIndexToPlayingTrack` contract:**

1. Resolve the matching queue row by `spotifyId`, falling back to case-insensitive `title` + `artist`.
2. If `alignIndex !== currentIndex`, mark vacated rows (`currentIndex` … `alignIndex - 1`) via `markPlayed()`, then `applyIndex(alignIndex)` and `maybeReplenish()` when near the tail.
3. MUST NOT bump `sessionEpoch`, call `flushForStationLaunch`, or treat the hop as a drained-end `playNextTrack` (which would skip past the live item).

**Broadcast Log & companion guard:**

- Mid-queue index moves MUST still update Broadcast Log History through `AudioPlayer.handleNewTrack` → `addToPlayHistory` (and the song counter).
- Because Spotify already owns the stream, `handleNewTrack` MUST NOT re-issue companion `playTrack()` / local companion breaks for that sync. Use a one-shot suppress flag (e.g. `suppressCompanionReplayRef`) armed by `syncIndexToPlayingTrack`.
- Duck–Talk–Swell for the new id remains `WebOrchestrator.registerTrack` / live `runDjBreak` — never a second `play({ uris })`.

**Drained ends stay on `onTrackEnded` → `playNextTrack`:** Single-URI plays and empty Spotify queues still advance via `playNextTrack(alignTo)` so Autopilot can load N + 1. Mid-queue hops use `onTrackStarted` only.

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

Related Host Studio tuning (pace, lore / commentary format, mood, personality) continues to persist through user preferences / Host Settings; the host id / lock keys above are the **authoritative** Host Retention stamps for persona identity and lock state.

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
