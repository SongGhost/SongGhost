# Docs Sync — Verify & Update Canonical Docs Against Live Code

You are Grok, the coder/engineer. GLM 5.2 has shipped the code. Your job is to bring the canonical docs back in sync with the live codebase. This is a documentation-only task.

## Hard rules
- DO NOT touch any code files (nothing under src/, scripts/, public/, package.json). Only edit files under docs/.
- Verify before you write. For every doc claim you add or change, read the live code and cite file:line evidence in your final report. Do not invent facts. If you cannot verify something, flag it as unverified.
- Surgical edits only. Match the existing voice, formatting, and abbreviation style of each doc. Do not restructure sections or rewrite whole files. Change only what is stale or missing.
- DO NOT commit. DO NOT push. DO NOT run git add. Leave all edits in the working tree for GLM 5.2 to review.
- DO NOT run next build. tsc is not required for a docs-only task.

## Scope — recent code changes that need reflecting

Two commits shipped after the docs were last synced. Verify each against the live code, then update the docs.

### Change A — Drive Mode containing-block fix (commit fe996c4)
Files: src/components/ControlDeck.tsx, src/components/studio/DriveModeOverlay.tsx, src/components/AudioPlayer.tsx.

Root cause that was fixed: the bottom dock's backdrop-blur-xl creates a CSS containing block for position:fixed descendants. DriveModeOverlay (fixed inset-0 z-[200]) and the promoted YouTube iframe (fixed z-[210]) are descendants of the dock, so they were trapped relative to the thin dock bar instead of the viewport — the dashboard showed through and the video floated wrong.

Current behavior (verify in code):
- ControlDeck.tsx dock wrapper: while Drive Mode is on, the dock drops backdrop-blur-xl and the translucent bg/border, becoming a solid opaque bar at z-[210]. Normal mode is unchanged (z-50 + backdrop-blur-xl). The dock z DOES change in Drive Mode now (z-50 to z-[210]).
- DriveModeOverlay.tsx: the big Prev/Play/Next transport controls were removed. The dock is now the single set of controls at the bottom. The overlay owns the full-screen background + title/artist (upper) + a video slot spacer. The transport props (isPlaying, onPlayPause, onPrev, onNext, disablePrev, disableNext) were removed from the DriveModeOverlayProps interface and the call site.
- AudioPlayer.tsx iframe (containerRef): repositioned to bottom-[calc(8rem+env(safe-area-inset-bottom))] (mobile) / sm:bottom-[calc(8.5rem+env(safe-area-inset-bottom))], centered, z-[210], 196x110 / 248x140 — it sits just above the dock, NOT top-center. The iframe is NOT re-parented or remounted.

This supersedes the T36 approach described in the docs (which said: dock z does not change, iframe is top-center, overlay has transport controls). Keep T36 as history but mark it superseded by this later fix. The architecture description must describe the CURRENT (fe996c4) approach.

### Change B — Skip-break timing + stall watchdog (commit 8d3b4b8)
Files: src/components/AudioPlayer.tsx, src/lib/audio/legacy/useYouTubePlayer.ts.

Three playback intercepts (verify each in code):
1. Stall watchdog — Vevo/geo-blocked YouTube embeds can sit on a black frame without ever firing YT onError. An 8s watchdog arms on videoId change (YouTube path only: videoId truthy and not suppressLocalAudio/isPreviewMode/isDirectStreamMode). First onPlaying clears it; skip / unmount / real onError also clear it. If it fires, it logs and calls handlePlaybackError() (records the failed ID, falls back to preview or removes the track). It arms on load, not on pause/reseek, so a later Mode B lore/hard_pause pause cannot false-trigger.
2. Suppress DJ break after a manual skip — skipNext sets justSkippedRef = true. In handleNewTrack, the next track still runs planDjSegment and still commits djSchedulerRef.current = nextState (cadence still advances), but if the plan was voiced it is forced to transition = silent / plan = null for that one track. Already-silent plans are left alone. Suppressed only when !isSessionOpening — Track 1 of a session still always gets its full_break song_intro (opener invariant preserved).
3. Back-to-back restore-ramp guard — onLoreComplete and onBreakExit stamp restoreRampEndsAtRef = Date.now() + RESTORE_RAMP_MS + 200. If the next track loads while that restore is still in flight (Date.now() < restoreRampEndsAtRef.current), its voiced break is forced silent the same way as (2). Duck/restore constants are unchanged (RESTORE_RAMP_MS still 1500; +200ms margin only).
4. YouTube error code passthrough — useYouTubePlayer onError type changed from () => void to (code?: number) => void and now forwards numeric YT error codes (150/101/etc.) instead of swallowing them. handlePlaybackError still takes no args; the code is available for future tuning.

