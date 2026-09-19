/**
 * Client for the local custom-TTS sidecar (`LOCAL_TTS_URL`).
 *
 * Fail-closed: missing URL, network errors, non-OK status, and empty audio
 * throw `LocalTtsError`. Callers must not fall back to OpenAI.
 */

export const LOCAL_TTS_DEFAULT_URL = "http://127.0.0.1:7860";
/** Health is cheap; keep this tight so a down sidecar fails closed quickly. */
export const LOCAL_TTS_HEALTH_TIMEOUT_MS = 8000;
/**
 * Chatterbox-Turbo liners are slower than the Phase A beep.
 * 8s was enough for a stub; real GPU speech needs a longer window.
 */
export const LOCAL_TTS_SPEECH_TIMEOUT_MS = 120_000;

export type LocalSpeechRequest = {
  text: string;
  voiceSlot?: string;
  instructions?: string;
};

export type LocalSpeechResult = {
  buffer: ArrayBuffer;
  contentType: string;
};

export type LocalTtsHealth = {
  ok: boolean;
  model: string;
  gpu: boolean;
  vramNote?: string;
};

export class LocalTtsError extends Error {
  readonly status: number;

  constructor(message: string, status = 503) {
    super(message);
    this.name = "LocalTtsError";
    this.status = status;
  }
}

export function isLocalTtsError(error: unknown): error is LocalTtsError {
  return error instanceof LocalTtsError;
}

/** Trimmed `LOCAL_TTS_URL`, or undefined when unset. Never invents a default. */
export function getLocalTtsBaseUrl(): string | undefined {
  const raw = process.env.LOCAL_TTS_URL?.trim();
  return raw ? raw.replace(/\/$/, "") : undefined;
}

export function requireLocalTtsBaseUrl(): string {
  const baseUrl = getLocalTtsBaseUrl();
  if (!baseUrl) {
    throw new LocalTtsError(
      `LOCAL_TTS_URL is not set. Start the local TTS sidecar and set LOCAL_TTS_URL (for example ${LOCAL_TTS_DEFAULT_URL}). No OpenAI fallback.`,
      503,
    );
  }
  return baseUrl;
}

export function localHealthUrl(baseUrl: string = requireLocalTtsBaseUrl()): string {
  return `${baseUrl}/health`;
}

export function localSpeechUrl(baseUrl: string = requireLocalTtsBaseUrl()): string {
  return `${baseUrl}/v1/speech`;
}

async function fetchSidecar(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new LocalTtsError(
      "Local TTS sidecar is unavailable. No OpenAI fallback.",
      503,
    );
  }
}

/** Direct sidecar health check (`GET /health`). Not exposed as a Next route. */
export async function checkLocalTtsHealth(): Promise<LocalTtsHealth> {
  const response = await fetchSidecar(
    localHealthUrl(),
    {
      method: "GET",
      headers: { Accept: "application/json" },
    },
    LOCAL_TTS_HEALTH_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new LocalTtsError(
      `Local TTS sidecar health failed (${response.status}). No OpenAI fallback.`,
      503,
    );
  }

  const body = (await response.json()) as Partial<LocalTtsHealth>;
  if (body.ok !== true) {
    throw new LocalTtsError(
      "Local TTS sidecar reported not ok. No OpenAI fallback.",
      503,
    );
  }

  return {
    ok: true,
    model: typeof body.model === "string" ? body.model : "unknown",
    gpu: body.gpu === true,
    ...(typeof body.vramNote === "string" && body.vramNote.trim()
      ? { vramNote: body.vramNote.trim() }
      : {}),
  };
}

export async function synthesizeLocalSpeech(
  request: LocalSpeechRequest,
): Promise<LocalSpeechResult> {
  const text = request.text.trim();
  if (!text) {
    throw new LocalTtsError("Local TTS text is required.", 400);
  }

  const response = await fetchSidecar(
    localSpeechUrl(),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "audio/mpeg, audio/wav",
      },
      body: JSON.stringify({
        text,
        ...(request.voiceSlot ? { voiceSlot: request.voiceSlot } : {}),
        ...(request.instructions ? { instructions: request.instructions } : {}),
      }),
    },
    LOCAL_TTS_SPEECH_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new LocalTtsError(
      `Local TTS sidecar error (${response.status}). No OpenAI fallback.`,
      503,
    );
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new LocalTtsError(
      "Local TTS sidecar returned empty audio. No OpenAI fallback.",
      503,
    );
  }

  const contentType =
    response.headers.get("Content-Type")?.split(";")[0]?.trim() || "audio/mpeg";

  return { buffer, contentType };
}
