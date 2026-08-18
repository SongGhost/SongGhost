# SongHost Architectural Bug Audit

**Date:** 2026-08-10  
**Scope (read-only):** `ControlDeck.tsx`, `mix-bus.ts`, `webOrchestrator.ts`, `spotifyRemote.ts`, `prefetchEngine.ts`, `useYouTubePlayer.ts`, `weather.ts`  
**Constraint:** No application source was modified. Findings and proposed remediations only.

---

## Executive summary

Three independent disconnects explain the reported symptoms:

1. **Master volume** updates React + YouTube/preview/VoiceNode/SFX, but **never reaches Spotify / WebOrchestrator** when companion mode owns the stream. `mix-bus` also has no master `GainNode` fader — only pure gain math + a metering tap.
2. **DJ timing** has **three lookahead constants** (15s / 20s / 30s), a **dead `prefetchedBreaksMap` consumer path**, and companion breaks that **discard local warmup then speak after music already started**.
3. **Weather on localhost** correctly prefers `homeCity`, but an **800ms race** often nulls the result before Open-Meteo geocode finishes; blank `homeCity` + `127.0.0.1` yields permanent `null`.

---

## 1. Volume Disconnect Analysis

### 1.1 End-to-end trace (ControlDeck → audio targets)

```text
ControlDeck <input type="range">
  └─ onChange → onVolumeChange(newVolume)          // 0–1
       └─ page.tsx: setVolume(next)                // React state only
            ├─ AudioPlayer volume={volume}
            │    ├─ useYouTubePlayer → provider.setVolume(volume)
            │    │    └─ YouTubeTrackProvider.applyVolume()
            │    │         → YT setVolume(musicVolumePercent(master, duck))
            │    ├─ usePreviewPlayer → Html5 provider.setVolume
            │    ├─ voiceNode.setVolume(volume)     // local TTS path
            │    └─ stingers.setMasterVolume(volume)
            └─ ❌ NO call to WebOrchestrator.setVolume / setSpotifyVolume
```

`ControlDeck` itself is not the bug — it is a pure prop bridge (`volume` / `onVolumeChange`). Propagation stops in `page.tsx`:

```1744:1747:src/app/page.tsx
        onVolumeChange={(next) => {
          setVolume(next);
          if (onAir) ensureListening();
        }}
```

Transport (play/pause/skip/seek) is wired to `spotifyRemote` when `companionActive`; **volume is not**.

### 1.2 Where state updates stop propagating

| Target | Connected to ControlDeck master? | Mechanism |
|--------|----------------------------------|-----------|
| YouTube IFrame | Yes (when not suppressed) | `useYouTubePlayer` → `BaseTrackProvider.setVolume` → `musicGain` → `setVolume` percent |
| HTML5 preview | Yes (when not suppressed) | Same provider pattern |
| Local DJ TTS (`VoiceNode`) | Yes | `voiceNode.setVolume(volume)` |
| SFX / stingers | Yes | `stingers.setMasterVolume(volume)` |
| Spotify Web Playback SDK | **No** | Booted at `volume: 1.0`; duck/swell only via `setSpotifyVolume` |
| Spotify Connect REST volume | **No** | Same dual-path API; never fed ControlDeck state |
| Apple MusicKit | **No** | `WebOrchestrator.setVolume` exists but is unused by the slider |
| Companion DJ TTS | **No** | `effectiveDjVoiceGain()` hardcodes `voiceGain(1, djVolume)` |

When `activeProvider === "spotify"`, `AudioPlayer` sets `suppressLocalAudio = true`, unloads YouTube/preview, and freezes local transport. The slider still updates React state and local voice/SFX nodes, but **the audible music bed is Spotify**, which never receives the new gain.

### 1.3 `mix-bus.ts` — no master GainNode binding

`mix-bus` exports **pure functions** (`musicGain`, `voiceGain`, `sfxGain`) and a `MasterAnalyser` whose output `GainNode` is fixed at unity for metering:

```377:379:src/lib/audio/mix-bus.ts
    // Unity: the per-channel gains upstream already carry the fader, so trimming
    // again here would both change the mix and misreport what is on air.
    output.gain.value = UNDUCKED_GAIN;
```

There is **no** shared master fader `GainNode` that ControlDeck can bind. YouTube volume is applied via IFrame API percent math; Spotify volume is a separate remote device control. The telemetry in `musicGain` / ControlDeck / Spotify SDK therefore log three different “volumes” that are not the same bus.

### 1.4 Spotify duck math compounds the disconnect

Companion Duck–Talk–Swell ramps to an **absolute** duck floor (`STANDARD_BREAK_DUCK_RATIO = 0.25`), not `preBreakVolume * ratio`:

