import type { DjSegmentKind, DjSegmentPlan, DjTrackContext, LocalConcertEvent } from "@/types/dj";
import { type ChatterPacing, getChatterPacingProfile } from "@/types/station";

export type DjTransitionType = "full_break" | "stinger" | "silent";

export type DjSchedulerInput = {
  currentTrack: DjTrackContext;
  /** Tracks after current in queue (for up-next previews) */
  upNextTracks?: DjTrackContext[];
  /** Songs between voiced DJ breaks — engine-managed, not listener-facing */
  pacingFrequency: number;
  /**
   * Listener-facing talk density for the active station. Takes precedence over
   * `pacingFrequency`, which stays as the engine default for callers that have
   * no station or listener setting to hand.
   */
  chatterPacing?: ChatterPacing | null;
  localEvent?: LocalConcertEvent | null;
  listenerCity?: string;
  /** First track of a new session — always gets song_intro full_break */
  isSessionOpening?: boolean;
  /**
   * Subscription tier for the Roots & Branches teaser (WS-4). Teasers fire
   * only when this is explicitly `false`. Omitted / `true` → no teaser, and
   * the teaser counter does not run.
   */
  isPro?: boolean;
};

/**
 * The pacing rules a single transition is decided against, after the listener's
 * chatter setting and the engine's numeric pacing have been reconciled.
 */
type PacingWindow = {
  /** Host is off entirely — every transition is silent, including the sign-on */
  muted: boolean;
  minGap: number;
  maxGap: number;
  alternateStinger: boolean;
};

