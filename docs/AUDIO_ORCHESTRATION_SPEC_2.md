# SongHost Audio Orchestration & DJ Engine Specification
**Version:** 2.0.0  
**Status:** Canonical Reference  
**Supersedes:** `docs/AUDIO_ORCHESTRATION_SPEC.md` (v1.0.0) for track-advance telemetry, skip-mutex, and Spotify 429 circuit-breaker rules

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

PREFETCHING_BREAK: Fetching script from /api/generate-script and downloading/synthesizing TTS audio blob. Companion Mode A vs Mode B is decided here from `decodedAudioBuffer.duration` after `audioContext.decodeAudioData` — HTML5 `loadedmetadata` MUST NOT be used for this routing. If duration is missing, `NaN`, `Infinity`, or otherwise unknown, the orchestrator MUST **fail closed to Mode B** after decode. During this state the companion ducks in-band; it MUST NOT `pause()` + `seek(0)` until Mode B is selected.

**Mode A in-band preference (no transport bounce):** When a DJ break is queued (`isDjBreakDue()`, `willBreakOnNextTrack()`, a warmed prefetch exists for **this** track ID / title-artist alias, or the FSM is already holding), the orchestrator MUST duck the companion in-band to the mood-aware Mode A floor **before** script / TTS await. It MUST NOT issue `pause()` + `seek(0)` during `PREFETCHING_BREAK` when no speech buffer is ready — that bounce freezes Spotify at ~0.3s on Track 2+. Mode B (`pause` + `seek(0)`) is armed only after `decodeAudioData` proves duration > 15s (or duration unknown). `resetMusicVolume()` / `resumeActivePlayer()` MUST NOT run while `PREFETCHING_BREAK` is waiting on TTS with no speech buffer.

**Stale `PREFETCHING_BREAK` exit (MUST):** `registerTrack` MUST process live track transitions while `broadcastState === PREFETCHING_BREAK`. Skip `registerTrack` only for active Mode B speech (`MODE_B_BED_FADE` / `MODE_B_SPEAKING`). When `currentTrackId` changes, exit any stale prefetch hold (`releaseUnusedIncomingHold` / `exitPrefetchToMusic`) **before** evaluating a hold for the incoming track. `hasWarmedBreakForTrack` MUST match the incoming track ID or SDK title/artist alias — never a global `nextPrefetchKey`. `takePrefetchForTrack` MUST match against `getCurrentTrackState()` and MUST NOT await REST currently-playing.

MODE A: DUCKING_OUTRO: Track A volume ducks from 100% (1.0) to the mood-aware **relative** duck floor (default `0.18`; Chill `0.12`; Hyped `0.25`) over a **600ms** linear ramp (`MODE_A_DUCK_RAMP_MS`). This floor is **not** Mode B station-bed gain. See the Mood Ducking Matrix below.

MODE A: SPEAKING_DJ_INBAND: DJ speech audio plays over ducked music. Track A finishes and Track B pre-rolls at ducked volume underneath speech.

MODE A: SWELLING_INTRO: Speech completes. Track B executes a logarithmic volume swell from the ducked floor to 100% (1.0) over **800ms** default (`MODE_A_SWELL_MS_DEFAULT`; Chill `1200ms`; Hyped `400ms`).

MODE B: FADE_TO_STATION_BED: Track A fades out completely (0%) over **1500ms** (`MODE_B_FADE_MS`). Genre station bed loop fades in to **0.25** (`MODE_B_BED_GAIN`) — this is background bed gain, not the Mode A duck floor. Track B playhead is paused/held at position `0:00` so the intro cannot burn during the fade.

MODE B: SPEAKING_DJ_STATION_BED: DJ delivers long-form commentary over station bed. Track B remains **held or paused at `0:00`** — it MUST NOT advance silently underneath speech. Single-URI `playTrack` and SDK auto-advance events that land during this state MUST re-freeze the playhead at `0:00`.

MODE B: HARD_LAUNCH_TRACK_B: Speech ends. Station bed pitch/volume decays over **400ms** (`MODE_B_BED_DECAY_MS`). Track B **seeks to position `0:00` and unpauses**, then launches at 100% (1.0) volume so the listener hears the track intro from the beginning.

### 1.0 Canonical Mix, Mood Ducking & Prefetch Constants

**Role separation (MUST):** Mode A ducking floor (`MODE_A_DUCK_RATIO_*`, default **0.18** of pre-break volume) is distinct from Mode B station-bed gain (`MODE_B_BED_GAIN = 0.25`). Do not treat `0.25` as the standard Mode A duck. `0.25` applies only to Mode B bed gain and Hyped Mode A (`MODE_A_DUCK_RATIO_HYPED`).

#### Mood-aware Mode A ducking matrix

Live constants in `src/lib/player/webOrchestrator.ts`. Duck-in ramp is always **600ms** linear (`MODE_A_DUCK_RAMP_MS`); swell is logarithmic.

| Mood | Duck floor (relative) | Duck-in ramp | Swell (log) |
|------|----------------------|--------------|-------------|
| Default | `0.18` (`MODE_A_DUCK_RATIO_DEFAULT`) | `600ms` (`MODE_A_DUCK_RAMP_MS`) | `800ms` (`MODE_A_SWELL_MS_DEFAULT`) |
| Chill | `0.12` (`MODE_A_DUCK_RATIO_CHILL`) | `600ms` (`MODE_A_DUCK_RAMP_MS`) | `1200ms` (`MODE_A_SWELL_MS_CHILL`) |
| Hyped | `0.25` (`MODE_A_DUCK_RATIO_HYPED`) | `600ms` (`MODE_A_DUCK_RAMP_MS`) | `400ms` (`MODE_A_SWELL_MS_HYPED`) |

Mode B (decoded TTS > 15s, or duration unknown): fade outgoing to `0` over `MODE_B_FADE_MS` (`1500ms`), hold bed at `MODE_B_BED_GAIN` (`0.25`), decay over `MODE_B_BED_DECAY_MS` (`400ms`) before hard launch.

**Mode A script budget (MUST):** `MODE_A_DURATION_THRESHOLD_SEC` remains **15.0**. `roots_branches` copy is budgeted at **25–32 words (max ~12–14s)** so standard lore reliably qualifies for Mode A background ducking. `loreWordCeiling` / `truncateToWordLimit` enforce the 32-word cap. Do not raise the 15.0s routing threshold to compensate for long scripts.

YouTube / HTML5 mix-bus (`src/lib/audio/mix-bus.ts`): `DUCK_RATIO = 0.18`, `DUCK_RAMP_MS = 300`, `RESTORE_RAMP_MS = 1500`.

#### Prefetch lookahead (unified 30s)

