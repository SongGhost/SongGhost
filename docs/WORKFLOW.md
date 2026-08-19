# AI Collaboration & Engineering Cadence
**Status:** Canonical Process Reference

**North Star:** Put your phone in your pocket, listen to music, and learn more about what you hear.

SongHost is a **statutory non-interactive radio engine** under SoundExchange **§114** (non-interactive webcasting) and **§112** (ephemeral recordings). The live music bus is **`DirectStreamProvider`** — an un-suppressed native HTML5 `<audio>` element. Mix-bus `musicGain()` ducks the element; `captureMediaElement` opens a single analyser tap. Track 1 uses a zero-frame `launchHoldActive` lock; prefetch buffers stay isolated from the live session graph. Spotify Web Playback SDK, Apple MusicKit JS, and the YouTube IFrame API are **quarantined reference adapters** under `src/lib/audio/legacy/`; they are not launch blockers and must not be used as primary execution or merge gates. Connection chrome (`MusicSourceHeader`, home `HeavyRotationShelf`) is unmounted; `companionActive` is forced `false`.

When working on audio orchestration, statutory queue generation, ROU telemetry, state management, or UI synchronization, always execute tasks using this strict **5-Step Iterative Cycle**. The Pocket Mode Doctrine and Statutory Compliance Invariant outrank feature work until DirectStream screen-off listening and §114 programming hold on real devices.

---

## Core Operating Doctrines & Principles

**Active milestone:** Phase 5F — GTM filings & store submission ([ROADMAP.md](./ROADMAP.md)). Phase 5A–5E (DirectStream bus with zero-frame launch holds and isolated prefetch buffers, §114 queue, ROU logger, Station Blueprint / Memory Dial) are **shipped**. These rules still govern every investigation until DirectStream screen-off listening and §114 programming hold on real devices.

### Pocket Mode Doctrine

**Phone in pocket is the product.** Screen-off PWA listening, lock-screen Media Session transport controls, and uninterrupted Web Audio sidechain ducking must survive OS background throttling without silent audio drops or speech clipping. A session that dies, skips, or talks over the song when the phone is in a pocket is a ship-blocker.

Validate against lock-screen, background, and PWA suspend — not just a lit desktop tab. Do not treat Spotify SDK reconnect, YouTube iframe DevTools, or a foreground companion player as proof that Pocket Mode holds.

### Cockpit UI philosophy

The UI exists to **launch, tune, and configure host settings** before slipping the phone away. It is a radio cockpit, not the listening surface. Do not add glance-required chrome, interstitial screens, or workflows that assume the listener is watching. If a change only helps someone staring at the phone, it is out of scope until Pocket Mode holds.

### Human-Grade Transition Discipline

Speech must duck cleanly over music intros/outros using native Web Audio gain ramps in `src/lib/audio/mix-bus.ts`. Voice audio must **never collide with main lead vocals**. Track 1 of a session is held (`hard_pause` at `0:00` or `intro_ramp` at 18%) until the opener is on air — it MUST NOT start un-held at full gain. Timing regressions — late ducks, early talk-up, clipped outros, talking into a vocal — are defects, not taste. Fix the mix before adding new break kinds.

| Parameter | Constant (`mix-bus.ts`) | Value |
|-----------|-------------------------|-------|
| Duck target | `DUCK_RATIO` | **18%** of master |
| Duck-in ramp | `DUCK_RAMP_MS` | **300 ms** linear |
| Restore ramp | `RESTORE_RAMP_MS` | **1500 ms** |
| Voice headroom | `VOICE_HEADROOM_BOOST` | **1.35×** |

Only the music channel is sidechained. The voice bus is never ducked. Format-aware Pause–Talk–Resume is **Phase 6 polish** and must not be implemented as the live DirectStream path. Quarantined companion Mode A/B (duration-based duck–talk–swell vs station-bed) is frozen reference code only.

### Statutory Compliance Invariant

All queue generation testing must verify DMCA statutory webcasting rules (17 U.S.C. § 114) in `useStationQueue` / `src/lib/queue/statutory-rules.ts` / `src/lib/queue/skip-limiter.ts`:

