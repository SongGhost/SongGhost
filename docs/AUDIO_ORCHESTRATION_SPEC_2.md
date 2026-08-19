# SongHost Audio Orchestration & DJ Engine Specification
**Version:** 3.3.0  
**Status:** Canonical Reference  
**Supersedes:** `docs/AUDIO_ORCHESTRATION_SPEC_2.md` v3.2.0 (DirectStream TRACE 4 split) and v3.1.0 (DirectStream pivot) and v3.0.0 / v2.0.0 (companion-SDK-primary) and `docs/AUDIO_ORCHESTRATION_SPEC.md` (v1.0.0) for track-advance telemetry, skip-mutex, Spotify 429 circuit-breaker, mix-bus ducking, and statutory-radio rules

SongHost primary audio is a **statutory non-interactive radio engine** under SoundExchange **§114 / §112**. The live music bus is **`DirectStreamProvider`**: an un-suppressed native HTML5 `<audio>` element. Mix-bus `musicGain()` ducks the element; `captureMediaElement` opens a **single** analyser tap (never a second `MediaElementAudioSourceNode`). `AudioPlayer` hardcodes `suppressLocalAudio = false`. Spotify, Apple MusicKit, and YouTube IFrame adapters are preserved as quarantined reference code under `src/lib/audio/legacy/`. Connection chrome is unmounted; `useWebOrchestrator` returns `companionActive: false`.

> **Quarantine rule (MUST):** Historical Spotify Web Playback SDK, Apple MusicKit JS, and YouTube IFrame API contracts are **not deleted**. They live under `src/lib/audio/legacy/` as reference adapters. They are **not** the production transport. New station launches MUST attach to `DirectStreamProvider`. Companion Mode A/B, OAuth, 429, telemetry, and YouTube first-song rules below remain the frozen source of truth for that quarantined code.

---

## 1. Finite State Machine (FSM) & Mutex Locking

To guarantee zero double-DJ executions, overlapping voice clips, or desynchronized track ducking, the audio orchestrator MUST operate as a strict Finite State Machine.

### Primary bus: `DirectStreamProvider` → `mix-bus.ts`

Production music is a native HTML5 `<audio>` element. Mix-bus `musicGain(master, duck)` is applied **on the element volume** so ducking cannot double-apply. `captureMediaElement` may open a **single** `MediaElementAudioSourceNode` analyser tap into `src/lib/audio/mix-bus.ts` once the AudioContext is running. DJ speech is a separate voice bus (`BufferedVoiceNode` / `AudioBufferSourceNode` → `speechGain`). Only the music channel is sidechained. The voice bus is **never** ducked.

```text
  [ IDLE ]
     │  audio unlock
     ▼
  [ PAUSED_UNTIL_UNLOCK ]
     │  emit on-playing once per track load (hold may keep element paused)
     │  Track 1: arm launchHoldActive (default hard_pause)
     ▼
  [ LAUNCH_HOLD ] ── hard_pause: element paused @ 0:00, zero unducked leaks
                  ── intro_ramp: element playing from 0:00 at DUCK_RATIO 0.18
     │  opener on-air → releaseLaunchHold
     ▼
  [ PLAYING_MUSIC ] ──(Trigger Break)──► [ PREFETCHING_BREAK ]
                                                │  isolated prefetch (off-graph)
                                                ▼
                                    [ DUCKING_MUSIC ]
                                      300ms linear → DUCK_RATIO 0.18
                                                │
                                                ▼
                                    [ SPEAKING_DJ ]
                                      voiceGain / speechGain; music held at 0.18
                                                │
                                                ▼
                                    [ RESTORING_MUSIC ]
                                      1500ms restore → 1.0
                                                │
                                                ▼
                                         [ PLAYING_MUSIC ]
```

**FSM States Defined (live DirectStream bus)**

**IDLE:** Audio engine initialized, no tracks queued or playing.

**PAUSED_UNTIL_UNLOCK:** First-song (and any locked autoplay) hold. The media element MUST remain paused until the listener gesture unlocks the `AudioContext` / mix-bus (`unlock()` + `context.resume()`). Unlock MUST still honor `launchHoldActive` (see **LAUNCH_HOLD**).

**LAUNCH_HOLD:** Track-1 transport lock on `DirectStreamProvider` (`launchHoldActive`). Independent of `sessionOpeningDjRef` (DJ planning). While set, `play()` / unlock / clean-start MUST NOT leak unducked PCM. Two modes:

- **`hard_pause`:** media element stays paused at `0:00`. `beginPlaybackFromStart()`, `ensurePlayback()`, and `applyUnlock()` pause + seek `0` and MUST NOT call `playElement`. Hold-induced `pause` events MUST NOT bounce React `isPlaying` (`onPaused` suppressed while `intendedPlaying` remains true).
- **`intro_ramp`:** element volume is pre-set at `DUCK_RATIO = 0.18` from time `0:00` before any audible frame. Unlock / clean-start MAY play, but only after `setDuckGain(DUCK_RATIO)`.

Default arm on `stationId` / `queueGeneration` change is `hard_pause` (zero-frame). `handleNewTrack` may promote to `intro_ramp` when `resolveStationLaunchHoldMode` confirms an instrumental bed ≥ 3s. `setLaunchHold` MUST NOT flip `intendedPlaying`.

**PLAYING_MUSIC:** DirectStream music playing at 100% mix-bus music gain (`UNDUCKED_GAIN = 1`, relative to master). Duck gain is re-asserted on ready / load-settle / playing because a new `HTMLAudioElement` starts at element volume 1.0 until `mix-bus` reapplies `musicGain`. Track 1 MUST NOT enter this state at full gain while `launchHoldActive` is set.

**PREFETCHING_BREAK:** Fetching script from `/api/generate-script` and downloading/synthesizing TTS audio blob. DirectStream does **not** route on companion Mode A vs Mode B. Mid-session music keeps playing at full gain until duck-in. Prefetch lookahead still uses `getPrefetchLeadSeconds` (30s / 45s / 60s). Warmed clips are **off-graph** (`VoiceNode.preload`) — they MUST NOT attach to the live session `AudioContext` or `MediaElementAudioSourceNode`. Prefetch completion is **not** on-air (see TRACE 4 split). Track 1 session openers skip this prefetch consume path.

**DUCKING_MUSIC:** Music ducks from 100% to **`DUCK_RATIO = 0.18`** of master over **`DUCK_RAMP_MS = 300ms`** linear. Voice bus is untouched.

**SPEAKING_DJ:** DJ speech plays on the voice bus at `djVolume * VOICE_HEADROOM_BOOST` (see §5.3). Music stays at the 0.18 floor. Voice is **never** sidechained.

**RESTORING_MUSIC:** Speech ends (+ small tail). Music restores to 100% over **`RESTORE_RAMP_MS = 1500ms`**.

#### Sidechain ducking constants (live — `src/lib/audio/mix-bus.ts`)

| Parameter | Constant | Value |
|-----------|----------|-------|
| Duck target | `DUCK_RATIO` | **0.18** (18% of master) |
| Duck-in ramp | `DUCK_RAMP_MS` | **300 ms** linear |
| Restore ramp | `RESTORE_RAMP_MS` | **1500 ms** |
| Voice headroom | `VOICE_HEADROOM_BOOST` | **1.35×** |
| Unducked music | `UNDUCKED_GAIN` | **1** |
| Voice floor | `MIN_VOICE_GAIN` | **0.1** |

`musicGain(master, duckGain)` keeps ducked music tracking the fader. `voiceGain` / DirectStream `speechGain` take **no** duck parameter — structural guarantee that speech is never sidechained.

#### DirectStream first-song invariant (MUST)

All launch paths (preset station, AI Curator, Artist Radio, Live Channel Dial, Station Blueprint):

1. Pause until audio unlock (`markAudioUnlockRequested` / `primeAudioOnGesture` / mix-bus `unlock()` + `context.resume()`).
2. Arm `launchHoldActive` (default `hard_pause`) on `stationId` / `queueGeneration` change **before** the provider's play/load effects run, so the first `ensurePlayback` / clean-start cannot leak unducked PCM.
3. Play from position **0** under the hold: `hard_pause` stays paused at `0:00`; `intro_ramp` may play only at `DUCK_RATIO = 0.18`.
4. Emit on-playing **once per track load** (a hard-pause hold still emits `onPlaying` so the UI is on-air; it MUST NOT emit `onPaused`).

Do **not** arm `sessionOpeningDjRef` on `videoId` / stream-URL / track advance — only on `stationId` or `queueGeneration` change. Track 1 receives `planDjSegment({ isSessionOpening: true })` → `full_break` with `kind: "song_intro"` unless `chatterPacing === "music_only"`.

##### Launch-hold method contract (`DirectStreamProvider` / `useDirectStreamPlayer`)

| Method | Contract |
|--------|----------|
| `setLaunchHold(active, mode = "hard_pause")` | Arms or releases `launchHoldActive` / `launchHoldMode`. Does **not** flip `intendedPlaying`. `intro_ramp` immediately `setDuckGain(DUCK_RATIO)` then `applyLaunchHold()`. |
| `releaseLaunchHold()` | Clears `launchHoldActive` only. Does not play, seek, or restore gain — `AudioPlayer.releaseOpenerHold` owns swell / resume. |
| `isLaunchHoldActive()` / `getLaunchHoldActive()` | True while the opening break owns the licensed element. |
| `getLaunchHoldMode()` | `"hard_pause"` \| `"intro_ramp"`. |
| `holdForOpeningBreak` | Boolean alias of `launchHoldActive`. |

Hold enforcement (MUST): `beginPlaybackFromStart()`, `ensurePlayback()`, and `applyUnlock()` consult the flag on every entry.

- `hard_pause`: `audio.pause()`; `currentTime = 0`; no `playElement`. User-gesture unlock clears `pendingUnlock` without leaking a frame.
- `intro_ramp`: `setDuckGain(DUCK_RATIO)` **before** `playElement` / clean-start so a gesture unlock cannot leak a full-level frame.

##### Opener pause / pre-duck & network bypass (`AudioPlayer.handleNewTrack`)

When `sessionOpeningDjRef` is true, `handleNewTrack` MUST arm the transport hold **synchronously** before any `await` (`djPrefetch.take`, authored-cue fetch, `resolveLocalEvent`, TTS):

1. Snapshot `isSessionOpening = sessionOpeningDjRef.current`.
2. Call `shouldPauseForStationLaunchVocals(0, true)` — the second argument (`launchHoldActive`) forces the playhead to a true `0:00`. Leaked autoplay ticks MUST NOT flip a cold vocal start from `hard_pause` into `intro_ramp`.
3. `resolveStationLaunchHoldMode({ introDurationSec })` may keep `intro_ramp` when a confirmed instrumental bed is **≥ 3s**; otherwise `pauseForVocals` selects `hard_pause`.
4. `setLaunchHold(true, openerHoldMode)`. `hard_pause` seeks the licensed element to `0`; `intro_ramp` sets the duck bus to `DUCK_RATIO` immediately.

Station-launch liners MUST skip `resolveLocalEvent` (`warmed || isSessionOpening ? null : await resolveLocalEvent(artist)`). Location fetch latency MUST NOT delay Track-1 TTS synthesis. Session openers also skip `djPrefetch.take` / shared-map consume so a stale lookahead cannot steal the opener.

`abortIntro()` MUST NOT reset the duck bus to `UNDUCKED_GAIN` while `launchHoldActive` is set (that would blare an unducked frame before the opener). `releaseOpenerHold(swellFromDuck)`: `hard_pause` resumes from `0:00` at 18% then swells; `intro_ramp` stays playing and lets VoiceNode restore. Never toggles React `isPlaying`.

---

### Quarantined Companion Mode A / Mode B FSM

> **QUARANTINED REFERENCE** — `src/lib/audio/legacy/` (`useWebOrchestrator.ts`, `webOrchestrator.ts`, Spotify Web Playback SDK, Apple MusicKit JS). Not the production music bus. Preserved 100% intact. Format-aware Pause–Talk–Resume on this path is Phase 6 and MUST NOT be documented as live.