YouTube (`LOOKAHEAD_SECONDS`) and companion (`PREFETCH_LOOKAHEAD_SECONDS` / `COMPANION_PREFETCH_NEAR_END_MS`) share one window:

| Constant | Value | Location |
|----------|-------|----------|
| `PREFETCH_LOOKAHEAD_SECONDS` | **30** | `src/lib/dj/prefetchEngine.ts` |
| `LOOKAHEAD_SECONDS` | `PREFETCH_LOOKAHEAD_SECONDS` (**30**) | `src/lib/audio/dj-prefetch.ts` |
| `COMPANION_PREFETCH_NEAR_END_MS` | **30000** (`PREFETCH_LOOKAHEAD_SECONDS * 1000`) | `src/hooks/useWebOrchestrator.ts` |

Single-Execution & Cleanup Rules
breakExecutedForCurrentTrack (boolean): Set to true instantly upon entering state #4 or #7. Blocks all subsequent break requests for the current track ID. Reset ONLY when trackId changes.

sessionEpoch (integer): Incremented ONLY on explicit user interactions — manual station selection / mix launch, host persona swap, or host settings edits. MUST NOT be incremented during automated track transitions, queue advances, `playNextTrack`, Spotify `player_state_changed` track-end events, or mid-queue `onTrackStarted` / `syncIndexToPlayingTrack` hops. MUST NOT be incremented during constructor / first-hydrate stamps (`{ silent: true }` on host-state setters). All async API promises check if (promiseEpoch !== currentSessionEpoch) and abort if mismatched. Prefetched DJ breaks remain valid across automated advances because `requestEpoch === sessionEpoch` is preserved.

`flushPrefetch()` MUST NOT bump `sessionEpoch` when prefetch buffers (`djPrefetchByTrackId`) and in-flight controllers (`prefetchAbort`) are empty — it no-ops and leaves the epoch unchanged. Live host-state sync MUST NOT call `flushPrefetch()` after aborting setters. `applyHostState` owns the single abort on a real settled change (`abortPendingSpeechAndClearBuffers("Host state change")`); callers MUST NOT follow it with a second flush that would double-bump.

**Silent host-state hydrate (MUST):** `setIsPro`, `setPersona`, `setAllowExplicit`, `setCommentaryFormat`, `setVibePrompt`, `setDjMode`, and `setDjTuning` accept `{ silent: true }`. Constructor and first-apply stamps MUST pass `silent: true` (or treat `lastAppliedHostStateRef == null` as silent) so initial values write properties **without** invoking `bumpSessionEpoch()` or aborting active speech buffers.

**Debounced `applyHostState` (MUST):** `useWebOrchestrator` coalesces live host-state drips (`isPro`, persona, `allowExplicit`, `commentaryFormat`, `vibePrompt`, and page `djMode` / `djTuning`) into a single **400ms** (`HOST_STATE_DEBOUNCE_MS`) `applyHostState`. On fire, compare the settled snapshot to `lastAppliedHostStateRef`. If values actually changed and this is not a silent / first stamp, invoke `abortPendingSpeechAndClearBuffers` **at most once**, then stamp all setters with `{ silent: true }`. MUST NOT call `flushPrefetch()` after those setters. Explicit Tuning Console / persona clicks MAY call `applyHostState` immediately; boot/login drips MUST go through the debounce. Orchestrator construct stamps via `applyHostState(..., { silent: true })`.

**`sessionLaunchPending` (MUST — Track 1 one-shot):** Armed **only** on explicit session flushes/launches: `flushForStationLaunch()`, `resetBreakSession()`, `launchStation()`, and hook `playTrack({ flushSession: true })`. MUST NOT be re-armed when `executedBreakTrackIds.size === 0` or on any automated track advance. Cleared on **any** of: `registeredTrackId` advancing past launch in `handleTrackRegistration`; every `runDjBreakInternal` early return (null input, `no_dj`, already executed, already running); and the first Track 1 break attempt in `resolveDjAudio` (success, skip, or throw). A Track 1 liner MUST NOT leak onto Track 2+. First voiced breaks mid-session evaluate the standard prefetch / LLM path.

**Prefetch precedence (MUST):** When a matching prefetched DJ break exists for the live track ID (`djPrefetchByTrackId` or shared `prefetchedBreaksMap`), it MUST execute via Mode A ducking (or Mode B if decoded duration > 15s) and MUST NOT be discarded for `getStationLaunchLiner`. Station launch liners run only on that explicit Track 1 open when no matching prefetch exists. Track 2 Autopilot warmup at ~30s remaining of Track 1 must log `"Executing prefetched DJ break"` / `"Using prefetched DJ break"` at the boundary — never a second launch liner. `beginStationLaunchLock` is armed only when `flushSession === true`; steer and mid-session companion advances (`flushSession: false`) MUST NOT re-lock the deck.

currentAbortController: Active AbortController instance. Calling abort() cancels pending script fetches and TTS downloads, revokes object URLs, and flushes in-flight break state so the next track starts clean.

### 1.1 Audio Buffer Safety & Fallback Rules

**Zero-Byte Buffer Guard:** The orchestrator MUST verify `arrayBuffer.byteLength > 0` before initiating any volume fade or state transition into Mode A or Mode B. Empty TTS payloads MUST NOT proceed past `PREFETCHING_BREAK`.

**Failed Load Fallback:** If a TTS fetch returns an empty buffer or audio decoding / `AudioBufferSourceNode` load fails, abort Mode A / Mode B immediately and maintain **100% music playback gain**. Never execute volume fades (duck, fade-to-bed, or ramp-to-zero) on corrupted or 0-byte audio blobs. Restore or keep Spotify / companion music at full listening level and return to `PLAYING_MUSIC`.

**Duration Probe Fail-Closed:** Companion Mode A/B routing MUST use `decodedAudioBuffer.duration` from `audioContext.decodeAudioData`. Un-probed clips, HTML5-only fallbacks without a decoded duration, and any non-finite duration MUST route to **Mode B** (treat as clip > 15s) so a long host break cannot talk over song intros or lead vocals.

**Mode B Track B Contract:** During `MODE_B_BED_FADE` and `MODE_B_SPEAKING`, the Spotify / companion transport for Track B is muted, paused, or held at `0:00`. `PREFETCHING_BREAK` ducks in-band (Mode A preference) until decode selects Mode B; it MUST NOT pause+seek with no speech buffer. On `MODE_B_LAUNCH`, seek Track B to `0:00`, unpause, then restore full listening volume. Do not let Track B run in parallel with Mode B speech.

### 1.2 Track Advance Telemetry & UI Synchronization

