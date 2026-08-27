# Tier 2 Curation — Handoff (Aug 27 2026)

**Purpose:** Capture the exact state of the Tier 2 deep-pool curation workstream so a fresh chat can resume without re-investigating. This is operational state, not a canonical spec.

---

## Session constraint (important)
The Aug 27 chat session's **agent shell was unavailable** — a Windows sandbox-backend limitation on the agent side (error: "no working sandbox backend is available … not a permission denial"). The user's own terminal worked fine (they pushed commits). Effect: the agent could not run `git` or `node scripts/…` from that session. File edits (Read/Write/StrReplace) and Grok Task subagents worked normally. **First thing in the new chat: verify the agent shell can spawn** (run `git status`). If it works, the agent can run the resolver script and commit directly.

---

## What already shipped (committed by Larry)
- **Tier 1 code** (`feat(ui): station preview modal header + always-on default station art`) — `src/app/page.tsx`, `src/components/StationPreviewModal.tsx`, `src/components/cards/StationCard.tsx`. Modal header shows station name + card thumbnail; image fallback is the accent gradient (no gray Disc3 placeholder).
- **Docs sync** (`docs: sync T40/T41 + orchestrator-coder workflow mode`) — `docs/WORKFLOW.md` (new Orchestrator + Coder Subagent Mode section), `docs/TUNING_BACKLOG.md` (T40, T41, T35 pointer), `docs/ARCHITECTURE.md` (StationPreviewModal block + card-art fallback note), `docs/DECISIONS.md` (D23, D24).
- **Verify before resuming:** confirm both commits are on `main` (`git log --oneline -5`). If the docs commit was NOT pushed, the doc edits are still in the working tree — commit them first (command is in the chat history / `public/prompts/` is not where it lives; the commit message is in the Aug 27 chat).

---

## The Tier 2 problem (root cause, verified)
- 13 "main" stations have deep seed pools (~40–50 tracks) in `src/data/station-seeds.ts`, generated from `scripts/station-seed-sources.mjs`.
- **43 "extra-genre" stations** in `src/data/extra-genres.ts` have only **3 inline seeds** and **no deep pool** → `seedTracksFor` returns the 3-track fallback (`src/data/station-seeds.ts:679`). This is why previews show 3 tracks and why card art 404s (some of those 3 YouTube IDs are invalid/reused, e.g. `90s-rave-edm` reuses `y6120QOlsfU`).
- Live playback still works (replenishes from the catalog) — only the preview and card art look thin.

