/**
 * Observable record of what the DJ is saying, and has said, this session.
 *
 * The audio engine is deliberately imperative: `AudioPlayer` keeps the live
 * break in refs so a mid-break re-render cannot unmount the voice node or
 * re-trigger a fetch. Publishing script text through React state would give up
 * exactly that property, so the broadcast log lives outside React entirely and
 * is read through `useSyncExternalStore`. The engine only ever calls the
 * mutators below, and never re-renders for having done so.
 *
 * Snapshots are replaced, never mutated, so `getDjBroadcastState` can be handed
 * straight to `useSyncExternalStore` — an unchanged store returns the identical
 * object and React skips the render.
 */

import type { DjSegmentKind, DjTransitionType } from "@/types/dj";
import { splitScriptLines } from "./teleprompter";

/** How many past breaks the transcript tab keeps. */
export const MAX_TRANSCRIPTS = 30;

export type DjBroadcastSegment = {
  /** Stable per break, so transcript rows keep their identity across renders. */
  id: string;
  kind: DjSegmentKind;
  transition: DjTransitionType;
  /** Script as written, verbatim. */
  script: string;
  /** Teleprompter lines derived from `script`. */
  lines: string[];
  songTitle: string;
  artistName: string;
  stationName: string;
  personaId?: string;
  /** Epoch ms the voice channel opened — the teleprompter's clock origin. */
  startedAt: number;
  endedAt?: number;
  /** True when the break was cut short by a skip, station change, or teardown. */
  interrupted?: boolean;
};

export type DjBroadcastState = {
  /** The break currently on air, or null between breaks. */
  activeSegment: DjBroadcastSegment | null;
  isSpeaking: boolean;
  /** Past breaks this session, most recent first. */
  transcripts: DjBroadcastSegment[];
};

export type DjSegmentInput = {
  kind: DjSegmentKind;
  transition: DjTransitionType;
  script: string;
  songTitle: string;
  artistName: string;
  stationName?: string;
  personaId?: string;
};

const EMPTY_STATE: DjBroadcastState = {
  activeSegment: null,
  isSpeaking: false,
  transcripts: [],
};

let state: DjBroadcastState = EMPTY_STATE;
let listeners = new Set<() => void>();
let segmentCounter = 0;

/** Monotonic clock for cue timing. Falls back to `Date.now` off the browser. */
function now(): number {
  return Date.now();
}

function publish(next: DjBroadcastState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function getDjBroadcastState(): DjBroadcastState {
  return state;
}

export function subscribeDjBroadcast(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Opens a break on air.
 *
 * Called at the moment speech actually starts rather than when the script is
 * written, so the teleprompter's clock origin matches what the listener hears
 * — a break warmed by the lookahead was written a whole track earlier.
 *
 * A break already open is archived first: only one voice clip can hold the
 * channel, so an unclosed segment means its exit path was cut short.
 */
export function startDjSegment(input: DjSegmentInput): DjBroadcastSegment {
  const script = typeof input.script === "string" ? input.script.trim() : "";
  const base = state.activeSegment ? archive(state, { interrupted: true }) : state;

  segmentCounter += 1;
  const segment: DjBroadcastSegment = {
    id: `dj-${segmentCounter}`,
    kind: input.kind,
    transition: input.transition,
    script,
    lines: splitScriptLines(script),
    songTitle: input.songTitle,
    artistName: input.artistName,
    stationName: input.stationName ?? "",
    personaId: input.personaId,
    startedAt: now(),
  };

  publish({ ...base, activeSegment: segment, isSpeaking: true });
  return segment;
}

/**
 * Closes the break on air and files it in the transcript log.
 *
 * A break cut short is still archived: the script was written and partly aired,
 * which is exactly what a listener scrolling back is looking for.
 */
export function finishDjSegment(options?: { interrupted?: boolean }): void {
  if (!state.activeSegment) {
    if (state.isSpeaking) publish({ ...state, isSpeaking: false });
    return;
  }
  publish(archive(state, { interrupted: options?.interrupted }));
}

function archive(
  current: DjBroadcastState,
  options: { interrupted?: boolean },
): DjBroadcastState {
  const active = current.activeSegment;
  if (!active) return current;

  const closed: DjBroadcastSegment = {
    ...active,
    endedAt: now(),
    ...(options.interrupted ? { interrupted: true } : {}),
  };

  return {
    activeSegment: null,
    isSpeaking: false,
    transcripts: [closed, ...current.transcripts].slice(0, MAX_TRANSCRIPTS),
  };
}

/**
 * Clears the log for a new session.
 *
 * Transcripts are session-scoped: a listener who has just tuned to a different
 * station is not looking for what the previous host said.
 */
export function resetDjBroadcast(): void {
  if (state === EMPTY_STATE) return;
  publish(EMPTY_STATE);
}

/** Test seam — drops subscribers and counters along with the state. */
export function __resetDjBroadcastStoreForTests(): void {
  state = EMPTY_STATE;
  listeners = new Set();
  segmentCounter = 0;
}