export type SchedulerState = {
  pendingTracks: DjTrackContext[];
  /** Tracks played since the last voiced break — drives silent gaps at pacing >= 2 */
  tracksSinceLastBreak: number;
  /** Voiced breaks so far this session — seeds session-scoped style rotation */
  voicedBreakCount: number;
  /** Pacing = 1: whether the next voiced break should be a stinger */
  nextIsStinger: boolean;
  /**
   * Free-tier Roots & Branches teaser cadence (WS-4). Increments on each
   * voiced break when `isPro === false`; the 7th voiced slot is a teaser
   * instead of the standard break, then this resets to 0. Unused for Pro.
   */
  teaserSlotCount: number;
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

/** Free-tier Roots & Branches teaser: every Nth voiced break (WS-4). */
export const ROOTS_TEASER_VOICED_INTERVAL = 7;

/** Odds that an eligible break slips one extra track, widening the gap to pacing + 1 */
const BREAK_JITTER_CHANCE = 0.5;

/** Keep persisted or hand-edited values inside the supported range */
export function clampDjPacing(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DJ_PACING;
  return Math.min(MAX_DJ_PACING, Math.max(MIN_DJ_PACING, Math.round(value)));
}

/**
 * A muted session accumulates every track it plays, so the pending list has to be
 * capped or a long `music_only` run would hand an unbounded recap to the first
 * break after the listener turns the host back on.
 */
const MAX_PENDING_TRACKS = 8;

/**
 * Reconcile the listener's chatter setting with the engine's numeric pacing.
 *
 * With no chatter setting the legacy window is reproduced exactly — `pacing`
 * guaranteed silent tracks, a jittered slot at `pacing`, forced break at
 * `pacing + 1` — so existing callers keep their behavior unchanged.
 */
export function resolvePacingWindow(input: DjSchedulerInput): PacingWindow {
  if (input.chatterPacing) {
    const profile = getChatterPacingProfile(input.chatterPacing);
    return {
      muted: profile.muted,
      minGap: profile.minGap,
      maxGap: profile.maxGap,
      alternateStinger: profile.alternateStinger,
    };
  }

  const pacing = clampDjPacing(input.pacingFrequency);
  return {
    muted: false,
    minGap: pacing,
    maxGap: pacing + 1,
    alternateStinger: pacing <= MIN_DJ_PACING,
  };
}

function trackKey(track: DjTrackContext): string {
  return `${track.artist.toLowerCase()}::${track.title.toLowerCase()}`;
}

/** A nearby show is rare and time-sensitive, so feature it outright about half the time. */
const LOCAL_EVENT_FEATURE_CHANCE = 0.5;

/** Extra seconds granted to a break that also has to work in a concert aside */
const LOCAL_EVENT_ASIDE_SECONDS = 2;

/** Aligns with hard word caps (opening ≤45 words / mid-session ≤30 words). */
const MAX_BREAK_SECONDS = 15;

/** Odds a city-known break with no concert becomes a weather `local_events` clip. */
const WEATHER_FEATURE_CHANCE_MIN = 0.5;
const WEATHER_FEATURE_CHANCE_MAX = 0.58;

function pickSingleTrackKind(
  hasUpNext: boolean,
  hasLocalEvent: boolean,
  hasListenerCity: boolean,
): DjSegmentKind {
  const roll = Math.random();
  if (hasLocalEvent && roll < LOCAL_EVENT_FEATURE_CHANCE) return "local_events";
  if (
    !hasLocalEvent
    && hasListenerCity
    && roll >= WEATHER_FEATURE_CHANCE_MIN
    && roll < WEATHER_FEATURE_CHANCE_MAX
  ) {
    return "local_events";
  }
  if (hasUpNext && roll < 0.35) return "up_next";
  if (roll < 0.5) return "artist_trivia";
  // song_intro carries the rotating commentary matrix — keep it the widest slice.
  return "song_intro";
}

/**
 * Spoken budget for a break. Opening intros get the longer 35–45 word window;
 * mid-session breaks stay in the 20–30 word / ~10s lane so TTS stays tight.
 */
function durationForKind(
  kind: DjSegmentKind,
  trackCount: number,
  isSessionOpening = false,
): number {
  if (kind === "stinger") return 3;
  if (kind === "roots_teaser") return 12;
  if (isSessionOpening) return 15;
  if (kind === "recap") return Math.min(12, 6 + trackCount * 2);
  if (kind === "up_next") return 10;
  if (kind === "local_events") return 10;
  if (kind === "artist_trivia") return 10;
  return 10;
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
  // Trimmed from the front: the most recent tracks are the ones a recap can
  // still plausibly react to.
  return out.length > MAX_PENDING_TRACKS ? out.slice(-MAX_PENDING_TRACKS) : out;
}

function asRootsTeaserPlan(plan: DjSegmentPlan): DjSegmentPlan {
  return {
    kind: "roots_teaser",
    transition: "full_break",
    announceTracks: plan.announceTracks,
    recapTracks: plan.recapTracks,
    upNextTracks: plan.upNextTracks,
    maxDurationSeconds: durationForKind("roots_teaser", 1),
    styleRotationIndex: plan.styleRotationIndex,
    listenerCity: plan.listenerCity,
  };
}

/**
 * Free-only: the 7th voiced slot becomes a Roots & Branches teaser. Session
 * opening is never swapped. Pro (or omitted `isPro`) does not run the counter.
 */
function applyRootsTeaserCadence(
  plan: DjSegmentPlan,
  state: SchedulerState,
  isPro: boolean | undefined,
  isSessionOpening: boolean,
): { plan: DjSegmentPlan; teaserSlotCount: number } {
  if (isPro !== false) {
    return { plan, teaserSlotCount: 0 };
  }
  const next = state.teaserSlotCount + 1;
  if (!isSessionOpening && next >= ROOTS_TEASER_VOICED_INTERVAL) {
    return { plan: asRootsTeaserPlan(plan), teaserSlotCount: 0 };
  }
  return { plan, teaserSlotCount: next };
}

function buildSongIntroPlan(
  track: DjTrackContext,
  styleRotationIndex: number,
  listenerCity?: string,
  isSessionOpening = false,
): DjSegmentPlan {
  return {
    kind: "song_intro",
    transition: "full_break",
    announceTracks: [track],
    maxDurationSeconds: durationForKind("song_intro", 1, isSessionOpening),
    styleRotationIndex,
    listenerCity,
    isSessionOpening,
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
  const hasListenerCity = Boolean(input.listenerCity?.trim());
  const current = announceTracks[announceTracks.length - 1];

  // Every voiced break carries the event so the DJ can tag it on. `local_events`
  // makes it the subject; the other kinds weave it in as a closing aside.
  const withLocalEvent = (kind: DjSegmentKind, baseSeconds: number) => ({
    localEvent,
    localEventSubkind:
      kind === "local_events"
        ? (hasLocalEvent ? "concert" as const : "weather" as const)
        : undefined,
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

  let kind = pickSingleTrackKind(hasUpNext, hasLocalEvent, hasListenerCity);
  if (kind === "local_events" && !hasLocalEvent && !hasListenerCity) {
    kind = "artist_trivia";
  }
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

/** Tight pacing alternates full_break / stinger; wider pacing restarts the silent count. */
function afterVoicedBreakState(
  state: SchedulerState,
  window: PacingWindow,
  wasStinger: boolean,
  teaserSlotCount: number,
): SchedulerState {
  return {
    pendingTracks: [],
    tracksSinceLastBreak: 0,
    voicedBreakCount: state.voicedBreakCount + 1,
    nextIsStinger: window.alternateStinger && !wasStinger,
    teaserSlotCount,
  };
}

function silentState(
  state: SchedulerState,
  pending: DjTrackContext[],
  tracksSinceLastBreak: number,
): DjScheduleResult {
  return {
    transition: "silent",
    plan: null,
    nextState: {
      pendingTracks: pending,
      tracksSinceLastBreak,
      voicedBreakCount: state.voicedBreakCount,
      nextIsStinger: false,
      teaserSlotCount: state.teaserSlotCount,
    },
  };
}

/**
 * Whether a break is still owed music. Below `minGap` the gap is guaranteed; between
 * the bounds it may slip a track so breaks don't land on a metronome; at `maxGap`
 * the break is forced.
 */
function shouldStaySilent(tracksSinceLastBreak: number, window: PacingWindow): boolean {
  if (tracksSinceLastBreak < window.minGap) return true;
  if (tracksSinceLastBreak >= window.maxGap) return false;
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
  const window = resolvePacingWindow(input);
  const pending = dedupeTracks([...state.pendingTracks, input.currentTrack]);

  /**
   * `music_only` is the one setting that overrides the session-opening break.
   * Everywhere else the sign-on is guaranteed, but a listener who muted the host
   * asked for music with no voice on it — including the first track.
   */
  if (window.muted) {
    return silentState(state, pending, state.tracksSinceLastBreak + 1);
  }

  if (input.isSessionOpening) {
    const opening = buildSongIntroPlan(
      input.currentTrack,
      state.voicedBreakCount,
      input.listenerCity,
      true,
    );
    const { plan, teaserSlotCount } = applyRootsTeaserCadence(
      opening,
      state,
      input.isPro,
      true,
    );
    return {
      transition: "full_break",
      plan,
      nextState: afterVoicedBreakState(state, window, false, teaserSlotCount),
    };
  }

  if (window.alternateStinger) {
    if (state.nextIsStinger) {
      const { plan, teaserSlotCount } = applyRootsTeaserCadence(
        buildStingerPlan(input.listenerCity),
        state,
        input.isPro,
        false,
      );
      return {
        transition: plan.kind === "roots_teaser" ? "full_break" : "stinger",
        plan,
        nextState: afterVoicedBreakState(
          state,
          window,
          plan.kind === "stinger",
          teaserSlotCount,
        ),
      };
    }

    const { plan, teaserSlotCount } = applyRootsTeaserCadence(
      buildFullBreakPlan(pending, input, state.voicedBreakCount),
      state,
      input.isPro,
      false,
    );
    return {
      transition: "full_break",
      plan,
      nextState: afterVoicedBreakState(state, window, false, teaserSlotCount),
    };
  }

  const tracksSinceLastBreak = state.tracksSinceLastBreak + 1;

  if (shouldStaySilent(tracksSinceLastBreak, window)) {
    return silentState(state, pending, tracksSinceLastBreak);
  }

  {
    const { plan, teaserSlotCount } = applyRootsTeaserCadence(
      buildFullBreakPlan(pending, input, state.voicedBreakCount),
      state,
      input.isPro,
      false,
    );
    return {
      transition: "full_break",
      plan,
      nextState: afterVoicedBreakState(state, window, false, teaserSlotCount),
    };
  }
}

export function createDjSchedulerState(): SchedulerState {
  return {
    pendingTracks: [],
    tracksSinceLastBreak: 0,
    voicedBreakCount: 0,
    nextIsStinger: false,
    teaserSlotCount: 0,
  };
}

export function resetDjSchedulerState(): SchedulerState {
  return createDjSchedulerState();
}

/**
 * Mid-session Free → Pro: stop the teaser counter so a pending 7-count
 * cannot fire after upgrade. Does not reset pacing / voiced-break rotation.
 */
export function clearRootsTeaserCounter(state: SchedulerState): SchedulerState {
  if (state.teaserSlotCount === 0) return state;
  return { ...state, teaserSlotCount: 0 };
}