Companion duration-based Mode A / Mode B remains the frozen contract for quarantined Spotify / Apple adapters. Routing uses `decodedAudioBuffer.duration` after `audioContext.decodeAudioData` — HTML5 `loadedmetadata` MUST NOT be used for this routing. If duration is missing, `NaN`, `Infinity`, or otherwise unknown, the orchestrator MUST **fail closed to Mode B** after decode.

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
```

**Quarantined FSM states**

**IDLE:** Audio engine initialized, no tracks queued or playing.

**PLAYING_MUSIC:** Track audio playing at 100% volume gain (1.0).

**PREFETCHING_BREAK:** Fetching script from `/api/generate-script` and downloading/synthesizing TTS audio blob. Companion Mode A vs Mode B is decided here from `decodedAudioBuffer.duration` after `audioContext.decodeAudioData` — HTML5 `loadedmetadata` MUST NOT be used for this routing. If duration is missing, `NaN`, `Infinity`, or otherwise unknown, the orchestrator MUST **fail closed to Mode B** after decode.

**Zero-audible-cut entry freeze (MUST):** When a break is due and no decoded speech buffer exists, `freezeIncomingCompanionTransport()` MUST set transport volume to **0** and hold Track B at position **0:00** *before* initiating `runDjBreakInternal` live `fetchDjAudio`. Await freeze completion so audio frames never play aloud prior to mode resolution. This is the default-silent gate — it MUST NOT duck the vocal tail of outgoing Track A.

**Mode A ducking target (MUST):** Speech ducking applies exclusively to the instrumental intro of incoming Track B. NEVER duck or fade the vocal tail of outgoing Track A while speech is executing. After decode proves Mode A (`duration <= 15s`), resume Track B at the mood-aware duck floor and speak in-band over the intro.

**Stale `PREFETCHING_BREAK` exit (MUST):** `registerTrack` MUST process live track transitions while `broadcastState === PREFETCHING_BREAK`. Skip `registerTrack` only for active Mode B speech (`MODE_B_BED_FADE` / `MODE_B_SPEAKING`). When `currentTrackId` changes, exit any stale prefetch hold (`releaseUnusedIncomingHold` / `exitPrefetchToMusic`) **before** evaluating a hold for the incoming track. `hasWarmedBreakForTrack` MUST match the incoming track ID or SDK title/artist alias — never a global `nextPrefetchKey`. `takePrefetchForTrack` MUST match against `getCurrentTrackState()` and MUST NOT await REST currently-playing.

**MODE A: DUCKING_OUTRO:** Incoming Track B volume ducks from 100% (1.0) to the mood-aware **relative** duck floor (default `0.18`; Chill `0.12`; Hyped `0.25`) over a **600ms** linear ramp (`MODE_A_DUCK_RAMP_MS`). Outgoing Track A is already finished at full volume. This floor is **not** Mode B station-bed gain. See the Mood Ducking Matrix below.

**MODE A: SPEAKING_DJ_INBAND:** DJ speech audio plays over Track B's ducked instrumental intro. Track A MUST NOT be ducked.

**MODE A: SWELLING_INTRO:** Speech completes. Track B executes a logarithmic volume swell from the ducked floor to 100% (1.0) over **800ms** default (`MODE_A_SWELL_MS_DEFAULT`; Chill `1200ms`; Hyped `400ms`).

**MODE B: FADE_TO_STATION_BED:** Track A finishes cleanly at full volume (no vocal-tail fade). Track B is already held at `0:00` / volume 0 from the entry freeze. Genre station bed loop fades in to **0.25** (`MODE_B_BED_GAIN`) over **1500ms** (`MODE_B_FADE_MS`). Track B MUST NOT advance during the bed fade.

**MODE B: SPEAKING_DJ_STATION_BED:** DJ delivers long-form commentary (Director's Cut / clips > 15s) over station bed. Track B remains **held or paused at `0:00` with transport volume 0**. Single-URI `playTrack` and SDK auto-advance events that land during this state MUST re-freeze the playhead at `0:00`.

**MODE B: HARD_LAUNCH_TRACK_B:** Speech ends. Station bed pitch/volume decays over **400ms** (`MODE_B_BED_DECAY_MS`). Track B **seeks to position `0:00` and unpauses at volume 0**, then ramps to 100% (1.0) over **800ms** (`MODE_B_LAUNCH_RAMP_MS`) so the listener hears the track intro from the beginning.

---

### 1.0 Canonical Mix, Mood Ducking & Prefetch Constants

**Role separation (MUST):** Live DirectStream ducking (`DUCK_RATIO = 0.18`, `DUCK_RAMP_MS = 300`, `RESTORE_RAMP_MS = 1500`) is distinct from quarantined companion Mode A ducking floor (`MODE_A_DUCK_RATIO_*`, default **0.18** of pre-break volume) and from Mode B station-bed gain (`MODE_B_BED_GAIN = 0.25`). Do not treat `0.25` as the standard Mode A duck or as the live DirectStream floor. `0.25` applies only to quarantined Mode B bed gain and Hyped Mode A (`MODE_A_DUCK_RATIO_HYPED`).

#### Live DirectStream mix-bus (primary)

YouTube / HTML5 historical mix-bus path and live DirectStream share `src/lib/audio/mix-bus.ts`: `DUCK_RATIO = 0.18`, `DUCK_RAMP_MS = 300`, `RESTORE_RAMP_MS = 1500`, `VOICE_HEADROOM_BOOST = 1.35`.

#### Mood-aware Mode A ducking matrix (quarantined companion)

Live constants in `src/lib/player/webOrchestrator.ts` (quarantined). Duck-in ramp is always **600ms** linear (`MODE_A_DUCK_RAMP_MS`); swell is logarithmic.

| Mood | Duck floor (relative) | Duck-in ramp | Swell (log) |
|------|----------------------|--------------|-------------|
| Default | `0.18` (`MODE_A_DUCK_RATIO_DEFAULT`) | `600ms` (`MODE_A_DUCK_RAMP_MS`) | `800ms` (`MODE_A_SWELL_MS_DEFAULT`) |
| Chill | `0.12` (`MODE_A_DUCK_RATIO_CHILL`) | `600ms` (`MODE_A_DUCK_RAMP_MS`) | `1200ms` (`MODE_A_SWELL_MS_CHILL`) |
| Hyped | `0.25` (`MODE_A_DUCK_RATIO_HYPED`) | `600ms` (`MODE_A_DUCK_RAMP_MS`) | `400ms` (`MODE_A_SWELL_MS_HYPED`) |

Quarantined Mode B (decoded TTS > 15s, or duration unknown): Track A finishes cleanly. Track B stays frozen at `0:00` / volume 0. Station bed holds at `MODE_B_BED_GAIN` (`0.25`) and decays over `MODE_B_BED_DECAY_MS` (`400ms`). Track B then launches from `0:00` with an `MODE_B_LAUNCH_RAMP_MS` (`800ms`) logarithmic ramp-up.

**Mode A script budget (MUST):** `MODE_A_DURATION_THRESHOLD_SEC` remains **15.0**. `roots_branches` copy is budgeted at **25–32 words (max ~12–14s)** so standard lore reliably qualifies for Mode A background ducking of Track B's intro. `loreWordCeiling` / `truncateToWordLimit` enforce the 32-word cap. Do not raise the 15.0s routing threshold to compensate for long scripts. DirectStream ignores Mode A/B routing but **keeps the same lore word ceiling** so TTS duration stays broadcast-shaped.

#### Prefetch lookahead (dynamic 30s / 45s / 60s)

`getPrefetchLeadSeconds(commentaryFormat)` in `src/lib/dj/prefetchEngine.ts` scales warmup so longer TTS formats finish before the cut. `shouldPrefetchUpcomingBreak` evaluates remaining track duration against that threshold.

| Format | Lead | Constant / helper |
|--------|------|-------------------|
| Default (`standard`, `roots_branches`) | **30s** | `PREFETCH_LOOKAHEAD_SECONDS` |
| Sonic Time Capsule (`time_capsule`) | **45s** | `PREFETCH_LEAD_SECONDS_TIME_CAPSULE` |
| Director's Cut (`directors_cut`) | **60s** | `PREFETCH_LEAD_SECONDS_DIRECTORS_CUT` |

DirectStream / AudioPlayer (`LOOKAHEAD_SECONDS` default) and quarantined companion near-end (`companionPrefetchNearEndMs` in `useWebOrchestrator.ts`) consume the same helper. Seek handlers MUST clear `nearEndUriRef` when the seek target changes remaining-time class (inside vs outside the lead window) and re-arm prefetch when remaining duration falls inside the window. Statutory DirectStream MUST NOT expose reverse scrubbing (§1.1); the seek remaining-time class rule is preserved for the quarantined companion path and for any legal forward-only playhead correction.

**Live fetch fallback budget (MUST):** `LIVE_DJ_FETCH_BUDGET_MS` = **3000**. When no warmed clip exists (e.g. remaining time inside the lead window with no prefetch) and live `fetchDjAudio` exceeds 3 seconds, abort the long payload and fall back to a short station liner (`getStationLaunchLiner` customText TTS) or **direct start** Track B — never block on a ~40s TTS download.

**Skip abort contract (MUST):** Manual `skipTrack` (`page.tsx`) MUST call `abortPendingSpeechAndClearBuffers` (bumps `sessionEpoch`, aborts `prefetchAbort` + shared `DjBreakPrefetchEngine`, clears warmed buffers) **before** DirectStream skip / advance. Quarantined companion: before `spotifyRemote.next()` / `previous()`. In-flight TTS MUST NOT leak onto the skipped-to track. Statutory skip cap (§1.1) still applies — abort runs only when a skip is actually issued.

**Single-Execution & Cleanup Rules**

`breakExecutedForCurrentTrack` (boolean): Set to true instantly upon entering DirectStream `SPEAKING_DJ` (quarantined: state #4 or #7 — Mode A in-band or Mode B station-bed speech). Blocks all subsequent break requests for the current track ID. Reset ONLY when trackId changes.

`sessionEpoch` (integer): Incremented ONLY on explicit user interactions — manual station selection / mix launch, host persona swap, or host settings edits. MUST NOT be incremented during automated track transitions, queue advances, `playNextTrack`, DirectStream `ended` hops, quarantined Spotify `player_state_changed` track-end events, or mid-queue `onTrackStarted` / `syncIndexToPlayingTrack` hops. MUST NOT be incremented during constructor / first-hydrate stamps (`{ silent: true }` on host-state setters). All async API promises check if (promiseEpoch !== currentSessionEpoch) and abort if mismatched. Prefetched DJ breaks remain valid across automated advances because `requestEpoch === sessionEpoch` is preserved.

`flushPrefetch()` MUST NOT bump `sessionEpoch` when prefetch buffers (`djPrefetchByTrackId`) and in-flight controllers (`prefetchAbort`) are empty — it no-ops and leaves the epoch unchanged. Live host-state sync MUST NOT call `flushPrefetch()` after aborting setters. `applyHostState` owns the single abort on a real settled change (`abortPendingSpeechAndClearBuffers("Host state change")`); callers MUST NOT follow it with a second flush that would double-bump.

**Silent host-state hydrate (MUST):** `setIsPro`, `setPersona`, `setAllowExplicit`, `setCommentaryFormat`, `setVibePrompt`, `setDjMode`, and `setDjTuning` accept `{ silent: true }`. Constructor and first-apply stamps MUST pass `silent: true` (or treat `lastAppliedHostStateRef == null` as silent) so initial values write properties **without** invoking `bumpSessionEpoch()` or aborting active speech buffers.

**Debounced `applyHostState` (MUST):** `useWebOrchestrator` (quarantined) and the live DirectStream host-state path coalesce live host-state drips (`isPro`, persona, `allowExplicit`, `commentaryFormat`, `vibePrompt`, and page `djMode` / `djTuning`) into a single **400ms** (`HOST_STATE_DEBOUNCE_MS`) `applyHostState`. On fire, compare the settled snapshot to `lastAppliedHostStateRef`. If values actually changed and this is not a silent / first stamp, invoke `abortPendingSpeechAndClearBuffers` **at most once**, then stamp all setters with `{ silent: true }`. MUST NOT call `flushPrefetch()` after those setters. Explicit Tuning Console / persona clicks MAY call `applyHostState` immediately; boot/login drips MUST go through the debounce. Orchestrator construct stamps via `applyHostState(..., { silent: true })`.

**`sessionLaunchPending` (MUST — Track 1 one-shot):** Armed **only** on explicit session flushes/launches: `flushForStationLaunch()`, `resetBreakSession()`, `launchStation()`, and hook `playTrack({ flushSession: true })`. MUST NOT be re-armed when `executedBreakTrackIds.size === 0` or on any automated track advance. Cleared on **any** of: `registeredTrackId` advancing past launch in `handleTrackRegistration`; every `runDjBreakInternal` early return (null input, `no_dj`, already executed, already running); and the first Track 1 break attempt in `resolveDjAudio` (success, skip, or throw). A Track 1 liner MUST NOT leak onto Track 2+. First voiced breaks mid-session evaluate the standard prefetch / LLM path.

**Prefetch precedence (MUST):** When a matching prefetched DJ break exists for the live track ID (`djPrefetchByTrackId` or shared `prefetchedBreaksMap`), it MUST execute via DirectStream mix-bus Duck–Talk–Swell (quarantined companion: Mode A ducking, or Mode B if decoded duration > 15s) and MUST NOT be discarded for `getStationLaunchLiner`. Station launch liners run only on that explicit Track 1 open when no matching prefetch exists. Track 2 Autopilot warmup inside the format-aware lead window of Track 1 (`getPrefetchLeadSeconds`) must log `"Executing prefetched DJ break"` / `"Using prefetched DJ break"` at the boundary — never a second launch liner. `beginStationLaunchLock` is armed only when `flushSession === true`; steer and mid-session companion advances (`flushSession: false`) MUST NOT re-lock the deck.

`currentAbortController`: Active AbortController instance. Calling abort() cancels pending script fetches and TTS downloads, revokes object URLs, and flushes in-flight break state so the next track starts clean.

---

## 1.1 DMCA Statutory Webcasting Rules (17 U.S.C. § 114)

The live engine is a **statutory non-interactive webcast** under 17 U.S.C. § 114 (and ephemeral recordings under § 112). `useStationQueue`, `src/lib/queue/statutory-rules.ts`, and `src/lib/queue/skip-limiter.ts` MUST enforce the following programming rules. These rules apply to DirectStream station launches (preset, curator, artist radio, Live Channel Dial, Station Blueprint). They do **not** authorize restoring a listener-ordered on-demand playlist. Album deep-dive sessions skip artist/album admission (they are not the statutory live bus) but still honor the skip cap and no-reverse transport.

### Artist cap

- Maximum **4** tracks by the same featured artist in a rolling **3-hour** window (`STATUTORY_WINDOW_MS`, `MAX_ARTIST_PER_WINDOW`).
- Maximum **3** consecutive tracks by the same featured artist (`MAX_CONSECUTIVE_ARTIST`).

A candidate that would exceed either bound MUST be rejected and the next eligible catalog row admitted. Featured-artist identity uses the primary catalog artist (same sanitization spirit as `normalizeArtistKey` / primary-name isolation).

### Album cap

- Maximum **3** tracks from the same album in a rolling **3-hour** window (`MAX_ALBUM_PER_WINDOW`).
- Maximum **2** consecutive tracks from the same album (`MAX_CONSECUTIVE_ALBUM`).

A candidate with no album identity still counts toward the artist cap. Album deep-dive / explicit-song-sequencer launches are **not** the statutory live bus; recalling a Station Blueprint or memory dial MUST generate a fresh compliant stream rather than an on-demand album running order that would violate this cap.

### Skip cap

- Maximum **6 skips per 60-minute sliding window** per listener session (`SKIP_WINDOW_MS`, `MAX_SKIPS_PER_HOUR` in `src/lib/queue/skip-limiter.ts`).
- A skip that would exceed the cap MUST be refused (`canSkip()` / `recordSkip()` return false; `AudioPlayer` `disableNext`); the on-air track continues.
- Skip abort (§1.0) still runs for allowed skips so in-flight TTS cannot leak.

### Queue obfuscation

`QueueModal.tsx` MUST NOT display forward track titles/artists in advance. Render the first upcoming slot as **"Up Next: Smart Station Stream"** and later unplayed rows as **"Later in the Stream"** (subtitle **"Smart Station Stream"**). The on-air row MAY show the current title/artist/artwork. Already-played rows MAY show titles. Historical rows MAY also appear in Broadcast Log History (`actualPlaybackHistory`) — that is recap, not a pre-published playlist.

Jump-to-index, drag-reorder of unplayed rows, insert-next, and "play this upcoming title" MUST NOT ship on the statutory DirectStream path (those interactions would publish and steer the playlist). Quarantined companion `QueueModal` interactive sequencing remains in-tree as reference UI only.

### No direct replay / rewind

- Disable reverse scrubbing (the playhead MUST NOT seek backward).
- Disable instant track replay / previous-track as on-demand replay.
- Forward skip remains subject to the 6-per-hour cap.
- Quarantined companion seek handlers (`seekRemote`, `handleCompanionSeek`) are preserved as reference code and MUST NOT be re-enabled as the live statutory transport.

---

## 1.2 SoundExchange Compliance Telemetry (ROU Logger)

Reports of Use are governed by **37 CFR § 370**. The production logger is DirectStream-only.

### Performance commit gate

Commit a performance log row to Postgres `user_play_logs` **ONLY when a track has played past >30 seconds**.

The 30s gate lives in `useDirectStreamPlayer.ts` `onTimeUpdate`, which calls `shouldCommitPerformance()` (`src/lib/rou/performance-commit.ts`, `PERFORMANCE_COMMIT_SECONDS = 30`):

| Condition | Required |
|-----------|----------|
| `playSessionId` present | yes |
| `committedSessionId !== playSessionId` | yes (same-airing pause/resume is not a new row) |
| `playbackState === "playing"` | yes |
| `position > 30` | yes (strictly greater than 30s) |
| Licensed HTTP `streamUrl` (`isLicensedStreamUrl`) | yes — preview-only / non-HTTP MUST NOT commit |

| Column | Source |
|--------|--------|
| `userId` | Authenticated Clerk user; guests write `null` (row still committed) |
| `isrc` | MusicBrainz metadata resolved **before** insert if the body omitted it |
| `trackTitle` | Canonical title on the queue row |
| `artistName` | Canonical primary artist on the queue row |
| `albumTitle` | Queue-row album when known |
| `durationSec` | HTML5 recording duration at commit, when the element has one |
| `playedAt` | Timestamp of the performance commit (on-air clock, not hydrate time) |
| `playSessionId` | `${stationId}:${trackId}:${queueIndex}:${queueGeneration}` via `buildPlaySessionId` — unique per airing |

`AudioPlayer` supplies the licensed `streamUrl` payload and persists a resolved ISRC via `updateTrackAt`. `POST /api/play-logs` is the only writer. Idempotency is **two-layer**: client `committedSessionIdRef` marks the session before `postPlayLog`, and the unique index `user_play_logs_play_session_uidx` uses `onConflictDoNothing`. The route no-ops with HTTP 200 when `DATABASE_URL` is unset.

Sub-30s plays, skipped intros, and tracks aborted before the 30s gate MUST NOT write a performance log. Monthly ROU export (`scripts/export-rou.ts`, `npm run export-rou -- --month YYYY-MM`) reads only this table and writes a headerless ASCII pipe-delimited SoundExchange file (ATP = COUNT per recording).

### ISRC resolution

ISRCs are resolved via MusicBrainz **prior to logging** (`POST /api/play-logs` looks up the recording when the body has no ISRC). Persist stream URL + ISRC on the queue row via `updateTrackAt` (never in-place mutation of a live `StationTrack`). A missing ISRC MUST NOT be invented; log the row only when the 30s gate has passed, with `isrc` null only when the catalog genuinely has none — do not skip the performance solely for a missing ISRC if title/artist/`playedAt` are known, but prefer resolving ISRC first.

### Quarantined telemetry (MUST NOT satisfy ROU)

Quarantined companion SDK events (Spotify `player_state_changed`, REST `/me/player`, Apple MusicKit playback events, YouTube IFrame `onStateChange`) do **not** satisfy statutory ROU and MUST NOT write to `user_play_logs`. Companion `onTrackStarted` / Broadcast Log History / `addToPlayHistory` remain UI recap only.

---

## 1.3 Quarantined Companion — Audio Buffer Safety, Track Advance Telemetry, Background Visibility & Debug Gate

> **QUARANTINED REFERENCE** — `src/lib/audio/legacy/`. DirectStream uses mix-bus Duck–Talk–Swell and HTML5 `ended` / `timeupdate` for advance. The contracts below remain the frozen companion SDK source of truth.

### Audio Buffer Safety & Fallback Rules

**Zero-Byte Buffer Guard:** The orchestrator MUST verify `arrayBuffer.byteLength > 0` before initiating any volume fade or state transition into Mode A or Mode B. Empty TTS payloads MUST NOT proceed past `PREFETCHING_BREAK`. DirectStream MUST apply the same zero-byte guard before duck-in.

**Failed Load Fallback:** If a TTS fetch returns an empty buffer or audio decoding / `AudioBufferSourceNode` load fails, abort Mode A / Mode B immediately and maintain **100% music playback gain**. Never execute volume fades (duck, fade-to-bed, or ramp-to-zero) on corrupted or 0-byte audio blobs. Restore or keep Spotify / companion / DirectStream music at full listening level and return to `PLAYING_MUSIC`.

**Duration Probe Fail-Closed:** Companion Mode A/B routing MUST use `decodedAudioBuffer.duration` from `audioContext.decodeAudioData`. Un-probed clips, HTML5-only fallbacks without a decoded duration, and any non-finite duration MUST route to **Mode B** (treat as clip > 15s) so a long host break cannot talk over song intros or lead vocals. DirectStream does not use this probe for mix-bus ducking.

**Mode B Track B Contract:** During `PREFETCHING_BREAK` (no decoded buffer), `MODE_B_BED_FADE`, and `MODE_B_SPEAKING`, the Spotify / companion transport for Track B is muted and held at `0:00`. Track A is allowed to finish cleanly at full volume — speech ducking never targets Track A's vocal tail. On `MODE_B_LAUNCH`, seek Track B to `0:00`, unpause at volume 0, then ramp to full listening volume over `MODE_B_LAUNCH_RAMP_MS` (800ms). Do not let Track B run in parallel with Mode B speech.

### Track Advance Telemetry & UI Synchronization

Spotify multi-URI launches auto-advance inside the Web Playback SDK / Connect queue. The station engine (`useStationQueue`) is **not** the playback authority for those hops — Spotify already moved — but the UI Playlist Modal highlight and Broadcast Log History still key off `useStationQueue.currentIndex` and `addToPlayHistory`. DirectStream **is** the playback authority for the live bus; `useStationQueue` advances on DirectStream `ended` / allowed skip, and `onTrackStarted` still syncs UI.

**Requirement (quarantined companion):** When Spotify starts a new track mid-queue (SDK `player_state_changed` or REST playback poll detects `incomingId !== lastTrackId` while playback is active), the orchestrator MUST emit `onTrackStarted` with live track metadata (`spotifyId`, `title`, `artist`). The page MUST call `useStationQueue.syncIndexToPlayingTrack(alignTo)` so `currentIndex` lands on the playing item.

**`syncIndexToPlayingTrack` contract:**

1. Resolve the matching queue row via `findQueueIndexForPlayingTrack`: `normalizeSpotifyTrackId` on the playing URI/id **and** each queue `spotifyId`, then `linkedFromId` / `linked_from.id` when present, then case-insensitive `title` + `artist`. DirectStream matching uses the live stream URL / catalog id / ISRC with the same title+artist fallback.
2. If `alignIndex !== currentIndex`, `applyIndex(alignIndex)` and `maybeReplenish()` when near the tail. MUST NOT `markPlayed()` vacated intermediate rows — unresolvable Spotify Search URIs jump the cursor to the next playable item, and those skipped rows never aired.
3. MUST NOT bump `sessionEpoch`, call `flushForStationLaunch`, or treat the hop as a drained-end `playNextTrack` (which would skip past the live item).
4. If the playing track is not in `queueRef` (index `-1`), log `[QueueSync] Playing track not found in active station queue` and return `-1` without mutating the queue. The page MUST auto-steer Spotify back onto `queue[currentIndex + 1]` / `queue[currentIndex]` via `playTrack` / `steerToStationUri` (see `docs/AUDIO_ORCHESTRATION_SPEC.md` §1.5). DirectStream equivalent: reload the canonical queue row's stream URL. `onTrackStarted` MUST still clear `isSpotifySyncPending` on this `-1` path so "Tuning in…" cannot stick.

**Broadcast Log & companion guard:**

- Mid-queue index moves MUST still update Broadcast Log History through `AudioPlayer.handleNewTrack` → `addToPlayHistory` (and the song counter).
- Because Spotify already owns the (quarantined) stream, `handleNewTrack` MUST NOT re-issue companion `playTrack()` / local companion breaks for that sync. Use a one-shot suppress flag (e.g. `suppressCompanionReplayRef`) armed by `syncIndexToPlayingTrack`.
- Duck–Talk–Swell for the new id remains `WebOrchestrator.registerTrack` / live `runDjBreak` — never a second `play({ uris })`. DirectStream Duck–Talk–Swell remains mix-bus `DUCK_RATIO` / `DUCK_RAMP_MS` / `RESTORE_RAMP_MS`.

**Drained ends stay on `onTrackEnded` → `playNextTrack`:** Single-URI plays, DirectStream `ended`, and empty Spotify queues still advance via `playNextTrack(alignTo)` so Autopilot can load N + 1. Mid-queue companion hops use `onTrackStarted` only.

**Lore `previousTrack` is strictly N-1 of the break's target:** On lore / recap breaks, `previousTrack` MUST resolve to the immediate predecessor of the track being introduced. Recaps MUST be grounded in **verified session playback** only (`WebOrchestrator.actualPlaybackHistory` / page `sessionPlayedRef`). A hydrated queue cursor (`queue.slice(index - 2, index)`) is not "aired" and MUST NOT be used as a recap fallback.

- **Live break** (Track N is on air / just started): `WebOrchestrator.fetchDjAudio` / DirectStream equivalent filters `actualPlaybackHistory` to drop the live `trackId`, then takes the last remaining item (`resolveLorePreviousTrack`). That is the just-finished track. If `actualPlaybackHistory` is empty for the active `sessionEpoch` (e.g. immediately after a station switch), pass `previousTrack: undefined` so the prompt engine emits an opener / `song_intro` rather than a phantom back-announce.
- **Lookahead prefetch** (warming Track N+1 while Track N is still on air, `coherent.trackId !== registeredTrackId`): do **not** call `resolveLorePreviousTrack(history, upcomingId)`. Track N has not finished, so the history tail is still N-1. Prefetch MUST explicitly bind the live on-air track (Track N — `currentTrack` / `registeredTrackId`) as `previousTrack` for N+1 script generation (`bindPrefetchPreviousTrack`). Warmup MUST NOT assign `WebOrchestrator.currentTrack` / `currentTrackId`; allocations stay local to the prefetched break buffer so live playback identity remains intact.
- `DjBreakPrefetchEngine.warm()` / `generateDjBreak` receive the same on-air `{ title, artist }` predecessor so engine-warmed clips recap Track N, not N-1.
- `normalizeTrackRefs` / `parseLoreTrackRefs` keep the newest N entries via `.slice(-limit)` (chronological buffers, newest last) so a long history cannot surface a ~4-songs-ago title as "what we just heard". Secondary `recentHistory` rows are older background context only — host copy such as "That was [Song]..." MUST name `previousTrack` alone.

**Runtime debug gate (MUST):** High-frequency console telemetry is silenced by default so the ~250 ms playhead interpolation clock, DJ timing ticks, prefetch progress observations (`observeProgress`), volume/fader step ramps, and Mode B seek-hold repeat ticks cannot pollute the console.

Enable the gate in the browser:

```js
window.__SONGHOST_DEBUG__ = true
// or persist across reloads:
localStorage.setItem("songghost_debug", "1")
```

Gated logs MUST go through `debugLog(tag, payload?)` in `src/lib/debug.ts` (`isSongGhostDebug()`). Milestone logs remain ungated: `[SongHost] sessionQueueHydrated`, `stationSelected`, `[SongHost TRACE]` track transitions (`onTrackStarted`, `registerTrack`), DJ break lifecycle (`Requesting DJ script`, `DJ Voice audioUrl`, `Speech Node Started`, `completed naturally`), split TRACE 4 (`[SongHost TRACE 4] Prefetch buffer ready` vs `[SongHost TRACE 4] DJ Voice on-air`), and all `console.warn` / `console.error` API / 429 warnings.

**TRACE 4 split (MUST — single emitter):** Prefetch completion and live break execution MUST NOT share a label. On the live DirectStream bus both labels are emitted **only** from `src/lib/audio/VoiceNode.ts`. `dj-intro.ts`, `AudioPlayer.tsx`, and `prefetchEngine.ts` MUST NOT emit either TRACE 4 line (legacy `DJ Voice buffer ready` and duplicate lookahead TRACE 4 emissions are removed). Quarantined companion may still log `[SongHost TRACE 4] DJ Voice audioUrl:` — that is not the live split.

| Event | Ungated tag | Emitter (MUST) |
|-------|-------------|----------------|
| Prefetch / lookahead decode complete | `[SongHost TRACE 4] Prefetch buffer ready` | **Strictly** `VoiceNode.preload()` after successful decode (`PRELOAD_DECODE_TIMEOUT_MS = 8s`). Buffer is **off-graph**, not on-air. |
| Live break execution | `[SongHost TRACE 4] DJ Voice on-air` | **Strictly** `VoiceNode.play()` after `onStarted` and `captureMediaElement`. Speech is on the live bus. |
| Element play start | `[SongHost TRACE] DJ voice audio .play() starting` | `VoiceNode.play()` immediately before `audio.play()`, **only** when the abort controller is still live |

**Abort guard (MUST):** If `controller.signal.aborted` is already true before live playback, `VoiceNode.play()` MUST skip both `[SongHost TRACE 4] DJ Voice on-air` and `[SongHost TRACE] DJ voice audio .play() starting`. An aborted break MUST NOT look like it went on-air.

### Background Tab Teardown & Autoplay Prevention

Browsers throttle background tabs. The Spotify Web Playback SDK (quarantined) may drop / re-establish its WebSocket; on recovery the SDK can auto-resume local playback even when the listener left the deck paused. DirectStream MUST apply the same pause-intent rule to the HTML5 element / `AudioContext`.

**Requirement:** When a browser tab recovers from background throttling or WebSocket reconnection, the orchestrator MUST reconcile transport playback state with React UI state. If UI `isPaused === true`, any unexpected play state MUST be immediately forced to `pause()`.

**Implementation rules:**

1. `useWebOrchestrator` (quarantined) and the DirectStream player listen for `visibilitychange` and window `focus`. After the document returns from hidden/idle, if UI pause intent is set, call `spotifyPlayer.pause()` (companion) and/or pause the DirectStream media element and/or `audioContext.suspend()`.
2. `WebOrchestrator.pause()` MUST disconnect / stop active `AudioBufferSourceNode` speech nodes, suspend the shared speech AudioContext, and verify that Spotify pause is acknowledged (SDK `getCurrentState` / REST probe with a single re-issue). DirectStream pause MUST stop speech nodes and pause the media element.
3. On `player_state_changed` (and the REST poll stand-in), if `state.paused === false` while UI pause intent is true, force an immediate `spotifyPlayer.pause()`, keep shared track state `isPaused: true`, and do not treat the event as a live play / track-start. DirectStream: if the media element is playing while UI pause intent is true, `pause()` immediately.

---

## 1.4 Quarantined Companion — Session Hydration, Playhead Interpolation & Station Persistence

**Requirement:** The active station ID and generated queue MUST be persisted to `sessionStorage`. Upon page refresh, the queue engine MUST hydrate the active station queue before DirectStream `play` / `onTrackStarted` (historical: before Spotify SDK playback resumes) to prevent `syncIndexToPlayingTrack` lookup misses against fallback stations.

Keys: `songhost_active_station_id`, `songhost_active_queue`. Cross-tab / restart snapshot: `localStorage` `songhost:last_session`. Browser keys use the `songhost_*` / `songhost:*` prefix; reads MUST prefer the canonical key and migrate-on-read from legacy `songghost_*` / `songghost:*` (copy forward, never hard-cut). See `docs/AUDIO_ORCHESTRATION_SPEC.md` §1.4 for the tab-scoped rules and §5.4 for boot precedence. Local storage is an **offline cache** during boot and station transitions — it is not the playhead source of truth. **DirectStream** HTML5 `currentTime` / `paused` is the live playhead authority. Historical companion: Spotify Connect reconciled the needle.

**Explicit station switch (MUST):** `beginStationSession` / `selectStation` MUST:

1. Force `currentIndex: 0` and clear hydrated queue offsets (`persistActiveStation(station, { resetPlayhead: true })` writes `queue: []`, `currentIndex: 0`). Same-id re-click is a new session, not a resume.
2. Immediately dispatch `abortPendingSpeechAndClearBuffers("Station switch")` and flush pending orchestrator speech / prefetch buffers **before** stream-URL resolve (historical: URI search). Do not wait for `playTrack({ flushSession: true })` / `flushForStationLaunch` (those still run on launch).
3. Clear `sessionPlayedRef` / `actualPlaybackHistory` so the opener cannot recap the previous station.

**Playhead interpolation clock (MUST — quarantined companion):** Spotify SDK `player_state_changed` events are sparse. The companion UI range slider MUST NOT wait on those events (or the 2000 ms REST poll) to move. Live DirectStream UI reads HTML5 `currentTime` directly and MUST NOT interpolate a companion SDK clock.

On every **applied** SDK or REST transport sample, store a local stamp `{ trackId, positionMs, durationMs, receivedAt, playing }`. While playing and **not** in a Mode B hold, UI-paused, or seeking, a 250 ms interpolation timer (`PLAYHEAD_INTERPOLATION_MS`) updates **position only**:

```text
progressMs = min(durationMs, positionMs + (now - receivedAt))
```

That tick writes `setCompanionPlayback` and `publishActiveTrackState` position fields. It MUST NOT rewrite title/artist/album, ducking ratios, or `resolvePlaybackPositionMs()` FSM intro-window checks.

**2 s stall rescue (MUST — quarantined companion):** If no SDK sample arrives for `PLAYHEAD_STALL_RESCUE_MS` (2000 ms) while interpolation is active, issue a **single** local `player.getCurrentState()` re-anchor. When that state is null, issue **one** REST currently-playing fetch, then resume interpolation from the new stamp. Do not restart the 2000 ms REST poll while SDK events or local interpolation are active.

Reset the sample on track-id change, pause, seek, and Mode B holds (`progressMs: 0` for Mode B).

---

## 1.5 Quarantined Companion — Spotify OAuth Click-Gating, PKCE Cookies & Redirect URI

> **QUARANTINED REFERENCE.** DirectStream launches MUST NOT start companion SDK auth. The following remains the frozen Spotify OAuth contract.

### Spotify Redirect URI Invariant

Spotify OAuth strictly disallows `localhost` URIs. Local development MUST strictly use `127.0.0.1:3000` (`http://127.0.0.1:3000/api/auth/spotify/callback`), while production MUST use `https://song-ghost.vercel.app/api/auth/spotify/callback`.