Spotify multi-URI launches auto-advance inside the Web Playback SDK / Connect queue. The station engine (`useStationQueue`) is **not** the playback authority for those hops — Spotify already moved — but the UI Playlist Modal highlight and Broadcast Log History still key off `useStationQueue.currentIndex` and `addToPlayHistory`.

**Requirement:** When Spotify starts a new track mid-queue (SDK `player_state_changed` or REST playback poll detects `incomingId !== lastTrackId` while playback is active), the orchestrator MUST emit `onTrackStarted` with live track metadata (`spotifyId`, `title`, `artist`). The page MUST call `useStationQueue.syncIndexToPlayingTrack(alignTo)` so `currentIndex` lands on the playing item.

**`syncIndexToPlayingTrack` contract:**

1. Resolve the matching queue row via `findQueueIndexForPlayingTrack`: `normalizeSpotifyTrackId` on the playing URI/id **and** each queue `spotifyId`, then `linkedFromId` / `linked_from.id` when present, then case-insensitive `title` + `artist`.
2. If `alignIndex !== currentIndex`, `applyIndex(alignIndex)` and `maybeReplenish()` when near the tail. MUST NOT `markPlayed()` vacated intermediate rows — unresolvable Spotify Search URIs jump the cursor to the next playable item, and those skipped rows never aired.
3. MUST NOT bump `sessionEpoch`, call `flushForStationLaunch`, or treat the hop as a drained-end `playNextTrack` (which would skip past the live item).
4. If the playing track is not in `queueRef` (index `-1`), log `[QueueSync] Playing track not found in active station queue` and return `-1` without mutating the queue. The page MUST auto-steer Spotify back onto `queue[currentIndex + 1]` / `queue[currentIndex]` via `playTrack` / `steerToStationUri` (see `docs/AUDIO_ORCHESTRATION_SPEC.md` §1.5). `onTrackStarted` MUST still clear `isSpotifySyncPending` on this `-1` path so "Tuning in…" cannot stick.

**Broadcast Log & companion guard:**

- Mid-queue index moves MUST still update Broadcast Log History through `AudioPlayer.handleNewTrack` → `addToPlayHistory` (and the song counter).
- Because Spotify already owns the stream, `handleNewTrack` MUST NOT re-issue companion `playTrack()` / local companion breaks for that sync. Use a one-shot suppress flag (e.g. `suppressCompanionReplayRef`) armed by `syncIndexToPlayingTrack`.
- Duck–Talk–Swell for the new id remains `WebOrchestrator.registerTrack` / live `runDjBreak` — never a second `play({ uris })`.

**Drained ends stay on `onTrackEnded` → `playNextTrack`:** Single-URI plays and empty Spotify queues still advance via `playNextTrack(alignTo)` so Autopilot can load N + 1. Mid-queue hops use `onTrackStarted` only.

**Lore `previousTrack` is strictly N-1 of the break's target:** On lore / recap breaks, `previousTrack` MUST resolve to the immediate predecessor of the track being introduced. Recaps MUST be grounded in **verified session playback** only (`WebOrchestrator.actualPlaybackHistory` / page `sessionPlayedRef`). A hydrated queue cursor (`queue.slice(index - 2, index)`) is not "aired" and MUST NOT be used as a recap fallback.

- **Live break** (Track N is on air / just started): `WebOrchestrator.fetchDjAudio` filters `actualPlaybackHistory` to drop the live `trackId`, then takes the last remaining item (`resolveLorePreviousTrack`). That is the just-finished companion track. If `actualPlaybackHistory` is empty for the active `sessionEpoch` (e.g. immediately after a station switch), pass `previousTrack: undefined` so the prompt engine emits an opener / `song_intro` rather than a phantom back-announce.
- **Lookahead prefetch** (warming Track N+1 while Track N is still on air, `coherent.trackId !== registeredTrackId`): do **not** call `resolveLorePreviousTrack(history, upcomingId)`. Track N has not finished, so the history tail is still N-1. Prefetch MUST explicitly bind the live on-air track (Track N — `currentTrack` / `registeredTrackId`) as `previousTrack` for N+1 script generation (`bindPrefetchPreviousTrack`). Warmup MUST NOT assign `WebOrchestrator.currentTrack` / `currentTrackId`; allocations stay local to the prefetched break buffer so live playback identity remains intact.
- `DjBreakPrefetchEngine.warm()` / `generateDjBreak` receive the same on-air `{ title, artist }` predecessor so engine-warmed clips recap Track N, not N-1.
- `normalizeTrackRefs` / `parseLoreTrackRefs` keep the newest N entries via `.slice(-limit)` (chronological buffers, newest last) so a long history cannot surface a ~4-songs-ago title as "what we just heard". Secondary `recentHistory` rows are older background context only — host copy such as "That was [Song]..." MUST name `previousTrack` alone.

### 1.3 Background Tab Teardown & Autoplay Prevention

Browsers throttle background tabs and the Spotify Web Playback SDK may drop / re-establish its WebSocket. On recovery the SDK can auto-resume local playback even when the listener left the deck paused.

**Requirement:** When a browser tab recovers from background throttling or WebSocket reconnection, the WebOrchestrator MUST reconcile SDK playback state with React UI state. If UI `isPaused === true`, any unexpected SDK play state MUST be immediately forced to `pause()`.

**Implementation rules:**

1. `useWebOrchestrator` listens for `visibilitychange` and window `focus`. After the document returns from hidden/idle, if UI pause intent is set, call `spotifyPlayer.pause()` and/or `audioContext.suspend()`.
2. `WebOrchestrator.pause()` MUST disconnect / stop active `AudioBufferSourceNode` speech nodes, suspend the shared speech AudioContext, and verify that Spotify pause is acknowledged (SDK `getCurrentState` / REST probe with a single re-issue).
3. On `player_state_changed` (and the REST poll stand-in), if `state.paused === false` while UI pause intent is true, force an immediate `spotifyPlayer.pause()`, keep shared track state `isPaused: true`, and do not treat the event as a live play / track-start.

### 1.4 Session Hydration & Station Queue Persistence

**Requirement:** The active station ID and generated queue MUST be persisted to `sessionStorage`. Upon page refresh, the queue engine MUST hydrate the active station queue before Spotify SDK playback resumes to prevent `syncIndexToPlayingTrack` lookup misses against fallback stations.

Keys: `songhost_active_station_id`, `songhost_active_queue`. Cross-tab / restart snapshot: `localStorage` `songhost:last_session`. Browser keys use the `songhost_*` / `songhost:*` prefix; reads MUST prefer the canonical key and migrate-on-read from legacy `songghost_*` / `songghost:*` (copy forward, never hard-cut). See `docs/AUDIO_ORCHESTRATION_SPEC.md` §1.4 for the tab-scoped rules and §5.4 for boot precedence. Local storage is an **offline cache** during boot and station transitions — it is not the playhead source of truth.