## The pipeline (verified, do not re-investigate)
- `scripts/station-seed-sources.mjs` → `STATION_SEED_SOURCES: Record<string, [artist, title][]>`. Hand-curated staples. Build-time input only.
- `scripts/resolve-station-seeds.mjs` → resolves each `[artist, title]` to a **verified, embeddable YouTube ID** (YouTube search → oembed embed check → duration 90–600s → artist+title match). Caches in `scripts/.seed-cache.json`, accumulates in `scripts/.seed-resolved.json`, regenerates the **entire** `src/data/station-seeds.ts` from the accumulated set (partial runs don't wipe other stations). No API key needed (uses public YouTube endpoints). Usage: `node scripts/resolve-station-seeds.mjs` (all) or `node scripts/resolve-station-seeds.mjs classical-masters movie-soundtracks …` (specific ids) or `--refresh`.
- Card art fixes itself once IDs are valid: `stationArtworkUrl` picks a YouTube thumbnail from the seeds — valid IDs → no 404 → no gray placeholder.

## The workstream (batched 5–8 stations at a time, Larry reviews song selection for taste)
For each batch: (1) Grok authors the `[artist, title]` list (~45 songs → 30–40 survive) appended to `scripts/station-seed-sources.mjs`; (2) Larry reviews the song selection; (3) run the resolver for those ids; (4) review `station-seeds.ts` survivor counts (≥30 = ok, <30 = THIN — add more sources); (5) commit `station-seed-sources.mjs` + `station-seeds.ts` + `.seed-resolved.json`.

### Batch status
- **Batch 1 (6 stations): SONG LISTS AUTHORED, awaiting Larry's taste review + ID resolution.** Grok completed and appended curated lists to `scripts/station-seed-sources.mjs` (verified: `classical-masters`@728, `movie-soundtracks`@779, `90s-rave-edm`@830, `synthwave-retro`@881, `hard-bop-jazz`@930, `shoegaze-dream`@980). Counts: classical-masters 48, movie-soundtracks 48, 90s-rave-edm 48, synthwave-retro 46, hard-bop-jazz 47, shoegaze-dream 47. **This work is uncommitted in the working tree** — commit it before/after the Cursor restart so the new chat sees it. The full lists + Grok's spelling/taste flags are in the Aug 27 chat subagent report (transcript `4dc02d79-e1a1-460f-96f7-7ffcc7ab7fee`). Larry's taste review is the next gate before ID resolution. The reusable prompt remains at `public/prompts/TIER2_CURATION_BATCH1_PROMPT.md` (do NOT re-run it — lists are already written).
- **Batches 2–7 (37 stations): NOT STARTED.** Prompts not yet written.

### The 43 stations (batch 1 = first 6)
Batch 1: classical-masters, movie-soundtracks, 90s-rave-edm, synthwave-retro, hard-bop-jazz, shoegaze-dream.
Remaining 37 (batches 2–7, ~6 each): bluegrass-roots, reggae-dub, k-pop-wave, afrobeat-groove, dark-ambient, post-rock-cinematic, heavy-metal, blues-highway, folk-acoustic, soul-rnb, punk-rock-rebellion, emo-screamo, trip-hop-lounge, drum-and-bass, house-music, techno-underground, ambient-meditation, world-music, latin-pop, bossa-nova, gospel-spirit, funk-groove, psychedelic-rock, progressive-rock, indie-pop, britpop-invasion, ska-punk, industrial-dark, new-age-zen, chiptune-8bit, motown-soul, disco-fever, garage-rock, noise-rock, dream-pop-ethereal, vaporwave-aesthetic, celtic-folk.

Station names/descriptions/personas live in `src/data/extra-genres.ts` — read there when authoring each batch's prompt.

---

## Exact next steps for the new chat
1. **Verify agent shell:** run `git status`. If it spawns, proceed; if not, fall back to giving Larry commands to run. (A fresh Cursor session should restore the shell.)
2. **Confirm the Aug 27 commits are on `main**` (Tier 1 code + docs). Push the docs commit if it's still uncommitted.
3. **Commit batch 1 song lists** (already authored, uncommitted in working tree): `scripts/station-seed-sources.mjs` + the updated `docs/TIER2_CURATION_HANDOFF.md`.
4. **Larry taste review:** present the 6 batch-1 song lists (in the Aug 27 subagent report) to Larry for sign-off. Grok flagged spelling/taste notes per station (e.g. classical uses composer last names; movie-soundtracks dropped the generic "Main Theme"; 90s-rave-edm's Tiësto track is 2005 not 90s; hard-bop's Take Five is cool jazz). Adjust any lists Larry wants changed.
5. **Resolve batch 1 IDs:** `node scripts/resolve-station-seeds.mjs classical-masters movie-soundtracks 90s-rave-edm synthwave-retro hard-bop-jazz shoegaze-dream`. Check survivor counts (≥30 ok, <30 THIN — add more sources and re-run that id).
6. **Commit batch 1 resolved:** `src/data/station-seeds.ts` + `scripts/.seed-resolved.json` (check `.gitignore` for `.seed-cache.json` — do not commit if it's local-only).
7. **Write batch 2 prompt** (next 6 stations) to `public/prompts/TIER2_CURATION_BATCH2_PROMPT.md` using batch 1's prompt as a template. Repeat for batches 3–7.
8. **After all 43 are curated,** update `docs/TUNING_BACKLOG.md` (T41 stopgap → resolved by Tier 2) and `docs/ARCHITECTURE.md` (note the 43 stations now have deep pools).

## Notes for the new chat
- The orchestrator-coder workflow is now documented in `docs/WORKFLOW.md` ("Orchestrator + Coder Subagent Mode"). Follow it: Grok codes, agent reviews + commits + summarizes, Larry approves.
- Grok must NOT run the resolver script (it's the agent's job after Larry approves the song lists). Grok only authors source lists.
- The resolver drops non-embeddable / wrong-duration / mismatched results — that's expected. Author ~45 songs to land ~30–40.
- Some genres (e.g. lofi-chillhop, chiptune-8bit) have short/channel-titled uploads that fail verification — author more named-producer tracks to compensate (see the `lofi-chillhop` comment in `station-seed-sources.mjs`).