`canonicalizeSpotifyRedirectUri()` / `resolveSpotifyRedirectUri()` in `src/lib/player/spotifyRemote.ts` (and `page.tsx` `connectSpotify`) MUST rewrite loopback hosts (`localhost`, `::1`, `127.0.0.1`) to the registered local callback and MUST never emit `localhost` in `redirect_uri`. Authorize scopes MUST include `user-read-private` and `user-read-email` alongside `streaming`, `user-read-currently-playing`, `user-read-playback-state`, `user-top-read`, and `user-modify-playback-state` — the Web Playback SDK `check_scope` call returns 403 without the private/email pair.

### OAuth click-gating & HttpOnly PKCE cookies

`MusicSourceContext.connectSpotify()` is strictly click-gated. `window.location.assign` to `GET /api/auth/spotify` MUST NOT run unless the caller passed `{ intent: true }` or `navigator.userActivation.isActive` is true at the **start** of the call (captured synchronously before any `await`). Browsers without the User Activation API still allow the click-handler path. Mount hydrate (`completeSpotifyPkceFromUrl` / `captureSpotifyTokensFromUrl` / token restore) restores an existing session and MUST NOT call `beginSpotifyAuth()`.

`GET /api/auth/spotify` generates PKCE `state` + `code_verifier` and sets HttpOnly cookies:

| Cookie | Role |
|--------|------|
| `sg_spotify_oauth_state` | CSRF `state` |
| `sg_spotify_pkce_verifier` | PKCE `code_verifier` |

Cookie flags: `Secure` on HTTPS, `SameSite=Lax`, `Path=/`, `Max-Age=900`. Never via `document.cookie`. `GET /api/auth/spotify/callback` exchanges the cookies for tokens. Client connect flows navigate here **only after an explicit click** (`connectSpotify({ intent: true })` or live user activation) and `clearSpotifyTokens()`. Post-Clerk boot evaluates `!isSignedIn` immediately on `authLoaded` (Step 1, no Spotify wait) and MUST NOT auto-open Step 2. It MUST NOT auto-start OAuth. `connectSpotify` identity is ref-stabilized (`isConnectingRef`). `MusicSourceContext` hydrate MUST NOT set `activeProvider` to Spotify / Apple. `useWebOrchestrator.companionActive` is forced `false` during radio playback; `transferPlaybackToLocalDevice()` MUST NOT run.

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

Client hydrates `localStorage` first, then merges this payload **over** local on login. Host Retention writes `songhost_active_host_id` / `songhost_is_host_locked`. A preferences-only POST body is valid. Playhead position is **not** in this blob — DirectStream HTML5 `currentTime` is the live authority (historical: Spotify Connect; see §5.4).