**Explicit station switch (MUST):** `beginStationSession` / `selectStation` MUST:

1. Force `currentIndex: 0` and clear hydrated queue offsets (`persistActiveStation(station, { resetPlayhead: true })` writes `queue: []`, `currentIndex: 0`). Same-id re-click is a new session, not a resume.
2. Immediately dispatch `abortPendingSpeechAndClearBuffers("Station switch")` and flush pending orchestrator speech / prefetch buffers **before** URI search. Do not wait for `playTrack({ flushSession: true })` / `flushForStationLaunch` (those still run on launch).
3. Clear `sessionPlayedRef` / `actualPlaybackHistory` so the opener cannot recap the previous station.

**Playhead interpolation clock (MUST):** Spotify SDK `player_state_changed` events are sparse. The companion UI range slider MUST NOT wait on those events (or the 2000 ms REST poll) to move.

On every **applied** SDK or REST transport sample, store a local stamp `{ trackId, positionMs, durationMs, receivedAt, playing }`. While playing and **not** in a Mode B hold, UI-paused, or seeking, a 250 ms interpolation timer (`PLAYHEAD_INTERPOLATION_MS`) updates **position only**:

```text
progressMs = min(durationMs, positionMs + (now - receivedAt))
```

That tick writes `setCompanionPlayback` and `publishActiveTrackState` position fields. It MUST NOT rewrite title/artist/album, ducking ratios, or `resolvePlaybackPositionMs()` FSM intro-window checks.

**2 s stall rescue (MUST):** If no SDK sample arrives for `PLAYHEAD_STALL_RESCUE_MS` (2000 ms) while interpolation is active, issue a **single** local `player.getCurrentState()` re-anchor. When that state is null, issue **one** REST currently-playing fetch, then resume interpolation from the new stamp. Do not restart the 2000 ms REST poll while SDK events or local interpolation are active.

Reset the sample on track-id change, pause, seek, and Mode B holds (`progressMs: 0` for Mode B).

### 1.5 Spotify Redirect URI Invariant

Spotify OAuth strictly disallows `localhost` URIs. Local development MUST strictly use `127.0.0.1:3000` (`http://127.0.0.1:3000/api/auth/spotify/callback`), while production MUST use `https://song-ghost.vercel.app/api/auth/spotify/callback`.

`canonicalizeSpotifyRedirectUri()` / `resolveSpotifyRedirectUri()` in `src/lib/player/spotifyRemote.ts` (and `page.tsx` `connectSpotify`) MUST rewrite loopback hosts (`localhost`, `::1`, `127.0.0.1`) to the registered local callback and MUST never emit `localhost` in `redirect_uri`. Authorize scopes MUST include `user-read-private` and `user-read-email` alongside `streaming`, `user-read-currently-playing`, `user-read-playback-state`, `user-top-read`, and `user-modify-playback-state` — the Web Playback SDK `check_scope` call returns 403 without the private/email pair.

**Cross-device preference JSONB (MUST):** Listener settings are **not** stored in Clerk `unsafeMetadata` (billing `tier` only). Postgres `users.preferences` JSONB is the account document, round-tripped through `/api/user/sync` GET/POST:

```ts
preferences: {
  activePersonaId,            // Host Studio persona
  commentaryFormat,           // includes "directors_cut"
  mood, personality,          // Host Studio sliders
  stationConfigs,             // per-station hostPersonaId + vibePrompt + lore/mood
  hostRetention: { activeHostId, isHostLocked },
  lastStationId,              // durable resume target (not sessionStorage)
}
```

Client hydrates `localStorage` first, then merges this payload **over** local on login. Host Retention writes `songhost_active_host_id` / `songhost_is_host_locked`. A preferences-only POST body is valid. Playhead position is **not** in this blob — Spotify Connect reconciles it (see §5.4).

**Mode A script budget & TTS bounds (see also §3.2):** `roots_branches` copy is capped at **32 words** so decoded clips stay ≤ `MODE_A_DURATION_THRESHOLD_SEC` (**15.0**, unchanged). Companion `fetchDjAudio` sends `recentBreakHistory` (last 6 `_broadcastHistory` scripts) for cross-break anti-repetition. ElevenLabs Turbo settings: `stability >= 0.55`, `style <= 0.15`, `use_speaker_boost: false`.

### 1.6 Spotify Search, 429 Circuit Breaker & Station Handoff

Genre/decade queues are YouTube-first. Spotify companion identity is resolved at launch via native `spotifyId` / `spotifyUri` when present, otherwise `searchSpotifyTrackUri`. The following rules keep that path from storming `/v1/search`.

#### Station handoff companion-search suppression

Station switches MUST arm AudioPlayer **before** the queue reset so `handleNewTrack` cannot race `launchStation` with a duplicate Search.

1. `selectStation` and `handoffToWebOrchestrator` call `AudioPlayer.armStationHandoff()` before `beginStationSession` / queue updates. That sets sticky `stationHandoffSuppressRef` and one-shot `suppressCompanionReplayRef`.
2. While the sticky flag is set, `handleNewTrack` still updates Broadcast Log / song counter but MUST NOT call `onCompanionPlayTrack` / `onCompanionDjBreak`.
3. The handoff `useEffect` in `page.tsx` calls `disarmStationHandoff()` in `finally` after `launchStation` / `launchCompanionTrack` so later skips can play.

Mid-queue Spotify auto-advance continues to use the one-shot `suppressCompanionReplayRef` armed by `syncIndexToPlayingTrack`.

#### Native URI preference & queue persistence

1. `onCompanionPlayTrack` / `companionTrack` MUST include `spotifyId` / `spotifyUri` from the live queue row.
2. `launchCompanionTrack` MUST call `spotifyUriForQueueTrack()` on the seed **before** falling back to Search.
3. After Search (or a native hit) resolves a URI, persist it onto the queue row via `AudioPlayer.updateTrackAt` (`persistSpotifyIdOnQueue` in `page.tsx`) so subsequent skips / advances do not re-query Spotify. Never mutate a live `StationTrack` in place.

#### Spotify REST 429 circuit breaker (`spotifyRateLimitResetTime`)

All Spotify GETs through `src/lib/spotify/fetchWithRetry.ts` share a process-wide circuit breaker.