```2738:2742:src/lib/player/webOrchestrator.ts
    const ducked = await this.rampMusicVolume(
      preBreakVolume,
      duckTarget,
      SPOTIFY_DUCK_RAMP_MS,
```

Local YouTube path uses relative ducking (`master * DUCK_RATIO` with `DUCK_RATIO = 0.18`). Even after wiring the slider to Spotify, these models disagree unless Spotify duck becomes `preBreakVolume * ratio` (or ControlDeck becomes the sole `preBreakVolume` source).

### 1.5 Severity

**P0 — functional disconnect** for Spotify/Apple companion listening: ControlDeck fader appears to move, music level does not.

---

## 2. DJ Timing & Ducking Analysis

### 2.1 Position / duration flow

```text
YouTube path:
  YouTubeTrackProvider.poll (500ms)
    → publishPosition(position, duration)   // duration sticky once > 0
    → useYouTubePlayer onTimeUpdate → setCurrentTime/setDuration
    → AudioPlayer currentTime/duration
         ├─ shouldStartLookahead (LOOKAHEAD_SECONDS = 20) → DjPrefetchController
         └─ notePlaybackProgress → DjBreakPrefetchEngine.observeProgress (30s)

Spotify companion path:
  subscribeSpotifyPlaybackState (poll 2000ms, nearEndMs = 30_000)
    → companionPlayback.progressMs/durationMs
    → AudioPlayer scrub clock (same notePlaybackProgress + DjPrefetchController)
    → onNearEnd → page prefetchCompanionDjBreak → WebOrchestrator.prefetchDjBreak
```

`useYouTubePlayer` only **logs** the lookahead check; it does not start prefetch. Real warmup lives in `AudioPlayer` + `useStationQueue` + companion monitor.

### 2.2 Lookahead constant drift

| Constant | Value | Used by |
|----------|-------|---------|
| `LOOKAHEAD_SECONDS` (`dj-prefetch.ts`) | **20s** | `AudioPlayer` / `useYouTubePlayer` telemetry |
| `PREFETCH_LOOKAHEAD_SECONDS` (`prefetchEngine.ts`) | **30s** | `DjBreakPrefetchEngine`, companion `COMPANION_PREFETCH_NEAR_END_MS` |
| `SPOTIFY_NEAR_END_MS` (`spotifyRemote.ts`) | **15s** | Default if caller omits `nearEndMs` (companion overrides to 30s) |

Three windows mean telemetry, local warmup, and remote warmup disagree on when a break is “due.”

### 2.3 Orphaned `prefetchedBreaksMap` (dead consumer)

`useStationQueue.notePlaybackProgress` correctly calls `observeProgress` into `DjBreakPrefetchEngine` / `prefetchedBreaksMap`. It also exposes `takePrefetchedDjBreak`.

**No production caller invokes `takePrefetchedDjBreak`.**  
`AudioPlayer.handleNewTrack` only claims `DjPrefetchController.take(...)`. Companion mode then **discards** that local warmup:

```836:853:src/components/AudioPlayer.tsx
    if (companionActiveRef.current) {
      releaseWarmedClip();
      const playTrack = onCompanionPlayTrackRef.current;
      ...
      await playTrack(companionTrack);
      ...
      await companionBreak(companionTrack);
```

Net effect:

1. Engine A (20s, `DjPrefetchController`) may warm a clip that companion throws away.
2. Engine B (30s, `prefetchedBreaksMap`) warms clips nobody claims.
3. Companion relies on `WebOrchestrator`’s separate prefetch map; on miss, **live TTS runs after music has already started**.

### 2.4 Why breaks feel late / overlap vocals

1. **Speak-after-play ordering (companion):** `playTrack` then `companionBreak`. Duck starts only after script/TTS resolve. Song intro vocals play unducked during network + synthesis.
2. **Live fallback latency (both paths):** If warmup misses the window (short tracks, slow TTS, aborted retarget, duration stuck at 0 until sticky metadata arrives), `generateDjBreak` / `fetchDjAudio` runs at transition time. Duck ramps when voice starts, not when generation starts.
3. **Shallow / absolute Spotify duck:** Absolute 25% bed under host (vs local 18% relative) leaves more music energy under speech → perceived vocal collision.
4. **Poll granularity:** Spotify REST progress is ~2s; near-end fire can be up to ~2s late vs true remaining time. Combined with a missed prefetch, late duck is common.
5. **Duration cold-start:** `publishPosition` ignores `duration <= 0`, so early ticks report `duration: 0` → `shouldStartLookahead` / `shouldPrefetchUpcomingBreak` return false until YouTube/Spotify reports a positive duration. Mid-track metadata delay shrinks the effective warmup window.
6. **Voice completion is wired correctly** on both paths (`ended` + `SPEECH_END_TAIL_MS` / `DJ_SPEECH_END_TAIL_MS` = 300ms) — swell/unduck is not the late-trigger bug. The bug is **start timing**, not missing completion callbacks.

