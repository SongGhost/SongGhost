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
 * Hard deadline for a sidecar speech request. Warm 3070 Ti lore should finish
 * in ~5–15s; 28s leaves headroom for a cold-ish first clip. Exceeding this
 * aborts the HTTP socket so the sidecar is not left writing to a dead client
 * as the only failure mode. The break is skipped; music starts at 100%.
 */
export const LOCAL_TTS_SPEECH_TIMEOUT_MS = 28_000;

/** Identical short station-ID / identity lines reuse the last WAV. */
const IDENTITY_LINE_CACHE_MAX_CHARS = 96;
const IDENTITY_LINE_CACHE_MAX_ENTRIES = 12;

export type LocalSpeechMode = "break" | "preview";

export type LocalSpeechRequest = {
  text: string;
  voiceSlot?: string;
  instructions?: string;
  /** Combined with the speech timeout so a cancelled break aborts the sidecar HTTP. */
  signal?: AbortSignal;
  /** Preview vs on-air. Sidecar uses the same Turbo decoder; preview is shorter text. */
  mode?: LocalSpeechMode;
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

type IdentityCacheEntry = {
  buffer: ArrayBuffer;
  contentType: string;
};

const identityLineCache = new Map<string, IdentityCacheEntry>();

function identityCacheKey(text: string, voiceSlot?: string): string {
  return `${voiceSlot ?? "1"}::${text}`;
}

function readIdentityCache(text: string, voiceSlot?: string): IdentityCacheEntry | null {
  if (text.length > IDENTITY_LINE_CACHE_MAX_CHARS) return null;
  const hit = identityLineCache.get(identityCacheKey(text, voiceSlot));
  if (!hit) return null;
  return {
    buffer: hit.buffer.slice(0),
    contentType: hit.contentType,
  };
}

function writeIdentityCache(
  text: string,
  voiceSlot: string | undefined,
  entry: IdentityCacheEntry,
): void {
  if (text.length > IDENTITY_LINE_CACHE_MAX_CHARS) return;
  const key = identityCacheKey(text, voiceSlot);
  if (identityLineCache.has(key)) identityLineCache.delete(key);
  identityLineCache.set(key, {
    buffer: entry.buffer.slice(0),
    contentType: entry.contentType,
  });
  while (identityLineCache.size > IDENTITY_LINE_CACHE_MAX_ENTRIES) {
    const oldest = identityLineCache.keys().next().value;
    if (oldest === undefined) break;
    identityLineCache.delete(oldest);
  }
}

function combineAbortSignals(signals: AbortSignal[]): AbortSignal {
  const anyFn = (
    AbortSignal as typeof AbortSignal & {
      any?: (list: AbortSignal[]) => AbortSignal;
    }
  ).any;
  if (typeof anyFn === "function") return anyFn(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name?: unknown }).name) : "";
  return name === "AbortError" || name === "TimeoutError";
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
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? combineAbortSignals([init.signal, timeout])
    : timeout;
  try {
    return await fetch(url, {
      ...init,
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new LocalTtsError(
        "Local TTS timed out or was cancelled. Break skipped. No OpenAI fallback.",
        504,
      );
    }
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

  const cached = readIdentityCache(text, request.voiceSlot);
  if (cached) {
    return cached;
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
        ...(request.mode ? { mode: request.mode } : {}),
      }),
      signal: request.signal,
    },
    LOCAL_TTS_SPEECH_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new LocalTtsError(
      `Local TTS sidecar error (${response.status}). No OpenAI fallback.`,
      response.status === 400 ? 400 : 503,
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

  const result = { buffer, contentType };
  writeIdentityCache(text, request.voiceSlot, result);
  return result;
}
