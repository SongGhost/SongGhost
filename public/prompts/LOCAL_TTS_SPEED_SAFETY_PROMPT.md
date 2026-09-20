# Step 3 — Speed up local TTS + never talk over music

## Goal
Larry’s Chatterbox on RTX 3070 Ti can take 30s–3+ minutes for Director’s Cut. Clients abort (WinError 10053); song starts; late audio must NEVER play over YouTube. Make local Custom voices usable: faster synth + safe timeouts + earlier prefetch.

## Hard rules
- Live YouTube stays gap-then-100%. No duck-over-YouTube.
- Never play a DJ clip after music has started for that break.
- If local TTS exceeds budget → skip break, song at 100%.
- Do not crush OpenAI Director’s Cut back to one trivia line; local may use a tighter word budget than OpenAI.
- Brand: SongHost / SonGhost only (never SongGhost gG, never spaced Song Ghost).
- Surgical. Update ARCHITECTURE + AUDIO_ORCHESTRATION docs. tsc clean. Commit + push to Vercel deploy branch when done (Larry wants live URL updated). No force-push.
- Save prompt under public/prompts/ if convention.

## Implement
### A) App safety (must)
1. Find launch-hold / break flow in AudioPlayer + dj-intro + VoiceNode.
2. If synth/play isn’t ready before music release → cancel in-flight voice; do not call play() late.
3. Abort HTTP to local TTS on timeout so sidecar isn’t left writing to a dead socket as the only failure mode.

### B) Faster path for local provider (must)
1. Prefetch: for provider local, start Director’s Cut / extended lore synthesis earlier (increase lead seconds substantially vs OpenAI if needed).
2. Local-only lore word/char budget: still clearly > Standard, but small enough that 3070 Ti finishes in ~5–15s warm (tune; document chosen caps).
3. Don’t enqueue overlapping heavy local synths for Every Song; if GPU busy, skip or wait with a hard deadline — prefer skip over overlap.
4. Optional: cache identical short station-ID / identity lines.

### C) Sidecar (tools/local-tts-sidecar) (should)
1. Keep model loaded (already); avoid reload per request.
2. Expose/use fewer inference steps or a “fast” mode for previews vs breaks if Chatterbox supports it — document tradeoff.
3. Log synth duration_ms per request.
4. Bound max input characters; reject or truncate oversized text instead of running 1000-step multi-minute jobs.
5. Fix or document reference mel/token length warning; recommend 6–12s clean ref WAVs.

## Verify
- Local + Director’s Cut: break either plays fully in the gap OR is skipped; never over music.
- Synth time for typical local lore drops into a sane range when warm (report numbers).
- OpenAI path still long-form Director’s Cut if that was already shipped.
- Plain-language summary for Larry: what got faster, how to test, commit/push/Vercel.

## Do not touch
Custom WAV identity files contents (Harris/Piper/Quinn/Bea) unless trimming refs is required; YouTube ducking; Jev; start.ps1 unless a one-line fix is free.