**Mode A script budget & TTS bounds (see also §3.2 / §4.2):** `roots_branches` copy is capped at **32 words** so decoded clips stay ≤ `MODE_A_DURATION_THRESHOLD_SEC` (**15.0**, unchanged). Companion `fetchDjAudio` sends `recentBreakHistory` (last 6 `_broadcastHistory` scripts) for cross-break anti-repetition. ElevenLabs Turbo settings: `stability >= 0.55`, `style <= 0.15`, `use_speaker_boost: false`.

---

## 1.6 Quarantined Companion — Search Fallback, 429 Circuit Breaker, Station Handoff, Launch Handshake & YouTube First-Song

> **QUARANTINED REFERENCE.** Genre/decade queues on the live bus resolve DirectStream HTTP URLs (`streamUrl` / `previewUrl` via Last.fm / MusicBrainz). The following keeps the historical Spotify Search path from storming `/v1/search`.

### Station handoff companion-search suppression

Station switches MUST arm AudioPlayer **before** the queue reset so `handleNewTrack` cannot race `launchStation` with a duplicate Search. DirectStream launches skip companion Search; they load `streamUrl` / HTTP `previewUrl` on the queue row (`resolveDirectStreamUrl`) **only after** the §1.7 identity gates (`streamMatchesQueueMetadata` / title+artist on iTunes preview URLs).

1. `selectStation` and `handoffToWebOrchestrator` call `AudioPlayer.armStationHandoff()` before `beginStationSession` / queue updates. That sets sticky `stationHandoffSuppressRef` and one-shot `suppressCompanionReplayRef`.
2. While the sticky flag is set, `handleNewTrack` still updates Broadcast Log / song counter but MUST NOT call `onCompanionPlayTrack` / `onCompanionDjBreak`.
3. The handoff `useEffect` in `page.tsx` calls `disarmStationHandoff()` in `finally` after `launchStation` / `launchCompanionTrack` so later skips can play.

Mid-queue Spotify auto-advance continues to use the one-shot `suppressCompanionReplayRef` armed by `syncIndexToPlayingTrack`.

### Native URI preference & queue persistence

1. `onCompanionPlayTrack` / `companionTrack` MUST include `spotifyId` / `spotifyUri` from the live queue row.
2. `launchCompanionTrack` MUST call `spotifyUriForQueueTrack()` on the seed **before** falling back to Search.
3. After Search (or a native hit) resolves a URI, persist it onto the queue row via `AudioPlayer.updateTrackAt` (`persistSpotifyIdOnQueue` in `page.tsx`) so subsequent skips / advances do not re-query Spotify. Never mutate a live `StationTrack` in place. DirectStream rows persist `streamUrl` + ISRC the same way (`updateTrackAt`).

### Spotify REST 429 circuit breaker (`spotifyRateLimitResetTime`)

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

### Bounded Search concurrency & LRU cache

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

**Lookup order (MUST) — 3-tier Search fallback:**

1. Hit the LRU `artist:title` cache (including in-flight promises). Expired negative entries are dropped.
2. If the 429 circuit is open, fail-fast `null` and remember the miss until `SEARCH_NEGATIVE_TTL_MS`.
3. Acquire a Search slot (max 2), re-check the circuit, then run **3-tier** Search via `fetchSpotifyGetWithRetry`. Each later tier runs only when the previous produced no track URI and was not circuit-blocked / HTTP 429:

   | Tier | Query | When |
   |------|-------|------|
   | **1 — Quoted fields** | `track:"${title}" artist:"${artist}"` (or `track:"${title}"` when the artist is empty / an ignored YouTube channel) | Always first live GET |
   | **2 — Un-fielded** | `q = "${title} ${artist}".trim()` | Tier 1 is non-OK (502/400), empty, or a network error |
   | **3 — Title-only** | `q = "${title}"` | Tier 2 also missed **and** the query would not duplicate Tier 2 (empty artist skips this tier) |

   HTTP 429 does **not** trigger a later tier. Hits stay cached; 429 / circuit-open become 60 s negatives. Confirmed catalog misses stay cached without TTL. Each attempt logs 502s and empty result sets.

### Companion volume ramps (SDK-only ticks)

Duck / swell ramps MUST NOT storm `PUT /me/player/volume`. Intermediate ticks (~33 ms on a hyped 400 ms swell) write **local Web Playback SDK `player.setVolume()` only** via `applySdkVolume`. Dual-path REST volume writes are restricted to:

1. User-initiated ControlDeck / master fader changes (`setSpotifyVolume`).
2. The **final landing write** of a ramp so Connect stays in sync with the SDK floor.

Connect-only sessions (no registered SDK player) may still REST-write ticks. A 12-step dual-path ramp on an embedded SongHost Radio device is a 429 defect. Live DirectStream volume ramps stay on mix-bus `GainNode`s and MUST NEVER call Spotify volume APIs.

### Mode A / B transport unpause (SDK-verified playhead)

Mode A resume-at-duck-floor and Mode B hard-launch MUST unpause the **local** SDK player (`player.resume()` / `player.seek(ms)`) before Connect REST, and MUST append `device_id` on REST `play` / `seek`. `resumeActivePlayer()` MUST verify `getCurrentState().paused === false` (retry SDK `resume()` once if still paused) before the FSM enters `PLAYING_MUSIC`. A Connect `200` on `PUT /me/player/play` is **not** playhead motion.

### Launch handshake (`isLaunchingStation`, `sessionLaunchPending`)

Station launch and session restore share one pending mask (`isSpotifySyncPending` → ControlDeck "Tuning in…") and one SDK event lock (`isLaunchingStation`). DirectStream uses the same Track 1 one-shot (`sessionLaunchPending`) without arming a Spotify URI lock.

| Phase | Lock / mask | Release |
|-------|-------------|---------|
| `beginStationLaunchLock(uris)` | Arms `isLaunchingStation` only when `flushSession === true` **and** `uris` is non-empty | Confirm when the live id matches **any** launched URI (`normalizeSpotifyTrackId`) or `linked_from.id`. Steer / mid-session companion advances (`flushSession: false`) MUST NOT arm this lock. |
| Safety timeout | Lock still armed after **3000 ms** | If SDK audio is actively playing, release `isLaunchingStation` so `player_state_changed` reaches `onTrackStarted` / `registerTrack` |
| `onTrackStarted` | `isSpotifySyncPending` | `page.tsx` MUST call `clearSpotifySyncPending()` and `setIsSpotifySyncPending(false)` **immediately**, even if `findQueueIndexForPlayingTrack` returns `-1` |
| `runReset` (non-hydrate) | leftover pending flag | Reset `isSpotifySyncPending` to `false` at the start of a fresh station assemble so Heavy Rotation / preset launches cannot inherit a restore mask |

`sessionLaunchPending` is a Track 1 one-shot (see §1.0). Track transitions on songs 2+ MUST call `registerTrack(liveTrackId)` (advancing `registeredTrackIdRef`) once the launch lock is clear — **including** while `broadcastState === PREFETCHING_BREAK` — so Autopilot prefetch consume and live `isDjBreakDue()` checks can run. Skip registration only during `MODE_B_BED_FADE` / `MODE_B_SPEAKING`. Do not bump `sessionEpoch` on these hops.

### YouTube first-song invariant & offscreen host (quarantined)

Quarantined YouTube IFrame path (`useYouTubePlayer.ts` / `AudioPlayer.tsx`):

- Pause until audio unlock → single `seekTo(0)` → play → `tryEmitOnPlaying()` **once per track load**.
- Duck gain is re-asserted on ready / load-settle / PLAYING because embeds reset to 100% volume on module load.
- The YouTube host remains `fixed -left-[9999px]` in `AudioPlayer.tsx`. Moving the ControlDeck dock MUST NOT remount or visually surface the iframe.

---

## 1.7 Strict Catalog & Stream Metadata Verification (live DirectStream)

iTunes Search is **not** the music transport. It is the dated-catalog helper and the **strict identity gate** for preview-URL attach. Seed launches MUST bind an HTTP preview / stream URL only when title **and** artist equality succeed. Rank-0 (`songs[0]`), title-only `includes`, and unverified preview attach are forbidden.

### Normalization (`src/lib/itunes.ts`)

| Helper | Contract |
|--------|----------|
| `collapseItunesWs` | Collapse runs of whitespace; trim. |
| `stripItunesFeaturedTags` | Strip `(feat. …)` / `(ft. …)` / `(featuring …)` parentheticals **and** trailing `feat.` / `ft.` / `featuring` clauses. All other parentheticals are **kept**. |
| `normalizeItunesTitle` | Feature-strip → lowercase → collapse whitespace. |
| `normalizeItunesArtist` | Same as title, then isolate the **primary** name (split on `,` / `&` / `/` / `and`; take the first token). |
| `itunesTitlesMatch(a, b)` | `normalizeItunesTitle(a) === normalizeItunesTitle(b)` and both sides non-empty. |
| `itunesArtistsMatch(a, b)` | `normalizeItunesArtist(a) === normalizeItunesArtist(b)` and both sides non-empty. |
| `itunesTrackMatchesQuery(track, q)` | Accepts `Title`, `Title - Artist`, `Artist - Title`, or concatenated `Artist Title` / `Title Artist` via the equality helpers. **Never** a rank-0 or substring fallback. |

**Strict parenthetical matching (MUST):** Version tags such as `(Reimagined)`, `(Acoustic)`, or `(Live)` are **not** stripped. `Bohemian Rhapsody` MUST NOT equal `Bohemian Rhapsody (Reimagined)`. Feature tags are the only parentheticals equality may ignore.

### `lookupITunesTrack` (MUST)

`lookupITunesTrack(artist, title)` searches `artist + title` (limit 12) and returns the **first** row where **both** `itunesTitlesMatch` and `itunesArtistsMatch` succeed. Empty artist or title → `null`. No match → **`null`**. MUST NOT:

- fall through to title-only `includes`
- return rank-0 `songs[0]` when identity fails
- attach a preview URL from a non-matching catalog row

`lookupITunesSongById(trackId, expected?)` pins by iTunes id, then re-checks title/artist when `expected` is supplied — mismatch → `null`. `itunesSongToStationTrack(song, youtubeId?, expected?)` applies the same expected-identity gate before writing `previewUrl`.