## Docs to check and update

For each doc, first READ the live code to confirm the current behavior, then make the minimum surgical edit. Cite file:line in your report.

### 1. docs/TUNING_BACKLOG.md
- T36 entry: mark it superseded by a new T38 (the containing-block fix). Keep T36 as history; add a one-line pointer to T38.
- Add T38 — Drive Mode containing-block root-cause fix (Change A). Describe the root cause (backdrop-blur-xl containing block), the fix (conditional blur + solid z-[210] dock, overlay drops transport controls, iframe repositioned above dock), and that it supersedes T36. Note it is a layout fix, not a full YouTube TOS claim (consistent with T22/T36 wording).
- Add T39 — Skip-break timing + stall watchdog (Change B). Describe the three intercepts + YT error code passthrough. Note the opener invariant is preserved (Track 1 still gets song_intro).
- Update the Last updated date and the Next up / Still-open tuning items lines only if they now reference something stale. Do not invent new next-up items.

### 2. docs/ARCHITECTURE.md
- The Cockpit layout block (the ControlDeck dock and DriveModeOverlay lines, around lines 124-144) describes the OLD T36 approach. Rewrite those lines to describe the CURRENT approach: dock z is conditional (z-50 to z-[210] in Drive Mode) AND backdrop-blur-xl is dropped in Drive Mode (solid opaque bar) so it stops trapping the fixed overlay/iframe; DriveModeOverlay has no transport controls (dock is the single controls); the iframe is bottom-anchored above the dock (8rem / sm:8.5rem + safe area), not top-center. Keep the same indented diagram style.
- Verify the StationPreviewModal / QueueModal / Inspired entries are still accurate (T35/T30). Do not change them unless stale.
- If ARCHITECTURE has an AudioPlayer-behavior section that mentions skip/handleNewTrack, add a one-line pointer to the new intercepts; otherwise leave audio behavior to the AUDIO_SPEC.

### 3. docs/AUDIO_ORCHESTRATION_SPEC_2.md
- The Covers/Supersedes header (around lines 7-9) stops at T31. Extend it to cover T34 refinement, T35, T36, T37, T38, T39 (bump the version note in the same style as prior entries).
- In the handleNewTrack / skipNext / restore-ramp sections (around lines 227-264 and 198/240): add the new intercepts — justSkippedRef (suppress voiced break on the track after a manual skip), restoreRampEndsAtRef (back-to-back guard), and the 8s stall watchdog. State clearly: cadence still advances; opener invariant preserved (!isSessionOpening); constants unchanged.
- Note the YT onError code passthrough in the YouTube-provider section if one exists; otherwise add a short line where the YouTube provider is described.

### 4. docs/DECISIONS.md
- Read the existing format. DRAFT (do not finalize) a new decision entry for the Drive Mode containing-block fix (Change A) and one for the audio intercepts (Change B), following the existing entry style. Mark each as DRAFT — pending GLM 5.2 finalization so Larry knows it is not yet final. Match the existing entries' level of detail.

### 5. docs/ROADMAP.md
- Read it. If the active-milestone / tuning-round status is stale relative to the work that has actually shipped (T30/T31/T34/T35/T36/T37/T38/T39), make the minimum status update. If it is already accurate, do not edit. Do not invent new milestones.

### 6. docs/WORKFLOW.md
- Read it. This is the process doc and is unlikely to need changes. Only edit if a process change actually shipped (none is expected). If no change is needed, leave it untouched and say so in your report.

## Output / report
When done, return a concise report with:
1. Verification summary — for each of Change A and Change B, the file:line evidence confirming the current behavior.
2. Doc edits — a per-file list of what you changed and why (with the doc line ranges you edited).
3. Anything you could not verify (flagged as unverified).
4. Confirm you did NOT commit, push, or touch any code files.