| Constant / symbol | Location | Contract |
|-------------------|----------|----------|
| `spotifyRateLimitResetTime` | `fetchWithRetry.ts` (module state) | Epoch ms when the 429 window ends; `0` = closed |
| `DEFAULT_RETRY_AFTER_SECONDS` | `fetchWithRetry.ts` | **30 s** when `Retry-After` is missing or unparsable |
| `isSpotifyCircuitOpen()` | `fetchWithRetry.ts` | `Date.now() < spotifyRateLimitResetTime` |
| `spotifyApiFetch()` / `fetchSpotifyGetWithRetry()` | `fetchWithRetry.ts` | 429 trips the breaker and is **not** retried (502/503/504 still retry) |
| `searchSpotifyTrackUri()` | `src/lib/player/spotifyRemote.ts` | Cache first, then circuit fail-fast, then 3-tier Search (quoted fields → un-fielded title+artist → title-only) |

**Trip / fail-fast rules:**

1. Parse `Retry-After` as delta-seconds or HTTP-date; otherwise use **30 s**.
2. `tripSpotifyRateLimit()` extends `spotifyRateLimitResetTime` (never shortens an already-open window).
3. While the circuit is open, `spotifyApiFetch` / `fetchSpotifyGetWithRetry` return a synthetic `429` with a remaining `Retry-After` header — **zero** additional `fetch` to `api.spotify.com`.
4. `searchSpotifyTrackUri` MUST return `null` immediately when `isSpotifyCircuitOpen()` is true (after a cache miss) and write a 60 s negative-cache entry.

#### Bounded Search concurrency & LRU cache

`searchSpotifyTrackUri` is the only client Search entry. Station handoff may map up to 30 titles through it; the function itself serializes the burst.

| Constant | Value | Role |
|----------|-------|------|
| `SEARCH_CONCURRENCY` | **2** | Max parallel Search GETs (slot / waiter queue) |
| `SEARCH_URI_CACHE_LIMIT` | **256** | LRU cap; eviction drops the oldest key |
| `SEARCH_NEGATIVE_TTL_MS` | **60,000 ms** | TTL for 429s and circuit-open fail-fasts |

**Title / artist sanitization (MUST):** `searchSpotifyTrackUri` runs `sanitizeSpotifySearchTitle` / `sanitizeSpotifySearchArtist` before any GET. Empty sanitized titles return `null` without hitting Search.

`sanitizeSpotifySearchTitle` strips YouTube junk so `track:"…"` matches catalog names:

- Straight (`"`) and curly (`“` `”`) double quotes, single quotes, leftover brackets
- Video resolution tags (`1080p`, `720p`, `480p`, `4k`, `8k`, `hd`, `hq`, `mv`)
- Standalone 4-digit years (`1967`, `2021`); 8-digit `YYYYMMDD` date stamps (`19880110`)
- Featuring credits: parenthetical `(feat. …)` / `(ft. …)` / `(featuring …)` **and** trailing `ft.` / `feat.` / `featuring` plus the featured-artist string
- Generic parenthetical metadata (`(Official Video)`, `(Lyric Video)`, `(Audio)`, `(Remastered)`, `(EXCLUSIVE Performance!)`, …)
- Trailing dashes, pipes, and whitespace. `Artist - Song` keeps only the song portion

`sanitizeSpotifySearchArtist` isolates the primary catalog artist:

- Drops `- Topic` suffixes
- Aggregator / event / label channels (Audiotree, SMTOWN, KEXP, Vevo, Audacy, Audio Video Musica, `records`, `official`, …) return `""` so Search omits `artist:`
- Featuring phrases (`ft.`, `feat.`, `featuring`) and anything after them are stripped
- When multiple artists are joined by `&` or `,`, only the **primary (first)** name is kept

**Lookup order (MUST):**

1. Hit the LRU `artist:title` cache (including in-flight promises). Expired negative entries are dropped.
2. If the 429 circuit is open, fail-fast `null` and remember the miss until `SEARCH_NEGATIVE_TTL_MS`.
3. Acquire a Search slot (max 2), re-check the circuit, then run **3-tier** Search via `fetchSpotifyGetWithRetry`. Each later tier runs only when the previous produced no track URI and was not circuit-blocked / HTTP 429:

   | Tier | Query | When |
   |------|-------|------|
   | **1 — Quoted fields** | `track:"${title}" artist:"${artist}"` (or `track:"${title}"` when the artist is empty / an ignored YouTube channel) | Always first live GET |
   | **2 — Un-fielded** | `q = "${title} ${artist}".trim()` | Tier 1 is non-OK (502/400), empty, or a network error |
   | **3 — Title-only** | `q = "${title}"` | Tier 2 also missed **and** the query would not duplicate Tier 2 (empty artist skips this tier) |

   HTTP 429 does **not** trigger a later tier. Hits stay cached; 429 / circuit-open become 60 s negatives. Confirmed catalog misses stay cached without TTL. Each attempt logs 502s and empty result sets.

#### Companion volume ramps (SDK-only ticks)

Duck / swell ramps MUST NOT storm `PUT /me/player/volume`. Intermediate ticks (~33 ms on a hyped 400 ms swell) write **local Web Playback SDK `player.setVolume()` only** via `applySdkVolume`. Dual-path REST volume writes are restricted to:

1. User-initiated ControlDeck / master fader changes (`setSpotifyVolume`).
2. The **final landing write** of a ramp so Connect stays in sync with the SDK floor.

Connect-only sessions (no registered SDK player) may still REST-write ticks. A 12-step dual-path ramp on an embedded SongHost Radio device is a 429 defect.

#### Mode A / B transport unpause (SDK-verified playhead)

Mode A resume-at-duck-floor and Mode B hard-launch MUST unpause the **local** SDK player (`player.resume()` / `player.seek(ms)`) before Connect REST, and MUST append `device_id` on REST `play` / `seek`. `resumeActivePlayer()` MUST verify `getCurrentState().paused === false` (retry SDK `resume()` once if still paused) before the FSM enters `PLAYING_MUSIC`. A Connect `200` on `PUT /me/player/play` is **not** playhead motion.

---

## 2. UI & Image Assets / Fallbacks

YouTube CDN thumbs (`i.ytimg.com/vi/{id}/{file}`) are not guaranteed at every quality. A 404 on `hqdefault.jpg` (or a higher published file) MUST NOT leave a broken image in the deck, station cards, or queue mosaic.

**Canonical renderer:** `src/components/common/ArtworkImage.tsx` is the only artwork component for `StationCard`, `ControlDeck`, and `QueueModal`. On `onError` it calls `nextYouTubeThumbnailFallback()` in `src/lib/youtube/ids.ts`.

**YouTube CDN thumbnail quality ladder (MUST):**