### 2.5 Duck ratio inconsistency (local vs companion)

| Path | Duck ratio | Relative to master? |
|------|------------|---------------------|
| `mix-bus.DUCK_RATIO` / `VoiceNode` | **0.18** | Yes (`master * duck`) |
| `STANDARD_BREAK_DUCK_RATIO` / Spotify | **0.25** | No (absolute device volume) |

Architectural invariant in workspace rules (“duck to 18%”) is violated on the companion path.

### 2.6 Severity

**P0** for companion late/overlap; **P1** for YouTube live-fallback latency and dual-engine waste.

---

## 3. Weather Resolution Analysis (localhost / `127.0.0.1`)

### 3.1 Intended order (`weather.ts`)

1. Non-empty `homeCity` → Open-Meteo geocode → forecast.  
2. Else usable public IP → ipapi.co / ip-api.com → forecast.  
3. Failures → `null` (script generation continues without weather).

`isUsablePublicIp` **rejects** `127.0.0.1` and `::1`. On local Next.js, `extractClientIp` typically yields loopback → IP path is a hard no-op.

### 3.2 Does `homeCity` resolve when IP fails?

**Yes, by design — if geocode completes in time.**

```418:438:src/lib/location/weather.ts
  const homeCity = options.homeCity?.trim();
  if (homeCity) {
    const geo = await geocodeHomeCity(homeCity);
    if (geo) {
      const result = await weatherForGeo(geo);
      ...
      return result;
    }
    // Geocode failed — still try IP so atmosphere isn't totally blank.
  }

  const ip = options.ipAddress?.trim();
  if (!ip || !isUsablePublicIp(ip)) {
    ...
    return null;
  }
```

On localhost with Broadcast City set: IP fallback cannot save a failed geocode. With Broadcast City blank: weather is always `null`.

### 3.3 The real localhost failure mode: 800ms race

`/api/generate-script` uses:

```ts
getBriefWeatherWithin({ homeCity, ipAddress: clientIp }, WEATHER_LOOKUP_DEADLINE_MS) // 800ms
```

Provider fetch timeout inside `weather.ts` is **5000ms**, but the API race resolves `null` at **800ms**. Cold geocode + forecast often loses that race → scripts get no weather **even when `homeCity` is configured**. Cached hits (30min TTL) succeed after the first warm resolution.

`getBriefWeatherWithin` early-outs correctly when neither home nor public IP exists — good. It does **not** extend the deadline when only `homeCity` is available (the localhost case that most needs headroom).

### 3.4 Telemetry caveat

After a homeCity geocode miss that falls through to IP, logs still report `source: "homeCity"` because the ternary keys off the string’s presence, not which branch returned. Misleading under VPN/local debugging; not the functional root cause.

### 3.5 Severity

**P1** — localhost + blank city = no weather (expected).  
**P1** — localhost + set city still often null because of the 800ms deadline vs 5s provider timeout.

---

## 4. Proposed Surgical Remediation Plan

Review before execution. Prefer minimal bridges; avoid redesigning the mix graph in one pass.

### 4.1 Volume — wire ControlDeck master to companion transport

**Files:** `src/app/page.tsx`, optionally `src/hooks/useWebOrchestrator.ts`

1. On `onVolumeChange`, after `setVolume(next)`:
   - If `companionActive`, call `webOrchestrator.setVolume(next)` (or expose `spotifyRemote.setVolume` that wraps the same dual-path API).
2. When Spotify SDK player is created (`volume: 1.0`), initialize from current React `volume` state instead of hardcoding `1.0`.
3. In `WebOrchestrator.effectiveDjVoiceGain()`, use a stored master (from step 1) instead of `voiceGain(1, this.djVolume)` so companion TTS tracks the fader.
4. Keep YouTube/`VoiceNode`/stinger paths as-is (already wired).

**Optional follow-up (same PR or next):** Change Spotify duck target from absolute `duckRatio` to `clamp(preBreakVolume * DUCK_RATIO)` and align `STANDARD_BREAK_DUCK_RATIO` → `DUCK_RATIO` (0.18) so companion matches the architectural invariant.

### 4.2 DJ timing — one lookahead, one cache, duck-before-TTS wait