### Seed-launch equality gates (MUST)

| Surface | Gate |
|---------|------|
| `SmartSearchBar.runStationLaunch` (song-radio) | `GET /api/search?q=…&type=track&limit=8`, then `tracks.find(itunesTrackMatchesQuery)`. No hit → `"No matching track found"`; MUST NOT launch rank-0. |
| `GET /api/search` | Attach `previewUrl` only when `itunesTrackMatchesQuery(track, q)`. `gateTrackSeeds`: rank-0 is never a seed; `limit=1` returns **only** an equality hit; otherwise exact matches are promoted ahead of fuzzy catalog rows. |
| `GET /api/song-radio` | `catalogPreviewUrl` / `attachSeedCatalog` require `itunesTitlesMatch` **and** `itunesArtistsMatch` against the requested seed before binding a preview. Seed catalog is `lookupITunesSongById(id, seedIdentity)` then `lookupITunesTrack(artist, title)` — never an unverified first-result attach. |

### `DirectStreamProvider.load()` metadata validation (MUST)

`resolveDirectStreamUrl` still prefers `streamUrl` / HTTP `providerTrackId` / non-YouTube HTTP `previewUrl`. **Before** assigning `.src`, `load()` MUST reject the row when:

1. **Stamp mismatch:** `streamMatchesQueueMetadata(track)` is false — `extras.resolvedTitle` / `extras.resolvedArtist` exist but fail `itunesTitlesMatch` / `itunesArtistsMatch` against the queue-row title/artist.
2. **URL-only identity missing:** the resolved URL is an iTunes / `mzstatic.com` preview (`previewNeedsIdentity`) **and** title or artist is empty. A bare HTTP `providerTrackId` with no catalog identity MUST NOT load.

Rejected loads log `[DirectStreamProvider] Rejecting src — metadata mismatch`, fire `onError("metadata_mismatch")`, call `unload()`, and MUST NOT assign `.src`.

---

## 2. UI & Image Assets / Fallbacks

YouTube CDN thumbs (`i.ytimg.com/vi/{id}/{file}`) are not guaranteed at every quality. A 404 on `hqdefault.jpg` (or a higher published file) MUST NOT leave a broken image in the deck, station cards, or queue mosaic. Live DirectStream artwork prefers catalog cover URLs; the YouTube ladder remains the fallback renderer.

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
| **BrandHeader** | Slim `sticky top-0 z-50` bar in `ControlDeck.tsx` — logo, RADIO/STUDIO, auth. No transport, no DirectStream media element, no YouTube host. |
| **ControlDeck dock** | `fixed bottom-0 inset-x-0 z-50 bg-[#09090b]/92 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]`. Holds transport, Host Studio pill, Host Controls drawers, pinned mobile `trackActions`, and `{children}`. **`MusicSourceHeader` is unmounted** (no Spotify / Apple connection pills); `DevTierBadge` remains. |
| **Dashboard column** | `page.tsx` content uses `pb-32` / `md:pb-36` so carousels clear the dock. `HeavyRotationShelf` is unmounted from the home hero. Post-Clerk boot MUST NOT auto-open Step 2 ("Connect Spotify"). |
| **`{children}` slot** | Unconditionally mounted inside the dock wrapper. Contains `<AudioPlayer>` (seek bar + DirectStream media element; quarantined offscreen `yt-player-host`). MUST NOT be gated on idle, sheet-open, `md` breakpoint, or Host Studio open. A remount would reset `useStationQueue` (`stationId` / `queueGeneration` effects). |
| **DirectStream media element** | Lives inside the unconditionally mounted `{children}` / `AudioPlayer`. Seek bar travels with `{children}`. Reverse scrub is disabled on the statutory path (§1.1). |
| **YouTube host (quarantined)** | Already `fixed -left-[9999px]` in `AudioPlayer.tsx`. Moving the dock does not move the iframe; the seek bar travels with `{children}`. |
| **Live Actions (unrendered)** | Manual DJ override controls (`Break Now`, `Skip DJ`, `DJ Standby` via `HostLiveActions`) are **unrendered** in the UI. `HostSettingsModal` and `HostControlsBar` keep `onBreakNow` / `onSkipDj` / `orchestratorStatus` on their prop interfaces. Handlers stay wired on `page.tsx` (`triggerBreakNow` / `skipActiveBreak` from `useWebOrchestrator`) so orchestration remains active. |

`MobilePlayerSheet` keeps `showMiniBar={false}` so it does not mount a second AudioPlayer.

---

## 3. Playhead, History & Telemetry

Live DirectStream playhead is HTML5 `currentTime` / `paused` on the `<audio>` element. Quarantined companion playhead remains SDK `player_state_changed` + interpolation (§1.4). Lore recap and anti-repetition rules below apply to **both** paths.

### 3.1 `actualPlaybackHistory` metadata coherence (MUST)

`WebOrchestrator.actualPlaybackHistory` (and the DirectStream session mirror) is the lore-recap source of truth (newest last, cap 5). DJ commentary recaps (`previousTrack` / `recentHistory`) MUST be derived strictly from this verified session playback (page `sessionPlayedRef` is the React mirror). Queue-offset slices and local-storage hydrate cursors MUST NOT back-fill recaps. Every append MUST be **identity-coherent**: never write a history tuple whose title/artist belong to a different `trackId` or URI / stream URL. After `flushForStationLaunch` / `abortPendingSpeechAndClearBuffers`, empty history MUST omit `previousTrack` (opener / song intro).

`recordActualPlayback()` / `buildLiveTrackInput()` resolve metadata in this strict order, each source requiring `source.id === targetTrackId` (DirectStream catalog / stream id; quarantined: Spotify catalog id or `spotify:track:` URI, compared via `normalizeSpotifyTrackId`):

1. `getCurrentTrackState()` — active track from the current event (DirectStream media element / SDK).
2. Queue row via `findQueueIndexForPlayingTrack` (same lookup as `syncIndexToPlayingTrack`), then require the row's `spotifyId`, stream URL, or `youtubeId` to match `targetTrackId`.
3. REST `getCurrentlyPlayingTrack()` **only if** the returned URI / id matches `targetTrackId` (quarantined companion). DirectStream MUST NOT call Spotify REST for this step.
4. `djPrefetchByTrackId.get(trackId)` **exact key only** — never fall back to `nextPrefetchKey` (that key is the upcoming warmup and would mix Track N+1 title/artist onto Track N).

If no coherent match exists, **skip** the history append (debug log) rather than storing a mixed/stale tuple. Consecutive same-`trackId` appends still dedupe.

### 3.2 Cross-break script history & anti-repetition (MUST)

DJ breaks forward the last six aired scripts so the LLM does not retell origin cities, album facts, or chart peaks across consecutive clips.

**Payload** (`WebOrchestrator.fetchDjAudio` / DirectStream generate-script path → `POST /api/generate-script`):

```ts
recentBreakHistory: this._broadcastHistory.slice(-6).map(e => e.script)
styleRotationIndex: this._broadcastHistory.length
```

`/api/generate-script` parses `recentBreakHistory` and folds it into `buildAntiRepetitionDirective()` alongside fact-engine `excludedFacts`. The system prompt's **CROSS-BREAK MEMORY** block lists the recent scripts and forbids repeating those facts.

**Pillar rotation:** Lore (`generateLoreScript`) calls `pickMusicologyPillar(styleRotationIndex)` so `roots_branches` rotates across chart, studio, personnel, lyrical, and era pillars instead of defaulting to origin stories every break.

**Mode A word ceiling:** `LORE_WORD_TARGETS.roots_branches` is **25–32 words (~12–14s)**; `loreWordCeiling` / `truncateToWordLimit` cap at **32**. This is a script-budget rule — quarantined `MODE_A_DURATION_THRESHOLD_SEC` stays **15.0**. DirectStream keeps the same ceiling even though mix-bus ducking is not duration-routed.

**ElevenLabs Turbo bounds** (`STANDARD_VOICE_SETTINGS` / `voiceSettingsForPersonality`): `stability >= 0.55`, `style <= 0.15`, `use_speaker_boost: false`. Lower stability or higher style on `eleven_turbo_v2_5` causes pitch jumps, distortion, and rushed cadence.

### 3.3 Companion seek, prefetch lead & skip abort (MUST)

**Dynamic prefetch lead:** Near-end warmup uses `getPrefetchLeadSeconds(commentaryFormat)` — **30s** default, **45s** Time Capsule, **60s** Director's Cut. `shouldPrefetchUpcomingBreak` compares remaining duration against that window. DirectStream AudioPlayer consumes the same helper.

**Seek remaining-time class (quarantined companion; statutory path forbids reverse scrub):** Companion seek handlers (`useWebOrchestrator.seekRemote`, `page.tsx` `handleCompanionSeek` → `spotifyRemote.seek`) MUST:

1. Compare remaining time **before** vs **after** the seek against the live lead window.
2. If the seek changes remaining-time class (inside lead ↔ outside lead), clear `nearEndUriRef`.
3. If the seek target lands **inside** the lead window, re-arm prefetch (`onNearEnd`) once for that URI.

**Entry freeze (quarantined companion):** Incoming Track B with a due break and no decoded speech buffer is held at volume 0 / `0:00` until Mode A/B resolution. Mode A then ducks only Track B's intro; Mode B keeps the freeze through speech and launches with an 800ms ramp. DirectStream does not freeze Track B; it ducks in-band via mix-bus.

**Live fetch budget:** If live `fetchDjAudio` exceeds `LIVE_DJ_FETCH_BUDGET_MS` (3s) — typical when remaining time is inside the lead window with no warmup — fall back to a short station liner or direct-start Track B. Do not wait on a long TTS payload.

**Skip abort:** `page.tsx` `skipTrack` MUST invoke `abortPendingSpeechAndClearBuffers` (sessionEpoch bump + prefetch controller cancel) before DirectStream skip (quarantined: `spotifyRemote.next()` / `previous()`) so in-flight TTS cannot air on the skipped-to track. The **60-minute sliding skip limiter** still gates whether the skip is issued.

---

## 4. TTS Synthesis Pipeline

Script generation (`/api/generate-script`) and shared prep (`src/lib/tts.ts`) produce the spoken payload. Downstream engines (ElevenLabs, OpenAI `tts-1`) receive only sanitized plain text.

### 4.1 TTS Input Sanitization

**SSML Stripping:** Strip or convert all XML / SSML tags (e.g. `<break time="..."/>`, `<say-as>`, and other markup) into natural punctuation (commas, periods, or ellipses) **before** dispatching text to third-party TTS engines that do not support raw XML payloads (including ElevenLabs REST and OpenAI `tts-1`). Raw SSML MUST never appear in the synthesis request body.

**Script sanitization (`sanitizeDjScript`):** Before TTS, strip markdown headers (`#` heading prefixes), underscores (`_`), paired and unpaired asterisks (`*`), stage directions (`[…]`, `(…)`, `*…*`), emojis / pictographs, and orphan trailing punctuation (commas, dashes, leftover markdown). Collapse whitespace.

**Mode A pause formatting (`formatScriptForTts({ compactPauses: true })`):** For `standard` and `roots_branches`, insert pauses only at true sentence boundaries (`.!?`). Do **not** inject per-clause ellipses or comma-split chunks joined by `" ... "` — those inflate spoken duration past the 15.0s Mode A threshold (quarantined companion) and past a tight DirectStream break.

**Lore word ceiling:** `roots_branches` is **25–32 words, max 32** (`loreWordCeiling` / `truncateToWordLimit`).

### 4.2 ElevenLabs Turbo voice parameters

`eleven_turbo_v2_5` (`ELEVENLABS_TTS_MODEL_ID`) MUST use:

| Parameter | Bound |
|-----------|-------|
| `stability` | **≥ 0.55** |
| `style` | **≤ 0.15** |
| `use_speaker_boost` | **false** |

`clampTurboVoiceSettings()` in `src/lib/dj/voice-settings.ts` enforces the floor/cap. `STANDARD_VOICE_SETTINGS` in `src/data/personas.ts` matches these bounds for the whole roster.

---