1. `hqdefault.jpg` (cards prefer `hq`; `maxresdefault.jpg` / `sddefault.jpg` enter the ladder at `hq`)
2. `mqdefault.jpg`
3. `default.jpg`
4. Icon fallback — lucide `Disc3` (default / `StationCard` / `QueueModal` mosaic) or `Radio` (`ControlDeck` now-playing). Non-YouTube URLs that 404 skip the ladder and go straight to the icon.

Non-`i.ytimg.com` sources and an exhausted ladder return `null` from `nextYouTubeThumbnailFallback` and render the icon. Empty / missing `src` renders the icon immediately.

### 2.1 ControlDeck dock & unconditional player mount (MUST)

The home cockpit is a **split chrome** layout. Presentational only — it MUST NOT remount the audio engine.

| Layer | Contract |
|-------|----------|
| **BrandHeader** | Slim `sticky top-0 z-50` bar in `ControlDeck.tsx` — logo, RADIO/STUDIO, auth. No transport, no YouTube host. |
| **ControlDeck dock** | `fixed bottom-0 inset-x-0 z-50 bg-[#09090b]/92 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]`. Holds transport, Host Studio pill, Host Controls drawers, pinned mobile `trackActions`, and `{children}`. |
| **Dashboard column** | `page.tsx` content uses `pb-32` / `md:pb-36` so Heavy Rotation / carousels clear the dock. |
| **`{children}` slot** | Unconditionally mounted inside the dock wrapper. Contains `<AudioPlayer>` (seek bar + offscreen `yt-player-host`). MUST NOT be gated on idle, sheet-open, `md` breakpoint, or Host Studio open. A remount would reset `useStationQueue` (`stationId` / `queueGeneration` effects). |
| **YouTube host** | Already `fixed -left-[9999px]` in `AudioPlayer.tsx`. Moving the dock does not move the iframe; the seek bar travels with `{children}`. |
| **Live Actions (unrendered)** | Manual DJ override controls (`Break Now`, `Skip DJ`, `DJ Standby` via `HostLiveActions`) are **unrendered** in the UI. `HostSettingsModal` and `HostControlsBar` keep `onBreakNow` / `onSkipDj` / `orchestratorStatus` on their prop interfaces. Handlers stay wired on `page.tsx` (`triggerBreakNow` / `skipActiveBreak` from `useWebOrchestrator`) so orchestration remains active. |

`MobilePlayerSheet` keeps `showMiniBar={false}` so it does not mount a second AudioPlayer.

---

## 3. Companion Playhead, History & Telemetry

### 3.1 `actualPlaybackHistory` metadata coherence (MUST)

`WebOrchestrator.actualPlaybackHistory` is the lore-recap source of truth (newest last, cap 5). DJ commentary recaps (`previousTrack` / `recentHistory`) MUST be derived strictly from this verified session playback (page `sessionPlayedRef` is the React mirror). Queue-offset slices and local-storage hydrate cursors MUST NOT back-fill recaps. Every append MUST be **identity-coherent**: never write a history tuple whose title/artist belong to a different `trackId` or URI. After `flushForStationLaunch` / `abortPendingSpeechAndClearBuffers`, empty history MUST omit `previousTrack` (opener / song intro).

`recordActualPlayback()` / `buildLiveTrackInput()` resolve metadata in this strict order, each source requiring `source.id === targetTrackId` (Spotify catalog id or `spotify:track:` URI, compared via `normalizeSpotifyTrackId`):

1. `getCurrentTrackState()` — SDK active track from the current event.
2. Queue row via `findQueueIndexForPlayingTrack` (same lookup as `syncIndexToPlayingTrack`), then require the row's `spotifyId` or `youtubeId` to match `targetTrackId`.
3. REST `getCurrentlyPlayingTrack()` **only if** the returned URI / id matches `targetTrackId`.
4. `djPrefetchByTrackId.get(trackId)` **exact key only** — never fall back to `nextPrefetchKey` (that key is the upcoming warmup and would mix Track N+1 title/artist onto Track N).

If no coherent match exists, **skip** the history append (debug log) rather than storing a mixed/stale tuple. Consecutive same-`trackId` appends still dedupe.

### 3.2 Cross-break script history & anti-repetition (MUST)

Companion DJ breaks forward the last six aired scripts so the LLM does not retell origin cities, album facts, or chart peaks across consecutive clips.

**Payload** (`WebOrchestrator.fetchDjAudio` → `POST /api/generate-script`):

```ts
recentBreakHistory: this._broadcastHistory.slice(-6).map(e => e.script)
styleRotationIndex: this._broadcastHistory.length
```

`/api/generate-script` parses `recentBreakHistory` and folds it into `buildAntiRepetitionDirective()` alongside fact-engine `excludedFacts`. The system prompt's **CROSS-BREAK MEMORY** block lists the recent scripts and forbids repeating those facts.

**Pillar rotation:** Companion lore (`generateLoreScript`) calls `pickMusicologyPillar(styleRotationIndex)` so `roots_branches` rotates across chart, studio, personnel, lyrical, and era pillars instead of defaulting to origin stories every break.

**Mode A word ceiling:** `LORE_WORD_TARGETS.roots_branches` is **25–32 words (~12–14s)**; `loreWordCeiling` / `truncateToWordLimit` cap at **32**. This is a script-budget rule — `MODE_A_DURATION_THRESHOLD_SEC` stays **15.0**.

**ElevenLabs Turbo bounds** (`STANDARD_VOICE_SETTINGS` / `voiceSettingsForPersonality`): `stability >= 0.55`, `style <= 0.15`, `use_speaker_boost: false`. Lower stability or higher style on `eleven_turbo_v2_5` causes pitch jumps, distortion, and rushed cadence.

---

## 4. TTS Synthesis Pipeline

Script generation (`/api/generate-script`) and shared prep (`src/lib/tts.ts`) produce the spoken payload. Downstream engines (ElevenLabs, OpenAI `tts-1`) receive only sanitized plain text.

### 4.1 TTS Input Sanitization

**SSML Stripping:** Strip or convert all XML / SSML tags (e.g. `<break time="..."/>`, `<say-as>`, and other markup) into natural punctuation (commas, periods, or ellipses) **before** dispatching text to third-party TTS engines that do not support raw XML payloads (including ElevenLabs REST and OpenAI `tts-1`). Raw SSML MUST never appear in the synthesis request body.

**Script sanitization (`sanitizeDjScript`):** Before TTS, strip markdown headers (`#` heading prefixes), underscores (`_`), paired and unpaired asterisks (`*`), stage directions (`[…]`, `(…)`, `*…*`), emojis / pictographs, and orphan trailing punctuation (commas, dashes, leftover markdown). Collapse whitespace.

