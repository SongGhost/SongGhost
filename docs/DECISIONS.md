# SongHost — Decision Log

A running history of decisions made during doc/code review and engineering work. Newest entries at the top. Each entry is dated and references the evidence behind it. This log records *decisions and their rationale*; it is not a changelog of every edit.

---

## D4 — Aug 24 2026: YouTube dock viewer is a test harness, not a product surface

**Decision:** Add a surgical, default-off **YT View** toggle (header, left of FREE MODE) that restyles the existing YouTube IFrame into the bottom dock at 320×200 and calls `player.setSize`. The iframe MUST NOT remount. This exists only to run the visible vs hidden ads test on Premium and non-Premium accounts.

**Not decided:** Whether YouTube stays a shipping provider, whether the player stays visible in production, or how to handle ads/DJ collision. Those wait on Larry's live test + console `[YouTubeViewer]` lines.

**Code:** `src/lib/youtube/viewer-toggle.ts`, `src/lib/youtube/embed-size.ts`, `DevTierBadge` in `src/components/header/Header.tsx`, host class swap in `AudioPlayer.tsx`, `YouTubeTrackProvider.setViewerLayout` / `setSize` in `TrackProvider.ts`. Storage key `songhost_youtube_viewer`.

**Protocol:** `docs/MUSIC_PROVIDER_ANALYSIS_YOUTUBE.md` §10.

---

## D3 — Aug 22 2026: Discrepancy #1 truth established; four docs corrected

**Decision:** Adopt the read-only Grok audit (Aug 22 2026) as the verified ground truth for the audio transport, and correct every doc that contradicted it.

**Truth established (verified against code):**
- The **live dial transport is the YouTube IFrame** (`useYouTubePlayer` → `YouTubeTrackProvider`).
- Preset seeds (`station-seeds.ts`), Artist Radio, Album Radio, AI Curator, and `/api/station-tracks` stamp `youtubeId` in production.
- `resolveDirectStreamUrl` refuses any row that already has a `youtubeId`, so `AudioPlayer` selects `YouTubeTrackProvider` for those rows.
- `DirectStreamProvider` is the **target** statutory bus. It attaches only on rows with HTTP `streamUrl`/`previewUrl` and no `youtubeId` — today only the search-launched station path with "Full Songs (Dev)" off (30s iTunes previews).
- The "Full Songs (Dev)" toggle does **not** gate the dial — it only gates `/api/song-radio` and `/api/recommendations` YouTube lookups (env-gated: `NODE_ENV=development` or `NEXT_PUBLIC_ENABLE_DEV_TOGGLE=true`).
- Pocket mode is **already broken** on the dial (cross-origin iframe; Web Audio can't tap; iOS/Android pause on lock).
- Spotify and Apple MusicKit are quarantined under `src/lib/audio/legacy/`; YouTube is **not** quarantined — it is the current dial.

**Docs corrected:**
- `docs/ARCHITECTURE.md` — 7 edits (opening, §1 overview, tech-stack table, §2.1, §3, YouTube invariant label, invariant 21).
- `docs/AUDIO_ORCHESTRATION_SPEC_2.md` — 3 edits (header, quarantine rule, invariant 21).
- `docs/ROADMAP.md` — 3 edits (Phase 5 status, quarantine line, Step 5A checkbox corrected from `[x]` to `[~]`).
- `docs/WORKFLOW.md` — 4 edits (active milestone, single-transport priority, SOP audit rule, state priority contract).

**Not touched (already accurate):** the Song Radio rows in `ARCHITECTURE.md` (498, 625, 637) and `WORKFLOW.md` lines 8–12.

**Rationale:** Docs were asserting DirectStream as the live bus, which is false today. Keeping docs as the source of truth requires they describe current reality, not the target. The target is preserved in every edit as the explicit goal.

---

## D2 — Aug 22 2026: Cursor rule `agent-discipline.mdc` created

**Decision:** Add a workspace rule codifying two disciplines: (1) verify claims against code before stating them as fact; (2) make no unagreed edits to project docs — propose the exact change and get approval first.

**File:** `.cursor/rules/agent-discipline.mdc`

**Rationale:** Doc drift happened because earlier assertions about the transport were not checked against the code. The rule makes verification and change-control the default for future sessions.

---

## D1 — Aug 22 2026: "Song Radio" spoken-brand leak fixed; Artist Radio / Artist Mix parked

**Decision:** Route the stinger spoken path through `resolveSpokenStationBrand` so a station whose spoken brand differs from its display name is announced correctly. Artist Radio and Artist Mix still leak the raw display name and are **not** fixed in this pass.

**Rationale:** The stinger path was the highest-traffic leak. Artist Radio / Artist Mix need their own brand-resolution handling and were parked to avoid a rushed, inconsistent fix; they are flagged for the search-redesign cleanup note.

**Status:** Stinger path fixed. Artist Radio / Artist Mix — open.
