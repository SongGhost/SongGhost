import type { DjSegmentKind, DjSegmentPlan, DjTrackContext, LocalConcertEvent } from "@/types/dj";

export type DjSchedulerInput = {
  currentTrack: DjTrackContext;
  /** Tracks after current in queue (for up-next previews) */
  upNextTracks?: DjTrackContext[];
  /** Songs between DJ breaks — 1 = every song gets a break */
  pacingFrequency: number;
  localEvent?: LocalConcertEvent | null;
  listenerCity?: string;
};

type SchedulerState = {
  songsSinceLastBreak: number;
  /** Tracks waiting to be mentioned on the next break */
  pendingTracks: DjTrackContext[];
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
  if (kind === "recap") return Math.min(14, 6 + trackCount * 2);
  if (kind === "up_next") return 8;
  if (kind === "local_events") return 9;
  if (kind === "artist_trivia") return 8;
  return 6;
}

/**
 * Decide whether a DJ break should run and what format it takes.
 * Every track is queued for mention; breaks batch mentions according to pacing.
 */
export function planDjSegment(
  state: SchedulerState,
  input: DjSchedulerInput,
): { plan: DjSegmentPlan | null; nextState: SchedulerState } {
  const pending = [...state.pendingTracks, input.currentTrack];
  const songsSinceLastBreak = state.songsSinceLastBreak + 1;
  const pacing = Math.max(1, input.pacingFrequency);

  if (songsSinceLastBreak < pacing) {
    return {
      plan: null,
      nextState: { songsSinceLastBreak, pendingTracks: pending },
    };
  }

  const announceTracks = dedupeTracks(pending);
  const hasUpNext = (input.upNextTracks?.length ?? 0) > 0;
  const hasLocalEvent = Boolean(input.localEvent);
  const current = announceTracks[announceTracks.length - 1];

  if (!current) {
    return {
      plan: null,
      nextState: { songsSinceLastBreak: 0, pendingTracks: [] },
    };
  }

  if (announceTracks.length > 1) {
    const kind: DjSegmentKind = hasUpNext && Math.random() < 0.35 ? "up_next" : "recap";
    return {
      plan: {
        kind,
        announceTracks,
        recapTracks: announceTracks.slice(0, -1),
        upNextTracks: kind === "up_next" ? input.upNextTracks?.slice(0, 2) : undefined,
        maxDurationSeconds: durationForKind(kind, announceTracks.length),
        listenerCity: input.listenerCity,
      },
      nextState: { songsSinceLastBreak: 0, pendingTracks: [] },
    };
  }

  let kind = pickSingleTrackKind(hasUpNext, hasLocalEvent);
  if (kind === "local_events" && !hasLocalEvent) kind = "artist_trivia";
  if (kind === "up_next" && !hasUpNext) kind = "song_intro";

  return {
    plan: {
      kind,
      announceTracks: [current],
      upNextTracks: kind === "up_next" ? input.upNextTracks?.slice(0, 2) : undefined,
      maxDurationSeconds: durationForKind(kind, 1),
      localEvent: kind === "local_events" ? input.localEvent ?? undefined : undefined,
      listenerCity: input.listenerCity,
    },
    nextState: { songsSinceLastBreak: 0, pendingTracks: [] },
  };
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

export function createDjSchedulerState(): SchedulerState {
  return { songsSinceLastBreak: 0, pendingTracks: [] };
}

export function resetDjSchedulerState(): SchedulerState {
  return createDjSchedulerState();
}
