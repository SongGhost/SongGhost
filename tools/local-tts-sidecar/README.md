# Local voice helper (Chatterbox-Turbo)

This is the **laptop GPU voice** for SongHost. It speaks real words on the `"local"` path.

OpenAI is still the live radio host. This helper is only used when something explicitly asks for the `"local"` provider.

It stays on this computer (`127.0.0.1`). It is not opened to the public internet.

## Warnings (read once)

- **First run downloads a large model** (a few gigabytes). Leave the window open.
- **Do not let the laptop sleep** while it is downloading or loading.
- This GPU has about **8 GB**. Chrome and Cursor already use a chunk of that. If load fails, close extra windows and try again.
- If the GPU or the model is missing, the helper **refuses to speak**. It will not secretly use OpenAI, and it will not play the old beep.

## Start it (one command)

From the SongHost folder, paste this and leave the window open:

```
powershell -ExecutionPolicy Bypass -File tools\local-tts-sidecar\start.ps1
```

The first time, that command also installs the GPU libraries. Later times it just starts.

Stop it with Ctrl+C.

When it is ready you will see a line that starts with `[local-tts] Ready`.

## Point SongHost at it

In `.env.local` keep this line (no secret — it is just an address):

```
LOCAL_TTS_URL=http://127.0.0.1:7860
```

Restart the SongHost app after adding that line.

Optional knobs for the helper window only (not required):

```
LOCAL_TTS_PORT=7860
LOCAL_TTS_DEVICE=cuda
LOCAL_TTS_MODEL_DIR=
LOCAL_TTS_VOICES_DIR=
```

`LOCAL_TTS_DEVICE` must stay `cuda`. CPU is not a production path.

Weights download into `tools/local-tts-sidecar/models/chatterbox-turbo/` (not committed). On Windows the helper copies files instead of using shortcuts, so you do not need Developer Mode.

## Prove it is alive

```
curl http://127.0.0.1:7860/health
```

Ready looks like: `"ok": true`, `"model": "chatterbox-turbo"`, `"gpu": true`.

There is no SongHost health page for this. Check the helper directly.

Speak a test line (saves a WAV on your Desktop):

```
curl -X POST http://127.0.0.1:7860/v1/speech -H "Content-Type: application/json" -d "{\"text\":\"Hello from SongHost. This is the local laptop voice.\",\"voiceSlot\":\"1\"}" --output %USERPROFILE%\Desktop\local-tts-test.wav
```

Play that file. You should hear words, not a beep. Sample placeholder clips limit how “finished” it sounds until you drop real references.

## Where to drop the four final voices later

See `voices/README.md`. Short version:

- Slot 1 → `tools/local-tts-sidecar/voices/slot-1/`
- Slot 2 → `tools/local-tts-sidecar/voices/slot-2/`
- Slot 3 → `tools/local-tts-sidecar/voices/slot-3/`
- Slot 4 → `tools/local-tts-sidecar/voices/slot-4/`

Each file: clean `.wav`, **6–12 seconds** (must be longer than 5 seconds), fictional host only — not Larry’s voice. Name it anything that does **not** start with `SAMPLE`.

Longer reference files make the helper slower (it loads the whole WAV, then the model already truncates to about 10–15 seconds). A 6–12s clean read avoids the “reference mel/token length” warning and keeps warm synth in the 5–15 second range.

## Speed notes

- The model stays loaded after `[local-tts] Ready`. It does not reload per request.
- Speaker conditionals are cached per slot after the first clip.
- Chatterbox-Turbo already uses a **1-step** decoder (plus 2 internal CFM steps). There is no extra “fewer inference steps” knob. `mode: "preview"` is accepted and logged; previews are faster because the text is shorter, not because a different decoder runs.
- Each speech request logs `duration_ms`. Watch the helper window.
- Text longer than **520 characters** is rejected (400) so a lecture-length script cannot start a multi-minute job.
- If SongHost hangs up (timeout or the song started), the helper logs `abort reason=client_disconnect` (or `cancel_endpoint`) and discards the WAV instead of treating WinError 10053 as the only failure.
- **Cancel:** `POST /v1/cancel` (JSON `{ "jobId"?: number }`, or empty) marks the current speech job cancelled. Disconnect on `/v1/speech` does the same. CUDA **cannot** be stopped mid-forward; cancel unblocks the HTTP handler and drops the result so it cannot play. The next speech request waits until that GPU forward finishes — it will not wait forever on a dead client write.

Slots 1 and 2 currently have SAMPLE placeholders so the helper can talk before the finals exist.

## Prerecorded welcomes + fallbacks (Pass 2)

Custom hosts (Harris / Piper / Quinn / Bea = slots 1–4) use a disk bank so station start and a missed break can speak without waiting on a live GPU job.

Scripts (checked in): `src/lib/audio/prerecorded/scripts.json`

Rendered WAVs (committed so Vercel can serve `/audio/prerecorded/…`; regenerate on this laptop only — never at Vercel build):

```
public/audio/prerecorded/slot-1/welcome-01.wav   … Harris
public/audio/prerecorded/slot-2/…                 Piper
public/audio/prerecorded/slot-3/…                 Quinn
public/audio/prerecorded/slot-4/…                 Bea
```

With the helper window showing `[local-tts] Ready`, from the SongHost folder:

```
npm run generate-prerecorded
```

Same command: `npx tsx tools/local-tts-sidecar/generate-prerecorded.ts`. Add `--force` to replace existing files. This is sequential (one GPU job at a time) — 16 welcomes + 16 fallbacks × 4 voices. Leave the window open until it prints `Done`, then commit the new WAVs + `manifest.json`.

OpenAI-selected voices skip this bank (live TTS opener stays). A later pass can add a thin OpenAI set if needed.

## If Chatterbox-Turbo cannot install or run

Do **not** install a second production model beside Turbo. The documented fallback is CosyVoice, and only if Turbo is impossible on this laptop. That swap is a later change, not this folder’s default.

## What is not here

- Jev
- Opening this helper to the public internet
