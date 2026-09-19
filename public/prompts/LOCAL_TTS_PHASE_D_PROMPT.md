# Step 3 — Phase D: Live dial uses Host Studio voice pick (OpenAI or local Custom 1–4)

## Role
SongHost coder (Grok). Surgical. Inspect live repo; write native code.

## Approved context
- Phase A–C done: `provider: "local"` + Chatterbox sidecar; Host Studio picks 13 OpenAI voices OR Custom 1–4; prefs saved; live dial still hardcodes OpenAI.
- Un-hardcode live dial so the saved Host Studio selection drives between-song breaks and session opener liners.
- Keep gap-then-100% (no YouTube ducking/talk-over).
- Fail closed if selection is local and sidecar is down — do NOT silently fall back to OpenAI mid-break.
- No Jev. No SoundExchange. No ElevenLabs live picker revival. No Cartesia hijack.
- Larry is non-technical: plain-language summary + how to test.

## Hard rules
- Touch only Allowed files (+ docs).
- `tsc --noEmit` 0 errors for this work; leave unrelated ducking-test debt alone.
- Do NOT commit or push.
- Save prompt under `public/prompts/` if convention.

## Allowed files
- `src/app/page.tsx` — remove `ttsProvider` hardcode to `"openai"`; derive from Host Studio prefs (OpenAI voice id → openai; Custom N / `local:N` → local + voiceSlot)
- `src/components/AudioPlayer.tsx` — `resolveLiveHost` / prefetch context must carry provider + voice/slot from prefs
- `src/lib/dj-intro.ts` — opener + break synthesis must pass provider/voiceSlot through to `/api/generate-voice`
- `src/hooks/useStationQueue.ts` and/or `src/lib/dj/prefetchEngine.ts` — only if needed so lookahead uses the same provider/voice as live
- `src/lib/dj/personaConfig.ts` — resolveActiveHost / live host merge for local slots
- `src/types/user.ts` / voice types — only if prefs shape needs a tiny fix
- `src/app/api/generate-voice/route.ts` — only if voiceSlot forwarding needs a fix; OpenAI path unchanged
- Docs REQUIRED same change set:
  - `docs/ARCHITECTURE.md` — live dial follows Host Studio voice pick; local needs sidecar
  - `docs/AUDIO_ORCHESTRATION_SPEC_2.md` — live TTS provider from prefs; gap-then-100% unchanged
  - `docs/ROADMAP.md` — WS-8 Phase D done

## Explicitly do NOT touch
- Host Studio picker UI (already Phase C) except tiny bugs blocking live read of prefs
- Sidecar / Chatterbox install
- generate-script lore-cache TTS (companion path)
- Ducking / YouTube player / mix-bus core
- Billing / Jev

## Behavior requirements
1. Host Studio selects OpenAI Cedar (or any of 13) → between-song breaks use OpenAI that voice.
2. Host Studio selects Custom 1 → breaks use local voiceSlot 1 (sidecar must be running).
3. Custom selected + sidecar down → break fails closed / clear behavior; no quiet OpenAI substitute.
4. Session opener liner follows the same provider/voice rules.
5. Prefetch warmup must not stamp the wrong provider (avoid OpenAI warmup then local play or the reverse).
6. Free/guest path still works; do not paywall OpenAI voices.

## Verification (document for Larry)
- Helper running + Custom 1 selected → hear laptop voice on a real between-song break (or opener).
- OpenAI voice selected → hear OpenAI on break.
- Helper stopped + Custom selected → fails clearly.
- `tsc --noEmit` clean for this work.

## Deliverable to Larry (plain language)
- What to click before listening
- How to start the helper
- Confirm OpenAI still works as a choice
- Remind SAMPLE clips until he drops final WAVs
- Note start.ps1 workaround if still broken: `.venv\Scripts\python.exe server.py`
