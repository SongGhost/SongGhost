import type { DjSegmentKind, DjSegmentPlan, DjTrackContext, LocalConcertEvent } from "@/types/dj";

export type DjTransitionType = "full_break" | "stinger" | "silent";

export type DjSchedulerInput = {
  currentTrack: DjTrackContext;
  /** Tracks after current in queue (for up-next previews) */
  upNextTracks?: DjTrackContext[];
  /** Songs between full DJ breaks — 1 = alternate full_break / stinger */
  pacingFrequency: number;
  localEvent?: LocalConcertEvent | null;
  listenerCity?: string;
  /** First track of a new session — always gets song_intro full_break */
  isSessionOpening?: boolean;
};

export type SchedulerState = {
  pendingTracks: DjTrackContext[];
  /** Tracks still to play silently before the next full_break (pacing >= 2) */
  silentTracksRemaining: number;
  /** Pacing = 1: whether the next voiced break should be a stinger */
  nextIsStinger: boolean;
};

export type DjScheduleResult = {
  transition: DjTransitionType;
  plan: DjSegmentPlan | null;
  nextState: SchedulerState;
};

function trackKey(track: DjTrackContext): string {
  return `${track.artist.toLowerCase()}::${track.title.toLowerCase()}`;
}

function pickSingleTrackKind(hasUpNext: boolean, hasLocalEvent: boolean): DjSegmentKind {
  const roll = Math.random();
  if (hasLocalEvent && roll < 0.2) return "local_events";
  if (roll < 0.45) return "artist_trivia";
  if (hasUpNext && roll < 0.65) return "up_next";
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
  listenerCity?: string,
): DjSegmentPlan {
  return {
    kind: "song_intro",
    transition: "full_break",
    announceTracks: [track],
    maxDurationSeconds: durationForKind("song_intro", 1),
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
): DjSegmentPlan {
  const hasUpNext = (input.upNextTracks?.length ?? 0) > 0;
  const hasLocalEvent = Boolean(input.localEvent);
  const current = announceTracks[announceTracks.length - 1];

  if (announceTracks.length > 1) {
    const kind: DjSegmentKind = hasUpNext && Math.random() < 0.35 ? "up_next" : "recap";
    return {
      kind,
      transition: "full_break",
      announceTracks,
      recapTracks: announceTracks.slice(0, -1),
      upNextTracks: kind === "up_next" ? input.upNextTracks?.slice(0, 2) : undefined,
      maxDurationSeconds: durationForKind(kind, announceTracks.length),
      listenerCity: input.listenerCity,
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
    maxDurationSeconds: durationForKind(kind, 1),
    localEvent: kind === "local_events" ? input.localEvent ?? undefined : undefined,
    listenerCity: input.listenerCity,
  };
}

function afterFullBreakState(state: SchedulerState, pacing: number): SchedulerState {
  if (pacing <= 1) {
    return {
      pendingTracks: [],
      silentTracksRemaining: 0,
      nextIsStinger: true,
    };
  }

  return {
    pendingTracks: [],
    silentTracksRemaining: pacing - 1,
    nextIsStinger: false,
  };
}

/**
 * Decide whether a DJ break should run and what broadcast transition to use.
 * Tracks accumulate in pending during silent gaps and are named on full_break.
 */
export function planDjSegment(
  state: SchedulerState,
  input: DjSchedulerInput,
): DjScheduleResult {
  const pacing = Math.max(1, input.pacingFrequency);
  const pending = dedupeTracks([...state.pendingTracks, input.currentTrack]);

  if (input.isSessionOpening) {
    const plan = buildSongIntroPlan(input.currentTrack, input.listenerCity);
    return {
      transition: "full_break",
      plan,
      nextState: afterFullBreakState(state, pacing),
    };
  }

  if (pacing <= 1) {
    if (state.nextIsStinger) {
      return {
        transition: "stinger",
        plan: buildStingerPlan(input.listenerCity),
        nextState: {
          pendingTracks: [],
          silentTracksRemaining: 0,
          nextIsStinger: false,
        },
      };
    }

    const plan = buildFullBreakPlan(pending, input);
    return {
      transition: "full_break",
      plan,
      nextState: afterFullBreakState(state, pacing),
    };
  }

  if (state.silentTracksRemaining > 0) {
    return {
      transition: "silent",
      plan: null,
      nextState: {
        pendingTracks: pending,
        silentTracksRemaining: state.silentTracksRemaining - 1,
        nextIsStinger: false,
      },
    };
  }

  const plan = buildFullBreakPlan(pending, input);
  return {
    transition: "full_break",
    plan,
    nextState: afterFullBreakState(state, pacing),
  };
}

export function createDjSchedulerState(): SchedulerState {
  return {
    pendingTracks: [],
    silentTracksRemaining: 0,
    nextIsStinger: false,
  };
}

export function resetDjSchedulerState(): SchedulerState {
  return createDjSchedulerState();
}