## 5. Host Retention, Persistence, Dial Presets & Studio Blueprints

The Model 3 Host Retention Engine (`src/lib/store/sessionStore.ts`) keeps the listener's chosen DJ persona sticky across channel changes **and** page refreshes.

### 5.1 localStorage keys

| Key | Value | Written when |
| --- | --- | --- |
| `songhost_active_host_id` | Persona / host id string (e.g. `jasper-reed`) | Explicit Host Studio persona pick (and any Host Settings edit that locks the current host) |
| `songhost_is_host_locked` | `"true"` / `"false"` | `lockHost()` / `resetHostLock()` |
| `songhost_dj_volume` | DJ voice gain string (`0`–`1`, default `0.85`) | Host Settings DJ Voice Volume slider |

Related Host Studio tuning (pace, lore / commentary format, mood, personality) continues to persist through user preferences / Host Settings; the host id / lock keys above are the **authoritative** Host Retention stamps for persona identity and lock state.

**Host-state setter hydrate (MUST):** On orchestrator construct and preference rehydrate, `useWebOrchestrator.applyHostState(..., { silent: true })` (and the DirectStream host-state path) stamps `isPro`, persona, `allowExplicit`, `commentaryFormat`, `vibePrompt`, `djMode`, and `djTuning` without bumping `sessionEpoch` or aborting speech. Subsequent settled changes (after the **400ms** debounce) call `abortPendingSpeechAndClearBuffers` at most once and MUST NOT follow with `flushPrefetch()`. See §1.0 Single-Execution & Cleanup Rules.

**Naming convention (MUST):** Client persistence keys use `songhost_*` (underscore) or `songhost:*` (colon) prefixes. Reads MUST check the canonical `songhost_*` / `songhost:*` key first; if absent, read the legacy `songghost_*` / `songghost:*` key, copy the value forward into the canonical key, and continue. Writes always go to the canonical key. Never perform a hard breaking key change on local/session storage.

**Spotify Connect device name (MUST — quarantined):** The embedded Web Playback SDK player MUST initialize with `name: "SongHost Radio"` so the listener's Connect device list shows SongHost Radio. DirectStream does not register a Spotify Connect device.

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

**Handshake gate (`isSpotifySyncPending` / DirectStream equivalent):** On session restore, `useStationQueue` hydrates the persisted queue into memory immediately so `syncIndexToPlayingTrack` / DirectStream `onTrackStarted` can resolve the live track. It MUST NOT stamp ControlDeck metadata (`stampQueueOpener`) while pending. Default is `true` when the restored queue carries companion Spotify catalog ids; DirectStream / YouTube restores are `false` and paint immediately unless a DirectStream stream URL handshake is still inflight. `page.tsx` `onTrackStarted` clears the flag immediately (even on a `-1` relink miss). `runReset` clears it at the start of non-hydrate relaunches. While pending, `ControlDeck` renders the placeholder ("Tuning in…", no artwork) even if restored `sessionStorage` title/artist/art props exist — eliminating the visual jump (e.g. "Creep" → live track). See §5.4 for the full handshake release lifecycle.

### 5.3 DJ TTS speech routing (MUST)

All DJ TTS audio MUST be decoded and played through the Web Audio API — **not** an unattached audible `HTMLAudioElement` — to prevent browser media-element mute / autoplay bugs.

**DirectStream (live):** Production DJ speech is `BufferedVoiceNode` (`src/lib/audio/VoiceNode.ts`). Live playback is an `HTMLAudioElement` tapped into the session analyser via `captureMediaElement` **only inside `play()` after `onStarted`**. Effective gain is `voiceGain(master, djVolume)` (`djVolume * VOICE_HEADROOM_BOOST`, media-element ceiling **1.0**). Music remains the only duck target (`DUCK_RATIO = 0.18`). Companion Web Audio still uses `AudioBufferSourceNode` → `speechGain` with `companionVoiceGain` (master is a **0-only mute gate**, headroom up to **1.35×**).

##### `VoiceNode.preload()` isolation (MUST)

Lookahead warming MUST stay off the live mix. `BufferedVoiceNode.preload(blob)` / `createLookaheadElement`:

1. Set `muted = true` and `volume = 0` **before** assigning `.src`.
2. MUST NOT call `captureMediaElement` / attach a `MediaElementAudioSourceNode` to the live session `AudioContext`.
3. MUST NOT `play()` the warmup element.
4. MUST NOT ramp `duckBus`. Duck-in attaches only in `play()` after `onStarted`.
5. Log `[SongHost TRACE 4] Prefetch buffer ready` on successful decode (`PRELOAD_DECODE_TIMEOUT_MS = 8s`). This is the **only** live-bus emitter of that tag. A clip that will not decode is discarded so the transition falls back to a fresh element.

`play()` unmutes, applies `voiceGain`, fires `onStarted`, taps the live graph, then ducks from the **current** bus level (so an early opener hold at 0.18 is not briefly unducked back to full). Live execution logs `[SongHost TRACE 4] DJ Voice on-air` **only** from this method, and **only** when the abort signal has not already fired. The follow-up `[SongHost TRACE] DJ voice audio .play() starting` line is likewise skipped on abort.

**Shared decode path (quarantined companion / Web Audio speech nodes):**

1. Fetch the TTS payload as an `ArrayBuffer` and decode with `audioContext.decodeAudioData(arrayBuffer)`.
2. Create an `AudioBufferSourceNode` (`speechSource`) and assign the decoded buffer.
3. Create a dedicated `GainNode` (`speechGain`) seeded from `localStorage.getItem('songhost_dj_volume')` (fallback `0.85`). DirectStream / companion Web Audio speech gain is **decoupled from linear `masterVolume` attenuation**: `masterVolume` is a **0-only mute gate**. Effective gain is `djVolume * VOICE_HEADROOM_BOOST`, allowing the `GainNode` to reach **1.35** max. Do **not** apply `clampGain`'s 1.0 ceiling on this Web Audio path.
4. Connect **`speechSource → speechGain → audioContext.destination`** (or into the mix-bus voice tap). DirectStream music ducks via `musicGain()` on the HTML5 element; the analyser tap is a single `captureMediaElement` source.
5. Ensure `audioContext.state === 'running'` (`resume()` when suspended) before `speechSource.start(0)`.
6. If an `HTMLAudioElement` fallback is unavoidable (Web Audio unavailable), set `audio.volume` and `audio.muted = false` **before** calling `audio.play()`. The **1.0 clamp remains only** on this media-element fallback (`HTMLAudioElement.volume` cannot exceed 1.0). Quarantined YouTube `VoiceNode` still uses `voiceGain(master, djVolume)` clamped ≤ 1.0 on the media element.

**Fail-closed voice integrity (MUST):** `/api/generate-script` and `/api/generate-voice` MUST synthesize the active host's mapped voice only. On ElevenLabs `400` / `402` / `429` (or a complete engine fault), do **not** fall through to a female premade (Rachel), a different Pro host (Miles), or generic OpenAI `tts-1` (`onyx` / `alloy`) while claiming the locked host. Fail the DJ break instead so music continues without a voice jump. Prefetched clips MUST match `activePersonaId` / `activeVoiceId` before playback; stale or mismatched buffers are discarded.

**Segment kind → teleprompter (MUST):** When DJ speech actually starts (`playFreshDjClip` / HTMLAudio fallback / DirectStream VoiceNode), the orchestrator MUST fire `onDjStart({ kind })`. Station launch liners, custom liners, and default breaks emit `kind: "song_intro"`. Studio cues may pass a mapped `DjSegmentKind` when authored (`kind: "call_in"` for R2 voicemails). `useWebOrchestrator` / DirectStream MUST forward `info.kind` into `startDjSegment` — never hardcode `artist_trivia`. `ScriptTeleprompter` and `BroadcastHistoryDrawer` render `song_intro` as the **INTRO** badge pill.

**Mode A / B unpause after speech (MUST — quarantined companion):** After Mode A swell or Mode B hard-launch, the companion transport MUST be SDK-verified as playing (`getCurrentState().paused === false`) before the orchestrator returns to `PLAYING_MUSIC`. Do not treat a REST resume `200` as proof the local playhead is moving. Volume ramps during that window stay on `player.setVolume()` so REST 429s cannot freeze the SDK at a stale position. DirectStream returns to `PLAYING_MUSIC` after the 1500ms restore; HTML5 `paused === false` is the playhead proof.

### 5.4 Mobile Gesture CTA Transport Handoff

iOS/Android will not resume a suspended `AudioContext` (or the silent WAV anchor) without a user gesture. While `isSpotifySyncPending` (or DirectStream handshake pending) is true, mobile ControlDeck (`< md`) MUST render an interactive button instead of static "Tuning in…" text:

- **"Tap to Resume Radio"** when a live DirectStream session, live Connect session, or persisted `lastStationId` exists
- **"Tap to Tune In"** otherwise

`page.tsx` `handleStandbyResume` runs **inside the tap** (no `setTimeout` before unlock):

1. `ensureListening()` — `markAudioUnlockRequested` / `primeAudioOnGesture` / `primeSilentAudioAnchor` / mix-bus `unlock()` + `context.resume()` / `playerRef.unlockAudio()`.
2. **Path A (Live Session)** — DirectStream has an active stream URL / media element → forced resume (`isPlaying: false`) from the live HTML5 playhead. **Quarantined Path A:** Spotify Connect has an active URI / companion session → `handlePlayPause` with `resume` / `transferPlayback` / `playTrack(restoredUri)`.
3. **Path B (Persisted Session)** — `lastStationId` from JSONB prefs (fallback: `readPersistedActiveStationId()`) resolves via `findTunableStation` → `selectStation`. Skip unresolvable `heavy-rotation-*` ids.
4. **Path C (Fallback)** — `playHeavyRotationStation()`.

Do **not** clear `isSpotifySyncPending` in the tap. Leave that to `onTrackStarted` (and `syncIndexToPlayingTrack` as a secondary path) so ControlDeck cannot flash a stale `sessionStorage` title.

#### Handshake release lifecycle (MUST)

See also §1.6. Station launch and session restore share one pending mask (`isSpotifySyncPending` → ControlDeck "Tuning in…") and one SDK event lock (`isLaunchingStation`). DirectStream arms `sessionLaunchPending` on explicit flushes only and confirms on the first on-playing emission.

Track transitions on songs 2+ MUST call `registerTrack(liveTrackId)` (advancing `registeredTrackIdRef`) once the launch lock is clear — **including** while `broadcastState === PREFETCHING_BREAK` — so Autopilot prefetch consume and live `isDjBreakDue()` checks can run. Skip registration only during quarantined `MODE_B_BED_FADE` / `MODE_B_SPEAKING`. Do not bump `sessionEpoch` on these hops. A matching prefetched break for the live track ID MUST execute (`"Executing prefetched DJ break"` / `"Using prefetched DJ break"`) via DirectStream mix-bus ducking (quarantined: Mode A ducking; Mode B only when decoded TTS > 15s) and MUST NOT be replaced by `getStationLaunchLiner`. `sessionLaunchPending` is a Track 1 one-shot and is already consumed on Track 1's first transition/attempt or any early return.

`lastStationId` is stamped in `beginStationSession` into the prefs blob and debounced to `users.preferences` JSONB via `schedulePreferencesSync`. Search launches (Full Album `album-deep-dive-*`, Artist Radio, Song Radio, AI Curator, Studio Mixes / Blueprints `studio-*`, tuner `tuner-*`) dual-write the live `{ stationId, station, queue, currentIndex }` snapshot to tab `sessionStorage` **and** `localStorage` `songhost:last_session` so they remain the primary active station across tabs and browser restarts. Boot restore is quiet (no unprompted playhead command): `sessionStorage` → `songhost:last_session` → `lastStationId` lookup → Heavy Rotation fallback. Heavy Rotation auto-stage MUST NOT run while last-session rehydration is pending, or when `lastStationId` is populated and is not `heavy-rotation-*`. Cloud preference GET must not overwrite a newer in-session `lastStationId`; the local id is pushed on the next prefs sync. Host Retention (`hostRetention.activeHostId` / `isHostLocked`) lands on `sessionStore` (`songhost_active_host_id`, `songhost_is_host_locked`) during cloud hydrate so station auto-match cannot overwrite a restored host. Ducking ratios, Mode A/B transport hold timing, mix-bus 300ms / 1500ms ramps, and volume ramps MUST NOT change on this path.