- **3-hour rolling artist/album admission** (`STATUTORY_WINDOW_MS`): max **4** tracks by the same featured artist (max **3** consecutive); max **3** tracks from the same album (max **2** consecutive).
- **60-minute sliding skip limiter** (`SKIP_WINDOW_MS`): max **6** skips per window. A skip that would exceed the cap MUST be refused; the on-air track continues.
- **Queue obfuscation:** `QueueModal.tsx` MUST NOT display forward track titles or artists. First upcoming row **"Up Next: Smart Station Stream"**; later rows **"Later in the Stream"**. The on-air row MAY show the current title/artist/artwork. Historical rows MAY appear in Broadcast Log History — that is recap, not a pre-published playlist.
- No reverse scrub, instant replay, jump-to-index, or drag-reorder of unplayed rows on the statutory DirectStream path.

SoundExchange Reports of Use (37 CFR § 370) commit only through DirectStream: a play lasting **>30s** writes a row to Postgres `user_play_logs` with unique `playSessionId` (`useDirectStreamPlayer.ts` + `src/lib/rou/performance-commit.ts`). Skipped and sub-30s plays write **zero** log rows. Quarantined companion SDK events MUST NOT write this table.

### Single transport priority

Prove **`DirectStreamProvider`** (HTML5 `<audio>` + mix-bus `musicGain()` + single `captureMediaElement` tap) — session keep-alive, track-end handoff, audio unlock, reconnect after background, and graph survival across stalls — before expanding to any other live transport. Do not split engineering attention across quarantined Spotify, Apple MusicKit, or YouTube adapters. Do not start new companion-provider work during Phase 5F.

### Surgical testing & fix rule

Perform **read-only investigations first**; zero feature creep during testing phases. Identify the exact file, line, and root cause before touching code. Then make the smallest change that restores the baseline. No new features, no opportunistic refactors, no Phase 6+ surface, no "while we're in here" cleanups.

If the change is not required to lock DirectStream reliability, mix-bus ducking, statutory queue / skip / obfuscation rules, ROU telemetry, or screen-off resilience, it does not ship in this window.

---

## The 5-Step Iterative Development Cycle

Use this cycle for every code execution. Do not skip steps. Do not write production code in the same chat that performed a large investigation.

### Step 1: Read-Only Investigation & Audit

- Prompt the AI / Cursor to perform a **READ-ONLY investigation** first.
- **Rule:** DO NOT modify, edit, or create any code files in Step 1.
- Analyze the live codebase, trace dependencies, and identify exact files, line numbers, and root causes.
- Diagnose DirectStream graph integrity, mix-bus ducking, statutory queue / skip / obfuscation, ROU `user_play_logs` commits, or screen-off failures before any edit.
- Output a diagnostic report and a proposed Step 2 plan for developer review.

### Step 2: Human & AI Alignment Review

- Review the diagnostic report together.
- Confirm the technical approach, data structures, edge cases, and the exact files that may be touched.
- Agree on the root cause and proposed fix strategy **before touching the codebase**.
- If alignment is not reached, return to Step 1. Do not open an execution chat on an unconfirmed plan.

### Step 3: Surgical Refactor & Code Execution (STRICT CONTEXT ISOLATION)

**MUST open a NEW CHAT in Cursor** with a clean context window whenever executing code changes. Do not continue a long audit, brainstorm, or debugging thread into an implementation pass. Stale SDK context, context-window bloat, and syntax hallucinations are the failure mode this rule prevents.

- Attach **only** the relevant canonical docs and the target source files:
  - `docs/ARCHITECTURE.md`
  - `docs/ROADMAP.md`
  - `docs/AUDIO_ORCHESTRATION_SPEC_2.md`
  - `docs/WORKFLOW.md`
  - The specific modules named in the Step 2 plan
- Do **not** attach quarantined Spotify / YouTube / MusicKit sources unless the confirmed plan is a legacy-adapter fix inside `src/lib/audio/legacy/`.
- **Directive-only prompting:** Provide architectural requirements, target files/lines, and behavioral guidelines. Do not feed pre-written hardcoded snippets. Allow Cursor to inspect the live codebase and generate native code to avoid "AI telephone" syntax or type mismatches.
- Execute the refactor precision-first. The change set must be the minimum required to restore the DirectStream / Pocket Mode / statutory baseline — no feature creep.
- Ensure `tsc --noEmit` passes with **0 errors**.

### Step 4: Canonical Documentation Sync

Immediately update markdown blueprints alongside every code refactor so technical documentation stays synced with reality. At minimum, keep these files current when the corresponding surface changes:

| Doc | Sync when |
|-----|-----------|
| `docs/ARCHITECTURE.md` | Entry points, data flow, schema, transport, or module layout change |
| `docs/AUDIO_ORCHESTRATION_SPEC_2.md` | Mix-bus, FSM, prefetch, ducking, launch hold, VoiceNode isolation, TRACE 4 single-emitter logging, strict catalog equality, statutory queue, or ROU contracts change |
| `docs/ROADMAP.md` | Milestone status, Phase 5 step completion, or sequencing change |
| `docs/WORKFLOW.md` | Cadence, verification gates, or collaboration rules change |

Never allow code logic and project documentation to diverge. A merge that ships behavior without updating the matching canonical doc is incomplete.

### Step 5: Verification & Git Lock-In

Run the required test passes (see [Verification & Testing Standards](#verification--testing-standards)) before treating the change as done:

1. `node scripts/smoke-test.mjs` (local or deployed origin).
2. `node scripts/check-env.mjs` / `npm run check-env`.
3. `tsc --noEmit` — 0 errors.
4. Confirm Postgres `user_play_logs` inserts for **>30s** DirectStream performance commits (and **zero** rows for skipped / sub-30s plays). Monthly files: `npx tsx scripts/export-rou.ts --month YYYY-MM`.
5. Pocket Mode / ducking / statutory queue / catalog-equality / TRACE 4 single-emitter checks that apply to the change.

Lock in commits with clear **structural** messages that state *why* the change exists (DirectStream graph, statutory cap, ROU gate, mix-bus ramp, screen-off keep-alive) rather than a file list. Do not push unless the developer explicitly requests it.

---

## Verification & Testing Standards

These passes are required before merging code that touches the live audio bus, queue engine, or ROU logger. A green YouTube iframe console or a Spotify SDK `ready` event is **not** a merge gate.

### Audio Node Integrity

Verify `DirectStreamProvider` (native HTML5 `<audio>`, mix-bus `musicGain()` on the element, single `captureMediaElement` analyser tap) handles:

- Network disconnects and reconnects without tearing down the Web Audio graph.
- Stream stalls / `stalled` / `waiting` without dropping `musicGain` / `speechGain` / master nodes.
- Audio unlock (`unlock()` + `AudioContext.resume()`) without remounting a second graph or losing the first-song invariant (pause until unlock → arm `launchHoldActive` → play from position 0 under `hard_pause` / `intro_ramp` → emit on-playing once per track load). Unlock during `hard_pause` MUST NOT leak `playElement` frames.
- Prefetch isolation: `VoiceNode.preload()` MUST NOT attach to the live session `AudioContext` or `MediaElementAudioSourceNode`; prefetch completion is not on-air.
- TRACE 4 single-emitter: console shows `[SongHost TRACE 4] Prefetch buffer ready` **only** from `VoiceNode.preload()` and `[SongHost TRACE 4] DJ Voice on-air` **only** from `VoiceNode.play()`. Duplicate lookahead TRACE 4 lines from `AudioPlayer.tsx` / `prefetchEngine.ts` / `dj-intro.ts` (including legacy `DJ Voice buffer ready`) MUST NOT appear. An abort before playback MUST skip both `DJ Voice on-air` and `.play() starting`.
- Background / lock-screen / PWA suspend without silent death or a zombie element that cannot be ducked.

A dropped graph that requires a full page reload to restore ducking is a ship-blocker.

### Ducking Verification

Confirm `src/lib/audio/mix-bus.ts` gain nodes apply **linear** ramps smoothly during DJ speech without clipping master output:

- Duck-in: music → **18%** over **300 ms**.
- Track 1 opener: `hard_pause` stays silent at `0:00` until the liner; `intro_ramp` starts pre-set at **18%** from `0:00` (no unducked leak during unlock). `handleNewTrack` arms the hold synchronously before any `await`.
- Hold: music stays at the 0.18 floor for the duration of speech; voice uses `voiceGain()` with **1.35×** headroom.
- Restore: music → **100%** over **1500 ms** after speech ends.
- Voice is never sidechained. Music never jumps (step-gain) between floor and full.
- Master output must not clip when voice headroom and ducked music occupy the bus together.

### ROU Telemetry Verification

Confirm SoundExchange Reports of Use logging on the DirectStream path only:

| Condition | Expected `user_play_logs` result |
|-----------|----------------------------------|
| DirectStream play lasting **>30s** | Exactly one row (`userId` nullable, `isrc` when known, `trackTitle`, `artistName`, `playedAt`, unique `playSessionId`) via `POST /api/play-logs`. Gate: `useDirectStreamPlayer` `onTimeUpdate` + `shouldCommitPerformance`. |
| Skip or abort **before 30s** | **Zero** log rows |
| Sub-30s natural end (clip shorter than the gate, or listener stop) | **Zero** log rows |
| Pause / resume after the 30s gate (same `playSessionId`) | Still exactly **one** row (`committedSessionIdRef` + unique index `onConflictDoNothing`) |
| Preview-only / quarantined Spotify / Apple / YouTube SDK events | **MUST NOT** write this table |

ISRCs are resolved from MusicBrainz **before** insert (`POST /api/play-logs`). Do not invent an ISRC. Prefer resolving ISRC first; a genuinely missing catalog ISRC may be null, but title/artist/`playedAt` must still be known when the 30s gate has passed.

### Statutory queue & skip gates

When the change touches `useStationQueue`, `src/lib/queue/statutory-rules.ts`, `src/lib/queue/skip-limiter.ts`, or `QueueModal.tsx`:

- Artist/album caps reject ineligible candidates rather than mutating a live `StationTrack` in place.
- The **60-minute sliding** 6-skip limiter no-ops when exhausted.
- Forward titles remain obfuscated ("Up Next: Smart Station Stream" / "Later in the Stream").
- Recalling a Station Blueprint or memory dial (`StationConfig` + seeds) generates a **fresh** compliant stream — it must not restore a listener-ordered on-demand playlist.

### Catalog equality & DirectStream identity gates

When the change touches `src/lib/itunes.ts`, `DirectStreamProvider.load()`, `SmartSearchBar.runStationLaunch`, `/api/search`, or `/api/song-radio`:

- `itunesTitlesMatch` / `itunesArtistsMatch` keep version parentheticals (`(Reimagined)` required) and strip only feature tags; case/whitespace are normalized.
- `lookupITunesTrack` returns `null` when no row matches **both** title and artist — never title-only `includes` or rank-0 `songs[0]`.
- Seed launches bind a preview URL only after equality (`itunesTrackMatchesQuery` / `catalogPreviewUrl` / `attachSeedCatalog` / `gateTrackSeeds`). Rank-0 is never a seed.
- `DirectStreamProvider.load()` rejects stamp mismatches (`streamMatchesQueueMetadata`) and iTunes/mzstatic URL-only provider IDs that lack title/artist identity (`metadata_mismatch`; no `.src`).

### Scripted checks

| Check | Command |
|-------|---------|
| API / catalog smoke | `node scripts/smoke-test.mjs http://localhost:3000` |
| Phase 5 env | `npm run check-env` / `node scripts/check-env.mjs` |
| Typecheck | `tsc --noEmit` |
| Unit (when the touched surface has tests) | Vitest for the matching module |

---

## Standardized Audit & Fix Templates

### Template 1: Step 1 Read-Only Audit Prompt

```text
# Step 1 Read-Only Audit: [INSERT SHORT ISSUE TITLE]

Perform a strict **Step 1 Read-Only Audit** to diagnose [INSERT BRIEFLY WHAT IS FAILING OR BEHAVING UNEXPECTEDLY].

---

### SOP Rules
- **STRICTLY READ-ONLY**: DO NOT modify, edit, or create any code files.
- Trace exact file paths, line numbers, state flags, and transition handlers.
- Treat DirectStream + mix-bus as the live bus. Quarantined Spotify / YouTube / MusicKit adapters are reference only unless the issue is inside `src/lib/audio/legacy/`.
- Verify statutory invariants (3-hour artist/album admission, 60-minute 6-skip window, queue obfuscation, >30s ROU `playSessionId` commits) when the symptom touches queue, skip, or telemetry.

---

### Audit Targets

#### Target 1: [INSERT COMPONENT / STATE SYMPTOM 1]
- **Files**: `[path/to/file1.ts]`, `[path/to/file2.ts]`
- **Trace**:
  1. Inspect [Specific function or state flow].
  2. Why does [Unexpected Behavior A] happen during [Event / Condition]?
  3. Identify which state flag or handler incorrectly triggers or holds this logic.

#### Target 2: [INSERT COMPONENT / STATE SYMPTOM 2]
- **Files**: `[path/to/file.ts]`
- **Trace**:
  1. Inspect why state remains locked or out of sync during [Transition / Event].
  2. Trace DirectStream / mix-bus / queue / ROU interactions causing stalls, empty results, or dropped nodes.
  3. Locate where state locks should be cleared or overridden by primary session state.

---

### Required Diagnostic Output
1. **Exact File Paths & Line Numbers** handling state transitions, locks, and data synchronization.
2. **Root Cause Analysis** detailing why the desync, failure, or unwanted behavior occurs.
3. **Proposed Step 2 Alignment Plan** outlining the exact logic updates required before any code is touched.
```

### Template 2: Step 2 Human & AI Alignment Prompt

```text
# Step 2 Alignment Review: [INSERT SHORT ISSUE TITLE]

Review the Step 1 diagnostic before any code is written.

---

### Confirmed understanding
- **Root cause**: [PASTE / SUMMARIZE STEP 1 DIAGNOSIS]
- **Approach**: [DATA STRUCTURES, EDGE CASES, AND FILES IN SCOPE]
- **Out of scope**: [PHASE 6+, QUARANTINED SDK WORK, UNRELATED REFACTORS]

---

### Alignment checklist
1. DirectStream graph / mix-bus / statutory queue / ROU impact is named explicitly.
2. Pocket Mode (screen-off, lock-screen, PWA) is considered if audio can stall or duck.
3. Canonical docs that must be synced in Step 4 are listed.
4. Execution will happen in a **new Cursor chat** (Step 3) with only the named docs and source files attached.

Do not open the Step 3 execution chat until this plan is confirmed.
```

### Template 3: Step 3 Surgical Fix Execution Prompt

```text
# Step 3 Surgical Fix Execution: [INSERT SHORT ISSUE TITLE]

Execute a strict **Step 3 Surgical Fix** in this **new, clean context window**, based on the confirmed Step 2 alignment.

Canonical docs attached: ARCHITECTURE.md, ROADMAP.md, AUDIO_ORCHESTRATION_SPEC_2.md, WORKFLOW.md, plus the target source files listed below. Do not pull quarantined Spotify / YouTube / MusicKit code unless it is in the approved file list.

---

### SOP Rules
- **SURGICAL EXECUTION**: Modify ONLY the exact files, functions, and line ranges specified in the execution plan below.
- **NO UNRELATED REFACTORS**: Do not touch adjacent code, clean up unrelated styling, or modify unapproved hooks.
- **DIRECTIVE-ONLY**: Follow the behavioral contract; inspect the live files; do not paste unverified snippets from a prior chat.
- **STATE PRIORITY CONTRACT**: Cloud State is the source of truth — local storage is an offline cache. DirectStream is the live music bus.

---

### Confirmed Root Cause Context
- **Root Cause**: [PASTE / SUMMARIZE STEP 1 DIAGNOSIS]
- **Affected Files**: [LIST APPROVED FILES TO EDIT]

---

### Execution Plan

#### Task 1: [INSERT COMPONENT / FIX AREA 1]
- **File**: `[path/to/file.ts]`
- **Target Location**: `[Function Name / Line Range]`
- **Modification**: [Describe exact logic update, guard clause to add, or state lock release].

#### Task 2: [INSERT COMPONENT / FIX AREA 2]
- **File**: `[path/to/file.ts]`
- **Target Location**: `[Function Name / Line Range]`
- **Modification**: [Describe exact logic update, query sanitization, or state reset].

---

### Verification & Output Requirements
1. **Apply Minimal Diff Modifications**: Implement code changes directly.
2. **State Safeguard Verification**: Confirm that all new or updated handlers explicitly clear pending timers, speech buffers, or race-condition flags on state switches.
3. **Validation Steps**: List exact checks from WORKFLOW.md (DirectStream graph, mix-bus ramps, `user_play_logs` >30s / zero-row skip, `scripts/smoke-test.mjs`, `scripts/check-env.mjs`) that prove the fix without regressions.
4. **Step 4**: Name which canonical docs must be updated in the same change set.
```

---

*Reference this cadence anytime a chat session loses context, attempts to write code without prior investigation, or treats a quarantined companion SDK as the production bus.*