**Mode A pause formatting (`formatScriptForTts({ compactPauses: true })`):** For `standard` and `roots_branches`, insert pauses only at true sentence boundaries (`.!?`). Do **not** inject per-clause ellipses or comma-split chunks joined by `" ... "` — those inflate spoken duration past the 15.0s Mode A threshold.

### 4.2 ElevenLabs Turbo voice parameters

`eleven_turbo_v2_5` (`ELEVENLABS_TTS_MODEL_ID`) MUST use:

| Parameter | Bound |
|-----------|-------|
| `stability` | **≥ 0.55** |
| `style` | **≤ 0.15** |
| `use_speaker_boost` | **false** |

`clampTurboVoiceSettings()` in `src/lib/dj/voice-settings.ts` enforces the floor/cap. `STANDARD_VOICE_SETTINGS` in `src/data/personas.ts` matches these bounds for the whole roster.

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

**Host-state setter hydrate (MUST):** On orchestrator construct and preference rehydrate, `useWebOrchestrator.applyHostState(..., { silent: true })` stamps `isPro`, persona, `allowExplicit`, `commentaryFormat`, `vibePrompt`, `djMode`, and `djTuning` without bumping `sessionEpoch` or aborting speech. Subsequent settled changes (after the **400ms** debounce) call `abortPendingSpeechAndClearBuffers` at most once and MUST NOT follow with `flushPrefetch()`. See §1.0 Single-Execution & Cleanup Rules.

**Naming convention (MUST):** Client persistence keys use `songhost_*` (underscore) or `songhost:*` (colon) prefixes. Reads MUST check the canonical `songhost_*` / `songhost:*` key first; if absent, read the legacy `songghost_*` / `songghost:*` key, copy the value forward into the canonical key, and continue. Writes always go to the canonical key. Never perform a hard breaking key change on local/session storage.

**Spotify Connect device name (MUST):** The embedded Web Playback SDK player MUST initialize with `name: "SongHost Radio"` so the listener's Connect device list shows SongHost Radio.

**Host identity lock (MUST):** The persisted / UI host id is resolved through `resolvePersonaId()` before TTS. Short Pro aliases are explicit — `"devon"` → `"devon-pulse"` — and MUST NOT collapse to `DEFAULT_PERSONA` (`miles`). TTS synthesis MUST preserve that resolved host: a Devon lock cannot air Miles, Rachel, or OpenAI `onyx` audio while the UI still shows Devon.

### 5.2 Hydration priority (MUST)

On client store hydration (`hydrateSessionStore()` during app boot / refresh):

1. Read `savedHostId = localStorage.getItem('songhost_active_host_id')` and `savedHostLocked = localStorage.getItem('songhost_is_host_locked') === 'true'`.
2. If a non-empty `savedHostId` exists:
   - Set session `activeHostId = savedHostId`.
   - If `savedHostLocked === true`, set `isHostLocked = true`.
3. Station initialization / default-station loading on mount MUST check **`isHostLocked || savedHostId`** (`shouldRetainHost()`) **before** applying `station.defaultPersonaId` / `defaultHostId`. A restored host id **MUST take priority** over curated station defaults so a refresh cannot silently replace Jasper (or any locked pick) with the station's default DJ.
4. `resetHostLock()` clears both the in-memory lock and the persisted host id / lock keys so the next launch may auto-match again.

**Orchestrator host-state stamp (MUST):** After Host Retention + UserPreferences hydrate, `ensureOrchestrator` / first `applyHostState` MUST write constructor fields with `{ silent: true }`. Boot drips from Clerk login, cloud prefs merge, and `TierProvider` MUST coalesce in the **400ms** debounce and MUST NOT each bump `sessionEpoch`.

**Spotify handshake gate (`isSpotifySyncPending`):** On Spotify companion session restore, `useStationQueue` hydrates the persisted queue into memory immediately so `syncIndexToPlayingTrack` can resolve the live URI. It MUST NOT stamp ControlDeck metadata (`stampQueueOpener`) while pending. Default is `true` when the restored queue carries Spotify catalog ids; YouTube restores are `false` and paint immediately. `page.tsx` `onTrackStarted` clears the flag immediately (even on a `-1` relink miss). `runReset` clears it at the start of non-hydrate relaunches. While pending, `ControlDeck` renders the placeholder ("Tuning in…", no artwork) even if restored `sessionStorage` title/artist/art props exist — eliminating the visual jump (e.g. "Creep" → live SDK track). See §5.4 for the full handshake release lifecycle.

### 5.3 DJ TTS speech routing (MUST)

All companion DJ TTS audio MUST be decoded and played through the Web Audio API — **not** an unattached `HTMLAudioElement` — to prevent browser media-element mute / autoplay bugs:

1. Fetch the TTS payload as an `ArrayBuffer` and decode with `audioContext.decodeAudioData(arrayBuffer)`.
2. Create an `AudioBufferSourceNode` (`speechSource`) and assign the decoded buffer.
3. Create a dedicated `GainNode` (`speechGain`) seeded from `localStorage.getItem('songhost_dj_volume')` (fallback `0.85`). Companion Web Audio speech gain is **decoupled from linear `masterVolume` attenuation**: `masterVolume` is a **0-only mute gate** (deck mute still silences speech; any `masterVolume > 0` does not scale the voice). Effective gain is `djVolume * VOICE_HEADROOM_BOOST`, allowing the `GainNode` to reach **1.35** max. Do **not** apply `clampGain`'s 1.0 ceiling on this Web Audio path.
4. Connect **`speechSource → speechGain → audioContext.destination`**.
5. Ensure `audioContext.state === 'running'` (`resume()` when suspended) before `speechSource.start(0)`.
6. If an `HTMLAudioElement` fallback is unavoidable (Web Audio unavailable), set `audio.volume` and `audio.muted = false` **before** calling `audio.play()`. The **1.0 clamp remains only** on this media-element fallback (`HTMLAudioElement.volume` cannot exceed 1.0).

**Fail-closed voice integrity (MUST):** `/api/generate-script` and `/api/generate-voice` MUST synthesize the active host's mapped voice only. On ElevenLabs `400` / `402` / `429` (or a complete engine fault), do **not** fall through to a female premade (Rachel), a different Pro host (Miles), or generic OpenAI `tts-1` (`onyx` / `alloy`) while claiming the locked host. Fail the DJ break instead so music continues without a voice jump. Prefetched clips MUST match `activePersonaId` / `activeVoiceId` before playback; stale or mismatched buffers are discarded.

**Segment kind → teleprompter (MUST):** When DJ speech actually starts (`playFreshDjClip` / HTMLAudio fallback), `WebOrchestrator` MUST fire `onDjStart({ kind })`. Station launch liners, custom liners, and default companion breaks emit `kind: "song_intro"`. Studio cues may pass a mapped `DjSegmentKind` when authored. `useWebOrchestrator` MUST forward `info.kind` into `startDjSegment` — never hardcode `artist_trivia`. `ScriptTeleprompter` and `BroadcastHistoryDrawer` render `song_intro` as the **INTRO** badge pill.