### 5.5 Live Channel Dial Presets (1–6)

Memory buttons 1–6 are **Live Channel Dial Presets**, not static playlists. Parking a slot stores a **Station Profile JSON** (`MemoryPreset` seeds) plus a parked **`StationConfig`** snapshot (`user_memory_slots.stationConfig` JSONB and `UserPreferences.stationConfigs[stationId]`). Tuning a slot dynamically generates a **fresh statutory non-interactive stream** through `useStationQueue` + `DirectStreamProvider`. Recalling a dial MUST NOT restore a frozen, listener-ordered track list as on-demand playback.

| Slot | Index | Contract |
|------|-------|----------|
| Buttons 1–6 | `memoryPresets[0..5]` | `MemoryPreset \| null` (seeds + dial chrome — not a playlist snapshot) |
| Host overlay | `stationConfigs[stationId]` | `StationConfig` folded by `resolveStationSettings()` |
| Shape lock | `MEMORY_PRESET_COUNT = 6` | `normalizeMemoryPresets()` before any index — always exactly 6 entries |
| UI | `MemoryToolbar.tsx` | Tap = tune (regenerate statutory stream); long-press / right-click = park profile |
| Hotkeys | `useKeyboardShortcuts.ts` | Digits `1`–`6` call `playMemorySlot(slotIndex)` |
| Cloud sync | `user_memory_slots` + `user_saved_stations` + `users.preferences` JSONB | `/api/user/sync` |

Only preset / saved **station profiles** may be parked; ephemeral artist-radio / curator launches cannot be recalled from the dial as a frozen queue.

### 5.6 Station Blueprint Builder (`/studio`)

Ghost Studio (`src/app/studio/page.tsx`) is a **Station Blueprint Builder**, not an explicit song sequencer. A published blueprint stores the rules that generate a live statutory channel:

| Blueprint field | Role |
|-----------------|------|
| Seed criteria | Artist / genre / era / energy / catalog-depth seeds (`TuneStationPanel` `seedsOnly`; Last.fm similarity, MusicBrainz dating). DirectStream resolves `streamUrl` / HTTP `previewUrl`. |
| Vibe directives | Listener-authored `vibePrompt` / custom host notes folded by `resolveStationSettings()` |
| Host rules | Persona, chatter pacing, commentary format, mood / personality, Clean Mode |
| Caller voicemails | R2-hosted call-in stems (`/api/studio/upload-voicemail`) cued as `kind: "call_in"` breaks |

`/api/studio/save-station` serializes this blueprint (plus optional cover and `djConfig`) to R2. Playback never treats the blueprint as an on-demand playlist: `useStationQueue` generates a fresh non-interactive queue from the stored profile each session. Historical `StudioStationManifest.tracks[]` / `djBreaks[]` cue lists remain valid payload fields for authored liners and voicemails, but they do not reintroduce interactive sequencing.

---

## 6. Key Invariants (Do Not Regress)

1. **DirectStream first song:** pause until audio unlock → arm `launchHoldActive` (default `hard_pause`) → play from position **0** under the hold (`hard_pause` stays paused at `0:00`; `intro_ramp` may play only at `DUCK_RATIO = 0.18`) → emit on-playing once per track load (no `onPaused` bounce). Duck gain is re-asserted on ready / load-settle / playing. Track 1 MUST NOT start un-held at full gain. Quarantined YouTube: pause → unlock → `seekTo(0)` → play → single `tryEmitOnPlaying()` per load.
2. `sessionOpeningDjRef` only on `stationId` / `queueGeneration` change.
3. Opening DJ is `song_intro` unless `chatterPacing === "music_only"`.
4. `silent` / `plan: null` → AudioPlayer must not force a DJ intro.
5. Stabilize audio-hook callbacks in refs; no unstable effect deps.
6. Duck: DirectStream / HTML5 **0.18** floor / **300 ms** duck-in / **1500 ms** restore. Voice bus is **never** sidechained (`VOICE_HEADROOM_BOOST = 1.35×`). Quarantined companion **Mode A**: mood-aware relative ducking (`0.18` default, Chill `0.12`, Hyped `0.25`) over **600 ms** linear, log swell **800 ms** default (Chill `1200 ms`, Hyped `400 ms`). Quarantined companion **Mode B**: ramp to **0** over **1500 ms**, hold station bed at **0.25**, decay **400 ms** before hard-launch. Format-aware Pause–Talk–Resume is Phase 6 on companion.
7. Prefetch plans the break **once**; consumer commits `nextState` at take time. Zero-latency engine warms at **≤30s** remaining into `prefetchedBreaksMap` (Time Capsule **45s**, Director's Cut **60s** via `getPrefetchLeadSeconds`). Prefetch buffers stay isolated (`muted` / `volume = 0` before `.src`; never session `AudioContext` / `MediaElementAudioSourceNode`). TRACE 4 is a **single-emitter** split: `Prefetch buffer ready` **only** in `VoiceNode.preload()`; `DJ Voice on-air` **only** in `VoiceNode.play()` (skip both on-air lines when the abort signal has already fired). Do not re-emit from `dj-intro.ts`, `AudioPlayer.tsx`, or `prefetchEngine.ts`.
8. Era lock rejects undated candidates; under lock, source dated catalogs (MusicBrainz / B2B, historically iTunes), not bare YouTube search.
9. `memoryPresets` is always length 6 after `normalizeMemoryPresets()`. Each slot stores a **Station Profile JSON** plus a parked **`StationConfig`** that regenerates a statutory stream — never a frozen on-demand playlist.
10. Analyser capture never routes into a suspended graph.
11. **Background Visibility Guard:** Tab visibility changes or SDK WebSocket reconnects MUST NOT trigger audio playback when the UI state is paused.
12. **Station Queue Isolation:** Observer telemetry handlers must never mutate state arrays when lookups fail. Rogue driver tracks must be force-corrected back to the canonical station queue.
13. **Spotify Redirect URI Invariant (quarantined):** Spotify OAuth strictly disallows `localhost` URIs. Local development MUST strictly use `127.0.0.1:3000` (`http://127.0.0.1:3000/api/auth/spotify/callback`); production MUST use `https://song-ghost.vercel.app/api/auth/spotify/callback`.
14. **Station Handoff Invariant (quarantined companion):** Station switches MUST arm `AudioPlayer.armStationHandoff()` before queue updates so `handleNewTrack` cannot burn Search ahead of `launchStation`. Disarm after the official companion launch. DirectStream launches skip companion Search.
15. **Preservation of Native Track Identifiers (quarantined companion):** `onCompanionPlayTrack` / `launchCompanionTrack` MUST pass `spotifyId` / `spotifyUri`. `launchCompanionTrack` checks `spotifyUriForQueueTrack()` before Search. Resolved URIs persist via `updateTrackAt`. DirectStream rows persist `streamUrl` + ISRC the same way (`updateTrackAt`, never in-place mutation).
16. **In-Memory Search Deduplication & Negative Caching (quarantined):** `searchSpotifyTrackUri` MUST check the LRU `artist:title` cache first (cap **256**), fail-fast when `isSpotifyCircuitOpen()`, negatively cache 429s for **60 s**, and bound parallel Search GETs to **2**. After title/artist sanitization, Search is **3-tier**: quoted `track:"…"` / `artist:"…"` → un-fielded `title artist` → title-only (skipped when it would duplicate Tier 2). Later tiers run only when the previous is non-OK, empty, or a network error — not on 429.
17. **Spotify REST 429 Circuit Breaker (quarantined):** `fetchSpotifyGetWithRetry` / `spotifyApiFetch` MUST trip on HTTP 429, honor `Retry-After` (default **30 s**), never retry 429, and fail-fast remaining GETs while the circuit is open.
18. **Launch handshake (quarantined companion):** `beginStationLaunchLock` MUST NOT arm on empty/`undefined` URIs, and MUST NOT arm unless `flushSession === true`. Confirm when the live id matches **any** launched URI (normalized) or `linked_from.id`. If the lock is still armed after **3s** of active playback, release it so `onTrackStarted` / `registerTrack` can run. DirectStream confirms on the first on-playing emission; `sessionLaunchPending` remains a Track 1 one-shot.
19. **Station launch liner vs Autopilot prefetch:** `sessionLaunchPending` is a Track 1 one-shot — armed only on explicit flushes/launches and cleared on any track advance or `runDjBreakInternal` / `resolveDjAudio` early return. Prefetched breaks for the live track ID take precedence over a stale launch flag and execute via DirectStream mix-bus ducking (quarantined Mode A in-band ducking; no `pause()` + `seek(0)`). Do not re-arm the flag when `executedBreakTrackIds` is empty. `registerTrack` must run during `PREFETCHING_BREAK`; skip only `MODE_B_BED_FADE` / `MODE_B_SPEAKING`.
20. **Spotify OAuth click-gating (quarantined):** `connectSpotify()` MUST require `{ intent: true }` or a live user activation before `window.location.assign` to `/api/auth/spotify`. HttpOnly PKCE cookies are `sg_spotify_oauth_state` and `sg_spotify_pkce_verifier`. Post-Clerk boot evaluates `!isSignedIn` immediately on `authLoaded` (Step 1, no Spotify wait) and MUST NOT auto-open Step 2. It MUST NOT auto-start OAuth. `connectSpotify` identity is ref-stabilized (`isConnectingRef`).
21. **DirectStream is the production bus:** New station launches MUST attach to `DirectStreamProvider` (HTML5 `<audio>`, `musicGain()` on the element, single `captureMediaElement` tap). `suppressLocalAudio` stays `false`. Do not re-enable Spotify / Apple / YouTube as the live bus without an explicit product decision. Quarantined adapters stay under `src/lib/audio/legacy/` and MUST NOT be deleted. Connection chrome stays unmounted (`companionActive: false`).
22. **SoundExchange ROU:** Plays **>30s** MUST write Postgres `user_play_logs` with unique `playSessionId` (`buildPlaySessionId` + `committedSessionIdRef` + `onConflictDoNothing`). Sub-30s plays are not logged as a performance. Quarantined companion SDK events MUST NOT write this table.
23. **Non-interactive programming:** Station Blueprints and Live Channel Dial Presets (`StationConfig` + seeds) generate streams from profile JSON. They MUST NOT restore a listener-ordered on-demand playlist as the live queue. `useStationQueue` / `statutory-rules.ts` enforce §114 artist cap (4 / 3h, max 3 consecutive), album cap (3 / 3h, max 2 consecutive). `skip-limiter.ts` enforces **6 skips per 60-minute sliding window**. `QueueModal` obfuscates forward titles. No reverse scrub / instant replay.
24. **Launch hold:** `DirectStreamProvider.launchHoldActive` (`setLaunchHold` / `releaseLaunchHold` / `isLaunchHoldActive` / `getLaunchHoldActive` / `getLaunchHoldMode`) MUST keep Track 1 at `hard_pause` (paused `0:00`) or `intro_ramp` (pre-ducked `DUCK_RATIO` from `0:00`). `handleNewTrack` arms the hold synchronously while `sessionOpeningDjRef` is true, before any `await`. `shouldPauseForStationLaunchVocals(0, true)` treats a held playhead as true `0:00`. Station-launch liners skip `resolveLocalEvent`.
25. **Prefetch graph isolation:** `VoiceNode.preload()` MUST NOT attach to the live session graph. `play()` is the sole `captureMediaElement` / duck-in entry. TRACE 4 `Prefetch buffer ready` is emitted **only** from `preload()`; `DJ Voice on-air` **only** from `play()` after abort-signal check.
26. **Strict catalog identity:** Seed launches and DirectStream `.src` assignment MUST pass `itunesTitlesMatch` / `itunesArtistsMatch` (or `itunesTrackMatchesQuery`). `lookupITunesTrack` returns `null` on miss — never title-only `includes` or rank-0 `songs[0]`. `DirectStreamProvider.load()` rejects stamp mismatches and URL-only iTunes/mzstatic provider IDs that lack title/artist identity.
