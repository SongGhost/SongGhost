import type { DjSegmentKind, DjSegmentPlan, DjTrackContext, LocalConcertEvent } from "@/types/dj";

export type DjTransitionType = "full_break" | "stinger" | "silent";

export type DjSchedulerInput = {
  currentTrack: DjTrackContext;
  /** Tracks after current in queue (for up-next previews) */
  upNextTracks?: DjTrackContext[];
  /** Songs between voiced DJ breaks — engine-managed, not listener-facing */
  pacingFrequency: number;
  localEvent?: LocalConcertEvent | null;
  listenerCity?: string;
  /** First track of a new session — always gets song_intro full_break */
  isSessionOpening?: boolean;
};

export type SchedulerState = {
  pendingTracks: DjTrackContext[];
  /** Tracks played since the last voiced break — drives silent gaps at pacing >= 2 */
  tracksSinceLastBreak: number;
  /** Voiced breaks so far this session — seeds session-scoped style rotation */
  voicedBreakCount: number;
  /** Pacing = 1: whether the next voiced break should be a stinger */
  nextIsStinger: boolean;
};

export type DjScheduleResult = {
  transition: DjTransitionType;
  plan: DjSegmentPlan | null;
  nextState: SchedulerState;
};

export const MIN_DJ_PACING = 1;
export const MAX_DJ_PACING = 3;

/**
 * Background broadcast pacing. Not listener-configurable — 2 with jitter lands a
 * voiced break every 2–3 tracks, which reads as organic rather than metronomic.
 */
export const DEFAULT_DJ_PACING = 2;

/** Odds that an eligible break slips one extra track, widening the gap to pacing + 1 */
const BREAK_JITTER_CHANCE = 0.5;

/** Keep persisted or hand-edited values inside the supported range */
export function clampDjPacing(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DJ_PACING;
  return Math.min(MAX_DJ_PACING, Math.max(MIN_DJ_PACING, Math.round(value)));
}

function trackKey(track: DjTrackContext): string {
  return `${track.artist.toLowerCase()}::${track.title.toLowerCase()}`;
}

/** A nearby show is rare and time-sensitive, so feature it outright about half the time. */
const LOCAL_EVENT_FEATURE_CHANCE = 0.5;

/** Extra seconds granted to a break that also has to work in a concert aside */
const LOCAL_EVENT_ASIDE_SECONDS = 3;

const MAX_BREAK_SECONDS = 16;

function pickSingleTrackKind(hasUpNext: boolean, hasLocalEvent: boolean): DjSegmentKind {
  const roll = Math.random();
  if (hasLocalEvent && roll < LOCAL_EVENT_FEATURE_CHANCE) return "local_events";
  if (hasUpNext && roll < 0.35) return "up_next";
  if (roll < 0.5) return "artist_trivia";
  // song_intro carries the rotating commentary matrix — keep it the widest slice.
  return "song_intro";
}

function durationForKind(kind: DjSegmentKind, trackCount: number): number {
  if (kind === "stinger") return 3;
  if (kind === "recap") return Math.min(14, 6 + trackCount * 2);
  if (kind === "up_next") return 8;
  if (kind === "local_events") return 9;
  if (kind === "artist_trivia") return 8;
  return 6;
}

function dedupeTracks(tracks: DjTrackContext[]): DjTrackContext[] {
  const seen = new Set<string>();
  const out: DjTrackContext[] = [];
  for (const track of tracks) {
    const key = trackKey(track);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(track);
  }
  return out;
}

function buildSongIntroPlan(
  track: DjTrackContext,
  styleRotationIndex: number,
  listenerCity?: string,
): DjSegmentPlan {
  return {
    kind: "song_intro",
    transition: "full_break",
    announceTracks: [track],
    maxDurationSeconds: durationForKind("song_intro", 1),
    styleRotationIndex,
    listenerCity,
  };
}

function buildStingerPlan(listenerCity?: string): DjSegmentPlan {
  return {
    kind: "stinger",
    transition: "stinger",
    announceTracks: [],
    maxDurationSeconds: durationForKind("stinger", 1),
    listenerCity,
  };
}