**Files:** `prefetchEngine.ts`, `dj-prefetch.ts`, `AudioPlayer.tsx`, `useStationQueue.ts`, `useWebOrchestrator.ts`, `webOrchestrator.ts`

1. **Unify lookahead** to a single exported constant (recommend **30s** to match TTS budget; re-export from one module). Update `LOOKAHEAD_SECONDS`, `PREFETCH_LOOKAHEAD_SECONDS`, and companion `nearEndMs` to that value. Leave `SPOTIFY_NEAR_END_MS` as a named alias or delete if unused.
2. **Wire or delete `prefetchedBreaksMap`:**
   - Preferred: In `AudioPlayer.handleNewTrack`, before live plan, `takePrefetchedDjBreak(startedKey)` and feed `audioBlob` into `playDjIntro` / companion break seed.
   - Or stop calling `observeProgress` from `useStationQueue` if companion-only prefetch remains the source of truth — but do not keep both producers with zero consumer.
3. **Companion ordering:** For voiced transitions, ensure orchestrator prefetch is claimed **before** or **as** music starts; if live generation is required, begin duck (or hold pause) while awaiting TTS so unducked vocals do not establish under silence-to-speech latency.
4. **Do not** `releaseWarmedClip()` unconditionally on companion path until the orchestrator map has an equivalent claim — or skip local warmup entirely when `companionActive` to avoid double synthesis.
5. Keep `ended` + 300ms tail — no change needed for completion callbacks.

### 4.3 Weather — localhost / homeCity reliability

**Files:** `src/lib/location/weather.ts`, `src/app/api/generate-script/route.ts`

1. When `homeCity` is present, either:
   - Raise `WEATHER_LOOKUP_DEADLINE_MS` for the homeCity path (e.g. 2500–4000ms), **or**
   - In `getBriefWeatherWithin`, if `hasHome && !hasIp`, use a longer deadline automatically.
2. Ensure `homeCity` from `UserPreferences` is always forwarded on generate-script / prefetch (already present on AudioPlayer / prefetch context — verify companion `prefetchDjBreak` / `fetchDjAudio` body includes it).
3. Fix telemetry `source` to reflect the branch that actually returned (`"homeCity" | "IP" | "none"`).
4. Document in Host Settings that Broadcast City is **required** for weather on localhost (IP geo cannot work).

### 4.4 Suggested execution order (tomorrow)

| Step | Change | Risk | Validates |
|------|--------|------|-----------|
| A | Bridge ControlDeck → `orchestrator.setVolume` + SDK init volume | Low | Spotify fader moves bed |
| B | Companion DJ voice uses master in `effectiveDjVoiceGain` | Low | TTS tracks fader |
| C | Align duck to `DUCK_RATIO` relative to `preBreakVolume` | Medium | Duck depth matches YouTube |
| D | Unify lookahead constant; wire or remove `prefetchedBreaksMap` | Medium | Prefetch hit rate / no double TTS |
| E | Companion: duck/hold during live TTS wait | Medium | No unducked vocal bed under late break |
| F | Weather deadline + telemetry fix | Low | Localhost + homeCity returns weather |

### 4.5 Out-of-scope (do not expand tomorrow)

- Building a true Web Audio master `GainNode` that captures YouTube (cross-origin iframe cannot feed the graph).
- Replacing Spotify REST polling with SDK-only clocks (nice follow-up, not required for the disconnects above).
- Phase 2+ sidechain redesign beyond aligning the existing 18% invariant.

---

## 5. Evidence checklist (for re-verification)

```text
[TELEMETRY: UI Volume]           → ControlDeck slider
[TELEMETRY: SDK Volume]          → useYouTubePlayer / WebOrchestrator.setVolume
[TELEMETRY: WebAudio Gain]       → musicGain() math (not a live GainNode fader)
[TELEMETRY: DJ Timing Check]     → useYouTubePlayer + prefetchEngine + dj-prefetch
[TELEMETRY: Duck Start/Restore]  → WebOrchestrator Duck–Talk–Swell
[TELEMETRY: Weather Resolution]  → getBriefWeather (source field currently ambiguous)
```

Manual repro matrix:

1. Spotify companion on-air → move ControlDeck volume → confirm device volume unchanged (bug) / changed (after fix A).  
2. YouTube station → move fader → embed volume tracks (already works).  
3. Companion break with network throttling → confirm music unducked until TTS (bug) / ducked during wait (after fix E).  
4. `127.0.0.1` + empty Broadcast City → weather null.  
5. `127.0.0.1` + Broadcast City set, cold cache → often null today under 800ms; should succeed after fix F.

---

*End of read-only audit. No application logic was changed.*