**Mode A / B unpause after speech (MUST):** After Mode A swell or Mode B hard-launch, the companion transport MUST be SDK-verified as playing (`getCurrentState().paused === false`) before the orchestrator returns to `PLAYING_MUSIC`. Do not treat a REST resume `200` as proof the local playhead is moving. Volume ramps during that window stay on `player.setVolume()` so REST 429s cannot freeze the SDK at a stale position.

### 5.4 Mobile Gesture CTA Transport Handoff

iOS/Android will not resume a suspended `AudioContext` (or the silent WAV anchor) without a user gesture. While `isSpotifySyncPending` is true, mobile ControlDeck (`< md`) MUST render an interactive button instead of static "Tuning in…" text:

- **"Tap to Resume Radio"** when a live Connect session or persisted `lastStationId` exists
- **"Tap to Tune In"** otherwise

`page.tsx` `handleStandbyResume` runs **inside the tap** (no `setTimeout` before unlock):

1. `ensureListening()` — `markAudioUnlockRequested` / `primeAudioOnGesture` / `primeSilentAudioAnchor` / mix-bus `unlock()` + `context.resume()` / `playerRef.unlockAudio()`.
2. **Path A (Live Session)** — Spotify Connect has an active URI / companion session → `handlePlayPause` (forced resume: `isPlaying: false`) with `resume` / `transferPlayback` / `playTrack(restoredUri)`.
3. **Path B (Persisted Session)** — `lastStationId` from JSONB prefs (fallback: `readPersistedActiveStationId()`) resolves via `findTunableStation` → `selectStation`. Skip unresolvable `heavy-rotation-*` ids.
4. **Path C (Fallback)** — `playHeavyRotationStation()`.

Do **not** clear `isSpotifySyncPending` in the tap. Leave that to `onTrackStarted` (and `syncIndexToPlayingTrack` as a secondary path) so ControlDeck cannot flash a stale `sessionStorage` title.

#### Handshake release lifecycle (MUST)

Station launch and session restore share one pending mask (`isSpotifySyncPending` → ControlDeck "Tuning in…") and one SDK event lock (`isLaunchingStation`).

| Phase | Lock / mask | Release |
|-------|-------------|---------|
| `beginStationLaunchLock(uris)` | Arms `isLaunchingStation` only when `flushSession === true` **and** `uris` is non-empty | Confirm when the live id matches **any** launched URI (`normalizeSpotifyTrackId`) or `linked_from.id`. Steer / mid-session companion advances (`flushSession: false`) MUST NOT arm this lock. |
| Safety timeout | Lock still armed after **3000 ms** | If SDK audio is actively playing, release `isLaunchingStation` so `player_state_changed` reaches `onTrackStarted` / `registerTrack` |
| `onTrackStarted` | `isSpotifySyncPending` | `page.tsx` MUST call `clearSpotifySyncPending()` and `setIsSpotifySyncPending(false)` **immediately**, even if `findQueueIndexForPlayingTrack` returns `-1` |
| `runReset` (non-hydrate) | leftover pending flag | Reset `isSpotifySyncPending` to `false` at the start of a fresh station assemble so Heavy Rotation / preset launches cannot inherit a restore mask |

Track transitions on songs 2+ MUST call `registerTrack(liveTrackId)` (advancing `registeredTrackIdRef`) once the launch lock is clear — **including** while `broadcastState === PREFETCHING_BREAK` — so Autopilot prefetch consume and live `isDjBreakDue()` checks can run. Skip registration only during `MODE_B_BED_FADE` / `MODE_B_SPEAKING`. Do not bump `sessionEpoch` on these hops. A matching prefetched break for the live track ID MUST execute (`"Executing prefetched DJ break"` / `"Using prefetched DJ break"`) via Mode A ducking (Mode B only when decoded TTS > 15s) and MUST NOT be replaced by `getStationLaunchLiner`. `sessionLaunchPending` is a Track 1 one-shot and is already consumed on Track 1's first transition/attempt or any early return.

`lastStationId` is stamped in `beginStationSession` into the prefs blob and debounced to `users.preferences` JSONB via `schedulePreferencesSync`. Search launches (Full Album `album-deep-dive-*`, Artist Radio, Song Radio, AI Curator, Studio Mixes `studio-*`, tuner `tuner-*`) dual-write the live `{ stationId, station, queue, currentIndex }` snapshot to tab `sessionStorage` **and** `localStorage` `songhost:last_session` so they remain the primary active station across tabs and browser restarts. Boot restore is quiet (no Spotify playhead command): `sessionStorage` → `songhost:last_session` → `lastStationId` lookup → Heavy Rotation fallback. Heavy Rotation auto-stage MUST NOT run while last-session rehydration is pending, or when `lastStationId` is populated and is not `heavy-rotation-*`. Cloud preference GET must not overwrite a newer in-session `lastStationId`; the local id is pushed on the next prefs sync. Host Retention (`hostRetention.activeHostId` / `isHostLocked`) lands on `sessionStore` (`songhost_active_host_id`, `songhost_is_host_locked`) during cloud hydrate so station auto-match cannot overwrite a restored host. Ducking ratios, Mode A/B transport hold timing, and volume ramps MUST NOT change on this path.

`lastStationId` is stamped in `beginStationSession` into the prefs blob and debounced to `users.preferences` JSONB via `schedulePreferencesSync`. Search launches (Full Album `album-deep-dive-*`, Artist Radio, Song Radio, AI Curator, Studio Mixes `studio-*`, tuner `tuner-*`) dual-write the live `{ stationId, station, queue, currentIndex }` snapshot to tab `sessionStorage` **and** `localStorage` `songhost:last_session` so they remain the primary active station across tabs and browser restarts. Boot restore is quiet (no Spotify playhead command): `sessionStorage` → `songhost:last_session` → `lastStationId` lookup → Heavy Rotation fallback. Heavy Rotation auto-stage MUST NOT run while last-session rehydration is pending, or when `lastStationId` is populated and is not `heavy-rotation-*`. Cloud preference GET must not overwrite a newer in-session `lastStationId`; the local id is pushed on the next prefs sync. Host Retention (`hostRetention.activeHostId` / `isHostLocked`) lands on `sessionStore` (`songhost_active_host_id`, `songhost_is_host_locked`) during cloud hydrate so station auto-match cannot overwrite a restored host. Ducking ratios, Mode A/B transport hold timing, and volume ramps MUST NOT change on this path.