function buildFullBreakPlan(
  announceTracks: DjTrackContext[],
  input: DjSchedulerInput,
  styleRotationIndex: number,
): DjSegmentPlan {
  const hasUpNext = (input.upNextTracks?.length ?? 0) > 0;
  const localEvent = input.localEvent ?? undefined;
  const hasLocalEvent = Boolean(localEvent);
  const current = announceTracks[announceTracks.length - 1];

  // Every voiced break carries the event so the DJ can tag it on. `local_events`
  // makes it the subject; the other kinds weave it in as a closing aside.
  const withLocalEvent = (kind: DjSegmentKind, baseSeconds: number) => ({
    localEvent,
    maxDurationSeconds: hasLocalEvent
      ? Math.min(MAX_BREAK_SECONDS, baseSeconds + (kind === "local_events" ? 0 : LOCAL_EVENT_ASIDE_SECONDS))
      : baseSeconds,
  });

  if (announceTracks.length > 1) {
    const kind: DjSegmentKind = hasUpNext && Math.random() < 0.35 ? "up_next" : "recap";
    return {
      kind,
      transition: "full_break",
      announceTracks,
      recapTracks: announceTracks.slice(0, -1),
      upNextTracks: kind === "up_next" ? input.upNextTracks?.slice(0, 2) : undefined,
      styleRotationIndex,
      listenerCity: input.listenerCity,
      ...withLocalEvent(kind, durationForKind(kind, announceTracks.length)),
    };
  }

  let kind = pickSingleTrackKind(hasUpNext, hasLocalEvent);
  if (kind === "local_events" && !hasLocalEvent) kind = "artist_trivia";
  if (kind === "up_next" && !hasUpNext) kind = "song_intro";

  return {
    kind,
    transition: "full_break",
    announceTracks: [current],
    upNextTracks: kind === "up_next" ? input.upNextTracks?.slice(0, 2) : undefined,
    styleRotationIndex,
    listenerCity: input.listenerCity,
    ...withLocalEvent(kind, durationForKind(kind, 1)),
  };
}

/** Pacing 1 alternates full_break / stinger; pacing >= 2 restarts the silent count. */
function afterVoicedBreakState(
  state: SchedulerState,
  pacing: number,
  wasStinger: boolean,
): SchedulerState {
  return {
    pendingTracks: [],
    tracksSinceLastBreak: 0,
    voicedBreakCount: state.voicedBreakCount + 1,
    nextIsStinger: pacing <= 1 && !wasStinger,
  };
}

/**
 * Whether a break is still owed music. Below `pacing` the gap is guaranteed; exactly
 * at `pacing` it may slip one track so breaks don't land on a metronome; at
 * `pacing + 1` the break is forced.
 */
function shouldStaySilent(tracksSinceLastBreak: number, pacing: number): boolean {
  if (tracksSinceLastBreak < pacing) return true;
  if (tracksSinceLastBreak >= pacing + 1) return false;
  return Math.random() < BREAK_JITTER_CHANCE;
}

/**
 * Decide whether a DJ break should run and what broadcast transition to use.
 * Tracks accumulate in pending during silent gaps and are named on full_break.
 */
export function planDjSegment(
  state: SchedulerState,
  input: DjSchedulerInput,
): DjScheduleResult {
  const pacing = clampDjPacing(input.pacingFrequency);
  const pending = dedupeTracks([...state.pendingTracks, input.currentTrack]);

  if (input.isSessionOpening) {
    return {
      transition: "full_break",
      plan: buildSongIntroPlan(
        input.currentTrack,
        state.voicedBreakCount,
        input.listenerCity,
      ),
      nextState: afterVoicedBreakState(state, pacing, false),
    };
  }

  if (pacing <= 1) {
    if (state.nextIsStinger) {
      return {
        transition: "stinger",
        plan: buildStingerPlan(input.listenerCity),
        nextState: afterVoicedBreakState(state, pacing, true),
      };
    }

    return {
      transition: "full_break",
      plan: buildFullBreakPlan(pending, input, state.voicedBreakCount),
      nextState: afterVoicedBreakState(state, pacing, false),
    };
  }

  const tracksSinceLastBreak = state.tracksSinceLastBreak + 1;

  if (shouldStaySilent(tracksSinceLastBreak, pacing)) {
    return {
      transition: "silent",
      plan: null,
      nextState: {
        pendingTracks: pending,
        tracksSinceLastBreak,
        voicedBreakCount: state.voicedBreakCount,
        nextIsStinger: false,
      },
    };
  }

  return {
    transition: "full_break",
    plan: buildFullBreakPlan(pending, input, state.voicedBreakCount),
    nextState: afterVoicedBreakState(state, pacing, false),
  };
}

export function createDjSchedulerState(): SchedulerState {
  return {
    pendingTracks: [],
    tracksSinceLastBreak: 0,
    voicedBreakCount: 0,
    nextIsStinger: false,
  };
}

export function resetDjSchedulerState(): SchedulerState {
  return createDjSchedulerState();
}
