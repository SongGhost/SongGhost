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

sessionEpoch (integer): Incremented on every station switch, host persona change, or manual setting edit. All async API promises check if (promiseEpoch !== currentSessionEpoch) and abort if mismatched.

currentAbortController: Active AbortController instance. Calling abort() cancels pending script fetches and TTS downloads, revokes object URLs, and flushes
