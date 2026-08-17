/**
 * DJ prompt variety engine — rotates commentary styles and enforces banned tropes.
 *
 * Album deep dives run the same machinery through a second lens: the host keeps
 * their persona and pacing, but every break is anchored to one record's running
 * order and rotates through a musicologist's angles instead of the general
 * commentary matrix.
 */

import { DEFAULT_PERSONA, getPersonaById, type DjPersona } from "@/data/personas";
import {
  resolveCommentaryFormat,
  type CommentaryFormat,
  type DJPromptContext,
  type DjHookAngle,
  type DjSegmentKind,
  type DjSegmentPlan,
  type DjTrackContext,
  type LocalConcertEvent,
} from "@/types/dj";
import {
  describeAlbumRelease,
  eraYearBounds,
  findAlbumTrackIndex,
  formatAlbumCredit,
  getEraDefinition,
  getTriviaDensityProfile,
  isEraLocked,
  normalizeVoiceProfileOverride,
  resolveChatterPacing,
  resolveTriviaDensity,
  sanitizeVibePrompt,
  type AlbumContext,
  type ChatterPacing,
  type EraLock,
  type VoiceProfileOverride,
} from "@/types/station";

/**
 * Prompt context plus the listener's active chatter pacing (`talkLevel`).
 *
 * Kept as a local intersection so the prompt engine can pace trivia density
 * without widening the shared `DJPromptContext` contract in this change set.
 */
export type PromptBuilderContext = DJPromptContext & {
  /** Active chatter pacing — drives musicology trivia density */
  talkLevel?: ChatterPacing;
  /**
   * Trivia topics the listener has already heard (Anti-Repetition Fact Engine).
   * When non-empty, appended to the system prompt as a hard negative directive.
   */
  excludedFacts?: string[];
};

export const BANNED_OPENER_PHRASES = [
  "Fun fact:",
  "Did you know...",
  "Did you know:",
  "Here's a fun fact",
  "Here's an interesting fact:",
  "Speaking of...",
  "Welcome back listeners:",
  "Welcome back,",
] as const;

const TTS_DIALOGUE_RULES =
  " Write ONLY spoken dialogue that a real radio DJ would say out loud. Do NOT include sound effect labels, stage directions, or bracketed text like [growl] or *chuckles*.";

/**
 * Personas supply character only. Without this the model falls back on a generic
 * "here's the song and artist" intro for every segment kind.
 */
const SEGMENT_AUTHORITY_RULE =
  " The user message is a segment brief describing exactly which kind of on-air moment this is. Follow it literally. Only name a song or artist when the brief tells you to, and never pad a segment back into a standard track intro.";

const BANNED_OPENERS_RULE = ` STRICTLY FORBIDDEN openers and phrases: ${BANNED_OPENER_PHRASES.map((p) => `'${p}'`).join(", ")}. Never start with trivia-setup lines or lazy segues.`;

/** Real-world broadcasters the model reaches for when it improvises a station id. */
export const FORBIDDEN_STATION_NAMES = [
  "Alt Nation",
  "KROQ",
  "SiriusXM",
  "Sirius",
  "XM Radio",
  "BBC",
  "BBC Radio 1",
  "iHeartRadio",
  "iHeart",
  "Z100",
  "Hot 97",
  "KEXP",
  "NPR",
  "Radio Disney",
] as const;

/**
 * The model will happily claim to be on a real broadcaster if left alone, which
 * both breaks the fiction and borrows a trademark. The live station name is
 * supplied in every segment brief, so there is nothing to invent.
 */
const STATION_IDENTITY_RULE = ` STATION IDENTITY — ABSOLUTE: NEVER mention real-world radio stations, networks, or satellite channels. Forbidden examples: ${FORBIDDEN_STATION_NAMES.join(", ")}. NEVER mention FM frequencies, dial numbers, or radio call letters. Never invent a network or sister station. ALWAYS refer strictly to the active SongHost curated station or genre title exactly as given in the segment brief (for example "SongHost", "70s Classic Rock").`;

const TTS_FORMAT_RULES = ` PUNCTUATION FOR TTS: Use ellipses (...) for natural breath pauses between thoughts. Use em-dashes (—) for casual mid-sentence pivots. Keep EVERY sentence under 12 words — short bursts sound alive on a digital stream. No run-on sentences.${BANNED_OPENERS_RULE}`;

/**
 * Standing brevity rule for every voiced break. Without it the model drifts into
 * multi-paragraph liner-note lectures that overrun TTS and bury the music.
 */
const CONCISE_DJ_RULE =
  " Be extremely concise. Write like a sharp SongHost digital stream host. Deliver 1 fascinating fact in 15 seconds, then yield to the music. Never deliver multi-paragraph lectures.";

/** Session sign-on / album needle-drop — room for a warm open plus one lore hit. */
const OPENING_WORD_LIMIT_RULE =
  " HARD LENGTH — Station/Album Opening Intro: Maximum 35 to 45 words (2 to 3 punchy sentences). Single core lore nugget only.";

/** Every voiced break after the sign-on. */
const MID_SESSION_WORD_LIMIT_RULE =
  " HARD LENGTH — Mid-Session Track Break: Maximum 20 to 30 words (1 to 2 short sentences).";

/**
 * Hard word-count directive for a break. Stingers stay under a single short line;
 * openings get the longer window; everything else is mid-session tight.
 */
export function buildBreakLengthDirective(options?: {
  isSessionOpening?: boolean;
  kind?: DjSegmentKind;
}): string {
  if (options?.kind === "stinger") {
    return " Be extremely concise. One short station-ID line only — under 12 words.";
  }

  const wordRule = options?.isSessionOpening
    ? OPENING_WORD_LIMIT_RULE
    : MID_SESSION_WORD_LIMIT_RULE;

  return (
    " Be extremely concise. Write like a sharp SongHost digital stream host. Deliver 1 fascinating fact in 15 seconds, then yield to the music. Never deliver multi-paragraph lectures." +
    wordRule
  );
}

/**
 * Strict accuracy guardrail for all voiced breaks — not only album deep dives.
 * Fabricated chart peaks and producer names destroy trust faster than silence.
 */
const INVENTION_BAN_RULE =
  " INVENTION BAN — STRICT ACCURACY: Never fabricate chart positions, sales figures," +
  " producer/engineer names, studio locations, session players, gear, or dates." +
  " If specific metadata is not confirmed in the track context or your knowledge with" +
  " high confidence, focus on verified band lore or era context instead of inventing" +
  " numbers or names. When unsure, leave the detail out.";

/* ------------------------------------------------------------------ *
 * Musicology pillars — rotating lore categories
 * ------------------------------------------------------------------ */

export type MusicologyPillarId =
  | "chart_commercial"
  | "studio_production"
  | "personnel_credits"
  | "lyrical_inspiration"
  | "cultural_era";

export type MusicologyPillar = {
  id: MusicologyPillarId;
  name: string;
  instruction: string;
};

/**
 * Five core music-lore categories the host rotates across so back-to-back
 * breaks do not retell the same kind of fact.
 */
export const MUSICOLOGY_PILLARS: readonly MusicologyPillar[] = [
  {
    id: "chart_commercial",
    name: "Chart & Commercial Milestones",
    instruction:
      "Peak chart position, weeks on the chart, certifications, or sales milestones — only when you know them.",
  },
  {
    id: "studio_production",
    name: "Studio & Production Lore",
    instruction:
      "Microphones, instruments/synths, producers, engineers, or the studio where it was cut.",
  },
  {
    id: "personnel_credits",
    name: "Personnel & Guest Credits",
    instruction:
      "Session players, co-writers, guest features, or band-member dynamics around the track.",
  },
  {
    id: "lyrical_inspiration",
    name: "Lyrical & Conceptual Inspiration",
    instruction:
      "Real-world events, people, or anecdotes that shaped the lyrics or concept.",
  },
  {
    id: "cultural_era",
    name: "Cultural Era Context",
    instruction:
      "The historical setting and musical movements around the time of recording or release.",
  },
] as const;

/** Pick the pillar for this break off the session rotation index. */
export function pickMusicologyPillar(rotationIndex?: number): MusicologyPillar {
  if (typeof rotationIndex !== "number" || !Number.isFinite(rotationIndex)) {
    return MUSICOLOGY_PILLARS[0];
  }
  return MUSICOLOGY_PILLARS[
    Math.abs(Math.trunc(rotationIndex)) % MUSICOLOGY_PILLARS.length
  ];
}

/**
 * Standing system directive: the host knows the five pillars and must rotate
 * across them rather than defaulting to the same trivia shape every break.
 */
export function buildMusicologyDirective(): string {
  const catalog = MUSICOLOGY_PILLARS.map(
    (p, i) => `${i + 1}) ${p.name} — ${p.instruction}`,
  ).join(" ");

  return (
    ` MUSICOLOGY PILLARS — rotate across these five lore categories across breaks:` +
    ` ${catalog}` +
    ` Prefer the pillar named in the segment brief for this break.` +
    ` Never open with trivia-setup lines; weave the lore as natural radio patter.`
  );
}

/**
 * Per-segment trivia density from the active talk level (and deep-dive override).
 * Stingers and muted pacing skip the directive entirely.
 */
export function buildTriviaDensityDirective(
  talkLevel: ChatterPacing | undefined,
  options?: {
    isDeepDive?: boolean;
    /** Skip density rules for station-ID sweepers and muted hosts */
    skip?: boolean;
    rotationIndex?: number;
    /** Opening breaks always get a single lore nugget — never a two-nugget stack */
    isSessionOpening?: boolean;
  },
): string {
  if (options?.skip) return "";

  const pacing = resolveChatterPacing(talkLevel);
  const density = resolveTriviaDensity(pacing, { isDeepDive: options?.isDeepDive });
  if (density === "none") return "";

  const profile = getTriviaDensityProfile(pacing, { isDeepDive: options?.isDeepDive });
  const pillar = pickMusicologyPillar(options?.rotationIndex);

  // Hard word limits win: openings are single-nugget only, and mid-session caps
  // at one fact so 20–30 word breaks stay punchy instead of lecture-length.
  if (options?.isSessionOpening || profile.nuggetCount >= 2) {
    return (
      ` SINGLE LORE NUGGET — deliver exactly one high-value musicology fact` +
      ` from "${pillar.name}": ${pillar.instruction}` +
      ` Do not stack a second nugget. Yield to the music.`
    );
  }

  return (
    ` ${profile.instruction}` +
    ` Primary musicology pillar for this break — "${pillar.name}": ${pillar.instruction}`
  );
}

/* ------------------------------------------------------------------ *
 * Time-of-day / seasonal broadcast context (Phase 4D)
 * ------------------------------------------------------------------ */

export type BroadcastDaypart =
  | "morning_drive"
  | "midday"
  | "late_afternoon_focus"
  | "evening"
  | "late_night_wind_down";

export type BroadcastSeason = "spring" | "summer" | "fall" | "winter";

export type BroadcastContext = {
  daypart: BroadcastDaypart;
  season: BroadcastSeason;
  isWeekend: boolean;
  /** Coarse bucket kept for HyperLocalContext compatibility */
  timeOfDay: "morning" | "afternoon" | "evening" | "late_night";
  hour: number;
};

/**
 * Real-time clock / weather fields injected into the DJ *system* prompt.
 * Distinct from {@link BroadcastContext} (daypart/season energy for user briefs).
 */
export type AtmosphericBroadcastContext = {
  timeOfDay: "morning" | "afternoon" | "evening" | "late_night";
  dayOfWeek: string;
  location?: string;
  weather?: string;
};

const DAYPART_COPY: Record<BroadcastDaypart, string> = {
  morning_drive:
    "Morning drive energy — bright, concise, get-them-moving. Coffee-cup urgency without shouting.",
  midday:
    "Midday stretch — easy confidence, keep the booth warm and the pace unhurried.",
  late_afternoon_focus:
    "Late-afternoon focus hour — steady, productive, a little more contemplative than the morning rush.",
  evening:
    "Evening set — looser shoulders, golden-hour warmth, room for a longer breath between thoughts.",
  late_night_wind_down:
    "Late-night wind-down — quieter, intimate, highway-at-1am energy. Soft landings, never frantic.",
};

const SEASON_COPY: Record<BroadcastSeason, string> = {
  spring: "Seasonal colour: early spring thaw — fresh air, lighter references.",
  summer: "Seasonal colour: high summer — windows-down heat, longer light.",
  fall: "Seasonal colour: autumn — crisp air, amber evenings, back-to-school afterglow.",
  winter: "Seasonal colour: deep winter — low light, coat-collar warmth, indoor glow.",
};

function readLocalParts(
  date: Date,
  timeZone?: string,
): { hour: number; month: number; weekday: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || undefined,
      hour: "numeric",
      hourCycle: "h23",
      month: "numeric",
      weekday: "short",
    }).formatToParts(date);

    const hour = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "", 10);
    const month = Number.parseInt(parts.find((p) => p.type === "month")?.value ?? "", 10);
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    if (Number.isFinite(hour) && Number.isFinite(month)) {
      return { hour, month, weekday };
    }
  } catch {
    // Invalid IANA zone — fall through to the host clock.
  }

  return {
    hour: date.getHours(),
    month: date.getMonth() + 1,
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()] ?? "",
  };
}

export function resolveBroadcastSeason(month: number): BroadcastSeason {
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "fall";
  return "winter";
}

export function resolveBroadcastDaypart(hour: number): BroadcastDaypart {
  if (hour >= 5 && hour <= 9) return "morning_drive";
  if (hour >= 10 && hour <= 13) return "midday";
  if (hour >= 14 && hour <= 17) return "late_afternoon_focus";
  if (hour >= 18 && hour <= 21) return "evening";
  return "late_night_wind_down";
}

function daypartToTimeOfDay(
  daypart: BroadcastDaypart,
): BroadcastContext["timeOfDay"] {
  switch (daypart) {
    case "morning_drive":
      return "morning";
    case "midday":
    case "late_afternoon_focus":
      return "afternoon";
    case "evening":
      return "evening";
    case "late_night_wind_down":
      return "late_night";
  }
}

/**
 * Resolve live daypart / season / weekend context for on-air phrasing.
 *
 * Prefers an explicit `hyperLocal.timeOfDay` when the caller already classified
 * the hour; otherwise derives daypart from the clock (and optional IANA zone).
 */
export function resolveBroadcastContext(
  now: Date = new Date(),
  options?: {
    timeZone?: string;
    timeOfDay?: "morning" | "afternoon" | "evening" | "late_night";
  },
): BroadcastContext {
  const { hour, month, weekday } = readLocalParts(now, options?.timeZone);
  const inferred = resolveBroadcastDaypart(hour);
  const daypart =
    options?.timeOfDay === "morning" ? "morning_drive"
    : options?.timeOfDay === "afternoon"
      ? hour >= 14 ? "late_afternoon_focus" : "midday"
    : options?.timeOfDay === "evening" ? "evening"
    : options?.timeOfDay === "late_night" ? "late_night_wind_down"
    : inferred;

  return {
    daypart,
    season: resolveBroadcastSeason(month),
    isWeekend: weekday === "Sat" || weekday === "Sun",
    timeOfDay: daypartToTimeOfDay(daypart),
    hour,
  };
}

/** Prompt lines that shift DJ energy with the listener's clock and calendar. */
export function buildBroadcastContextDirective(
  context: PromptBuilderContext,
  now: Date = new Date(),
): string {
  const broadcast = resolveBroadcastContext(now, {
    timeZone: context.hyperLocal?.timezone,
    timeOfDay: context.hyperLocal?.timeOfDay,
  });

  const parts = [
    `BROADCAST CLOCK — ${DAYPART_COPY[broadcast.daypart]}`,
    SEASON_COPY[broadcast.season],
  ];

  if (broadcast.isWeekend) {
    parts.push(
      "It is the weekend — looser schedule energy, no commute clock. Let the phrasing breathe a little more.",
    );
  } else {
    parts.push("Weekday broadcast — keep the phrasing crisp and on-the-clock.");
  }

  if (context.hyperLocal?.localeLabel) {
    parts.push(`Listener locale colour (use lightly): ${context.hyperLocal.localeLabel}.`);
  }

  parts.push("Never announce the clock math, season name, or that you were given a schedule brief.");
  return parts.join(" ");
}

/**
 * System-prompt block for optional real-time weather / time-of-day injection.
 * Empty string when neither location nor weather is available.
 */
export function buildBroadcastAtmosphereDirective(
  broadcastContext: AtmosphericBroadcastContext,
): string {
  const location = broadcastContext.location?.trim() || "unknown locale";
  const weather = broadcastContext.weather?.trim() || "conditions unavailable";

  return (
    "\nBROADCAST TIMING & ATMOSPHERE:\n"
    + `- Local Time: ${broadcastContext.timeOfDay} (${broadcastContext.dayOfWeek})\n`
    + `- Location & Weather: ${location} (${weather})\n`
    + "- Guidance: Occasionally weave a subtle, natural 3-to-5 word reference to the time of day,"
    + " day of the week, or local weather into the intro if relevant to the vibe"
    + ' (e.g., "Perfect drive home track for a clear Friday evening in Salt Lake City").'
    + " Keep it organic; do not force it into every break."
  );
}

/** Resolve weekday + coarse time-of-day for atmosphere injection. */
export function resolveAtmosphericBroadcastContext(
  now: Date = new Date(),
  options?: {
    timeZone?: string;
    timeOfDay?: AtmosphericBroadcastContext["timeOfDay"];
    location?: string;
    weather?: string;
  },
): AtmosphericBroadcastContext {
  const broadcast = resolveBroadcastContext(now, {
    timeZone: options?.timeZone,
    timeOfDay: options?.timeOfDay,
  });
  const dayOfWeek = (() => {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: options?.timeZone || undefined,
        weekday: "long",
      }).format(now);
    } catch {
      return (
        ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
          now.getDay()
        ] ?? "Today"
      );
    }
  })();

  return {
    timeOfDay: options?.timeOfDay ?? broadcast.timeOfDay,
    dayOfWeek,
    location: options?.location?.trim() || undefined,
    weather: options?.weather?.trim() || undefined,
  };
}

type CommentaryStyle = {
  id: DjHookAngle;
  name: string;
  instruction: string;
};

/** Prompt variation matrix — distinct on-air commentary modes */
export const COMMENTARY_STYLES: readonly CommentaryStyle[] = [
  {
    id: "station_banter",
    name: "Station Banter",
    instruction:
      "Open like you're live on this SongHost curated station right now — station name energy, listener vibe, or what's spinning next on the digital stream. Keep it personal and in-the-moment. NEVER mention FM frequencies, dial numbers, or radio call letters.",
  },
  {
    id: "historical_context",
    name: "Historical Music Context",
    instruction:
      "Drop one sharp piece of era or scene context — release year energy, chart moment, or how this track fit its time. No textbook tone.",
  },
  {
    id: "weather_vibe",
    name: "Weather / Vibe Commentary",
    instruction:
      "Paint the mood — golden-hour windows-down energy, rainy-night studio glow, or late-night highway feel that matches the song. Do NOT recite actual weather data unless provided.",
  },
  {
    id: "listener_shoutout",
    name: "Simulated Listener Shoutout",
    instruction:
      "Give a quick fictional caller or listener shout — 'this one's for everyone still driving home' or 'shout to the night shift' — then roll into the track.",
  },
  {
    id: "album_trivia",
    name: "Album Trivia",
    instruction:
      "Share one specific album or recording-session detail — B-side lore, producer choice, or deep-cut context — then name-drop the song and artist.",
  },
  {
    id: "artist_trivia",
    name: "Artist Deep Cut",
    instruction:
      "Weave in one vivid band lore detail — origin story, legendary live moment, side project, or studio quirk — naturally as radio patter. Never open with 'fun fact', 'did you know', or similar trivia-setup phrases.",
  },
  {
    id: "local_events",
    name: "Local Live Mention",
    instruction:
      "Casually hype the nearby upcoming show using ONLY the event details provided — venue, city, date — then roll into the track. Sound like a friend who heard they're coming to town, not a commercial.",
  },
] as const;

/**
 * Fallback cursor for callers with no session context. Route handlers are shared
 * across listeners and reset on cold start, so prefer the plan's rotation index.
 */
let styleCursor = 0;

const LEGACY_STYLE_MAP: Partial<Record<DjHookAngle, DjHookAngle>> = {
  storyteller: "historical_context",
  opinion_hype: "station_banter",
  production_musician: "album_trivia",
  casual_tease: "listener_shoutout",
};

/**
 * Pick the commentary angle for a break. `rotationIndex` comes from the listener's
 * own scheduler state, so each session walks the matrix independently.
 */
export function pickCommentaryStyle(
  preferred?: DjHookAngle,
  rotationIndex?: number,
): CommentaryStyle {
  const resolved = preferred ? (LEGACY_STYLE_MAP[preferred] ?? preferred) : undefined;
  if (resolved) {
    const match = COMMENTARY_STYLES.find((s) => s.id === resolved);
    if (match) return match;
  }

  if (typeof rotationIndex === "number" && Number.isFinite(rotationIndex)) {
    const index = Math.abs(Math.trunc(rotationIndex)) % COMMENTARY_STYLES.length;
    return COMMENTARY_STYLES[index];
  }

  const style = COMMENTARY_STYLES[styleCursor % COMMENTARY_STYLES.length];
  styleCursor += 1;
  return style;
}

/**
 * Character alone is not enough — spelling out gender, tone, and vibe is what stops
 * every host from converging on the same generic radio voice.
 */
export function buildPersonaDirective(persona: DjPersona): string {
  return (
    `${persona.systemPrompt}` +
    ` HOST PROFILE — stay inside it: name ${persona.name}; gender ${persona.gender};` +
    ` tone ${persona.tone}; vibe ${persona.vibe}.` +
    ` Word choice, rhythm, and attitude must read as this host and nobody else.` +
    ` Refer to yourself only as ${persona.name}, and only when it fits the moment.`
  );
}

/**
 * The era rule the host broadcasts under. Without it a locked station still gets
 * a period-correct playlist but a host who talks about it in retrospect, name-drops
 * later records, and breaks the fiction the lock exists to create.
 */
export function buildEraDirective(era: EraLock | undefined): string {
  if (!era || !isEraLocked(era)) return "";

  const definition = getEraDefinition(era);
  const bounds = eraYearBounds(era);
  if (!bounds) return "";

  return (
    ` ERA LOCK — ABSOLUTE: this station is running ${definition.shortLabel} only,` +
    ` and every song on it was released between ${bounds.startYear} and ${bounds.endYear}.` +
    ` Keep all chart talk, scene references, tour mentions, and cultural asides inside that window.` +
    ` Never name an artist, album, or event from after ${bounds.endYear}, and never frame the era as`
    + ` nostalgia or a throwback — to you and your listeners it is simply now.`
  );
}

/**
 * Listener-authored station direction. Quoted and bounded rather than pasted in
 * as an instruction, so a vibe note steers character instead of overriding the
 * segment brief or the station identity rules.
 *
 * Used by the YouTube `buildSystemPrompt` path and by Spotify Companion lore
 * breaks via {@link buildLoreSystemPrompt}.
 */
export function buildVibeDirective(vibePrompt: string | undefined): string {
  const vibe = sanitizeVibePrompt(vibePrompt);
  if (!vibe) return "";

  return (
    ` STATION VIBE — the listener set this station's direction: "${vibe}".` +
    ` Let it colour your tone, word choice, and the references you reach for.` +
    ` Never read it aloud, quote it, or mention that it was given to you.`
  );
}

/**
 * Lore recap contract: `previousTrack` is the single JUST-finished predecessor
 * (N-1). `recentHistory` is older background context only.
 */
export function buildLorePredecessorDirective(): string {
  return (
    " previousTrack is the single track that JUST finished playing (immediate predecessor N-1)."
    + ' Recap cues such as "That was [Song]..." or "you just heard" MUST name only previousTrack.'
    + " recentHistory entries are older background context from earlier in the session — never the immediately finished track."
  );
}

/**
 * Spotify Companion lore-break extras. Injects {@link buildVibeDirective} so
 * Host Studio custom notes apply on Spotify streams the same way they do on
 * the YouTube `buildSystemPrompt` path.
 */
export function buildLoreSystemPrompt(vibePrompt?: string): string {
  return buildVibeDirective(vibePrompt) + buildLorePredecessorDirective();
}

const VOICE_ENERGY_COPY: Record<NonNullable<VoiceProfileOverride["energy"]>, string> = {
  low: "keep the delivery cool and understated — soft push, never shouty",
  medium: "balanced booth energy — present and confident without overselling",
  high: "lean into bright, punchy radio heat — bigger reactions, quicker lift",
};

const VOICE_ACCENT_COPY: Record<NonNullable<VoiceProfileOverride["accent"]>, string> = {
  neutral: "keep a clear, unplaced broadcast accent",
  american: "colour the phrasing with a general American broadcast cadence",
  british: "lean British — clipped vowels and understated wit where it fits",
  southern: "a light Southern warmth in the rhythm — never a caricature",
  nyc: "a New York edge — quicker consonants, streetwise asides",
  australian: "a light Australian lift in the vowels — relaxed, never cartoon",
};

const VOICE_SNARK_COPY: Record<NonNullable<VoiceProfileOverride["snark"]>, string> = {
  none: "no sarcasm — play it straight and warm",
  light: "a light dry aside is fine, but never mean",
  medium: "comfortable dry wit and gentle roasting of the moment",
  heavy: "lean into sharp, knowing snark — still broadcast-safe, never cruel",
};

const VOICE_PACING_COPY: Record<NonNullable<VoiceProfileOverride["pacing"]>, string> = {
  measured: "speak measured and deliberate — longer pauses between thoughts",
  natural: "keep a natural conversational cadence",
  rapid: "tighten the cadence — shorter bursts, less air between lines",
};

/**
 * Delivery knobs layered on the assigned host. Never replaces the persona —
 * only colours energy, accent, snark, and spoken pacing for this station.
 */
export function buildVoiceProfileDirective(
  voiceProfile: VoiceProfileOverride | undefined,
): string {
  const profile = normalizeVoiceProfileOverride(voiceProfile);
  if (!profile) return "";

  const traits: string[] = [];
  if (profile.energy) traits.push(`energy: ${VOICE_ENERGY_COPY[profile.energy]}`);
  if (profile.accent) traits.push(`accent: ${VOICE_ACCENT_COPY[profile.accent]}`);
  if (profile.snark) traits.push(`snark: ${VOICE_SNARK_COPY[profile.snark]}`);
  if (profile.pacing) traits.push(`spoken pacing: ${VOICE_PACING_COPY[profile.pacing]}`);
  if (!traits.length) return "";

  return (
    ` VOICE TUNING — apply these delivery traits on top of your host profile` +
    ` without changing who you are: ${traits.join("; ")}.` +
    ` Never announce that your voice was tuned, and never name these settings on air.`
  );
}

/** FCC-safe Clean Mode system directive. */
export const CLEAN_BROADCAST_DIRECTIVE =
  "BROADCAST DIRECTIVE: Maintain strict clean radio broadcast standards (FCC compliant). Do not use profanity, vulgarity, or explicit adult references under any circumstances.";

/** Late-night / authentic voice when the listener opted into explicit content. */
export const EXPLICIT_BROADCAST_DIRECTIVE =
  "BROADCAST DIRECTIVE: Explicit content is allowed. You may use natural, authentic late-night radio commentary without strict censorship constraints — still never target or demean a listener.";

/**
 * Clean Mode gate for DJ system prompts.
 * Omitted / false → strict FCC clean standards; true → uncensored late-night voice.
 */
export function buildExplicitContentDirective(allowExplicit?: boolean): string {
  if (allowExplicit === true) {
    return ` ${EXPLICIT_BROADCAST_DIRECTIVE}`;
  }
  return ` ${CLEAN_BROADCAST_DIRECTIVE}`;
}

/**
 * SSML pause tags the LLM may inject for extended commentary formats.
 * Voice dispatch preserves these for ElevenLabs and strips / softens them for OpenAI.
 */
export const SSML_PACING_DIRECTIVE =
  ' SSML PACING: Inject basic SSML pause tags (`<break time="300ms"/>` or'
  + ' `<break time="500ms"/>`) immediately before key revelations or track'
  + " transitions for natural radio pacing. Use only these break tags — no other"
  + " SSML, no nested tags, no attributes besides time.";

const COMMENTARY_FORMAT_DIRECTIVES: Record<
  Exclude<CommentaryFormat, "standard">,
  string
> = {
  roots_branches:
    " COMMENTARY FORMAT — ROOTS & BRANCHES: Target 35–50 words (~12–18s)."
    + " Include chart history, producer credits, or band origins."
    + " Prefer concrete lineage beats when known. Stay punchy, but let one production"
    + " thread carry the break.",
  time_capsule:
    " COMMENTARY FORMAT — SONIC TIME CAPSULE: Target 55–75 words (~20–28s)."
    + " Include era context and release-year cultural highlights — the city, scene,"
    + " clubs, radio, fashion, or cultural weather around the track's moment."
    + " Make the listener feel dropped into that year, then land the song title/artist.",
  directors_cut:
    " COMMENTARY FORMAT — DIRECTOR'S CUT: Target 80–110 words (~30–45+s)."
    + " Enforce a 3-part structure: (1) The Hook, (2) The Deep Lore (studio anecdotes,"
    + " mic setups, session musician facts), and (3) The Segue into the next track."
    + " Speak as radio dialogue, not a sleeve essay. Never invent credits.",
};

/**
 * Extended lore formats from Host Settings. `standard` still gets an explicit
 * short-break word target so Mode A clips stay concise.
 */
export function buildCommentaryFormatDirective(
  format: CommentaryFormat | undefined,
): string {
  const resolved = resolveCommentaryFormat(format);
  if (resolved === "standard") {
    return (
      " COMMENTARY FORMAT — STANDARD: Target 15–25 words (~5–8s)."
      + " Concise track title, artist name, and station ID."
    );
  }
  return COMMENTARY_FORMAT_DIRECTIVES[resolved] + SSML_PACING_DIRECTIVE;
}

/* ------------------------------------------------------------------ *
 * Album deep dive — DJ lore mode
 * ------------------------------------------------------------------ */

export type AlbumLoreAngle = {
  id: "band_dynamics" | "studio_conditions" | "production_gear" | "release_significance" | "sequencing";
  name: string;
  instruction: string;
};

/**
 * The musicologist's rotation.
 *
 * A deep dive puts the host on the same record for eleven straight breaks, and
 * left alone the model will retell the same making-of story every time. Each
 * break is handed exactly one of these angles so the record gets examined from
 * a different side each time it comes back around.
 */
export const ALBUM_LORE_ANGLES: readonly AlbumLoreAngle[] = [
  {
    id: "band_dynamics",
    name: "Band Dynamics",
    instruction:
      "Talk about the people in the room — who was writing, who was barely speaking to whom, whose idea this track was, what the lineup was carrying into the session. Make it human, not a personnel list.",
  },
  {
    id: "studio_conditions",
    name: "Studio Conditions",
    instruction:
      "Put the listener in the room where it was cut — the building, the hours, the takes, the mood of the sessions. Concrete and physical, never a general 'they worked hard on this'.",
  },
  {
    id: "production_gear",
    name: "Production & Gear",
    instruction:
      "Get technical for one beat — the desk, the tape, the mic, the amp, an effect or a studio trick you can actually hear on this track. One detail, explained in a sentence a non-musician follows.",
  },
  {
    id: "release_significance",
    name: "Release-Year Significance",
    instruction:
      "Place the record in its year — what it landed against, what it changed, how it was received when it was new. Tie it to what this specific track was doing.",
  },
  {
    id: "sequencing",
    name: "Sequencing & Flow",
    instruction:
      "Talk about the running order itself — why this track sits where it does, what it does after the one before it, how it sets up the side. This is the deep-dive angle only album radio can do.",
  },
] as const;

/** Rotates the lore angle off the same session counter that drives commentary styles. */
export function pickAlbumLoreAngle(rotationIndex?: number): AlbumLoreAngle {
  if (typeof rotationIndex !== "number" || !Number.isFinite(rotationIndex)) {
    return ALBUM_LORE_ANGLES[0];
  }
  return ALBUM_LORE_ANGLES[Math.abs(Math.trunc(rotationIndex)) % ALBUM_LORE_ANGLES.length];
}

/** Enough of the sleeve for the host to sound informed, short of pasting the whole credit roll. */
const MAX_PERSONNEL_IN_PROMPT = 8;

/** How far ahead in the running order a break is allowed to look. */
const MAX_ALBUM_LOOKAHEAD = 2;

export function formatAlbumPersonnel(album: AlbumContext): string {
  if (!album.personnel.length) return "";
  const listed = album.personnel.slice(0, MAX_PERSONNEL_IN_PROMPT).map(formatAlbumCredit);
  const more = album.personnel.length - listed.length;
  return `${listed.join("; ")}${more > 0 ? `; and ${more} more credited` : ""}`;
}

/**
 * The standing brief for a deep dive, carried in the system prompt so it holds
 * for every break of the session rather than being re-argued per segment.
 *
 * The hard rule here is the invention ban. A host given an album title will
 * happily fabricate a producer, a studio, and a session drummer, and on a show
 * whose entire premise is authority about one record that is the failure mode
 * that matters. The supplied credits are the floor, and anything beyond them
 * has to be genuinely about this record or left unsaid.
 */
export function buildAlbumLoreDirective(album: AlbumContext | undefined): string {
  if (!album) return "";

  const facts: string[] = [];
  if (album.recordingStudio) facts.push(`recorded at ${album.recordingStudio}`);
  if (album.producer) facts.push(`produced by ${album.producer}`);
  if (album.label) facts.push(`released on ${album.label}`);

  const personnel = formatAlbumPersonnel(album);

  return (
    ` ALBUM DEEP DIVE — this whole session is one record: ${describeAlbumRelease(album)}.` +
    ` You are hosting it track by track, in its running order, all ${album.trackList.length} of them.` +
    (facts.length ? ` Confirmed credits: ${facts.join(", ")}.` : "") +
    (personnel ? ` Personnel: ${personnel}.` : "") +
    ` You are the musicologist on this record — talk like someone who has lived with it, not someone reading a sleeve aloud.` +
    ` NEVER read the credits out as a list, and never recite the tracklist.` +
    ` ACCURACY IS ABSOLUTE: never invent a producer, engineer, studio, session player, chart position, or piece of gear.` +
    ` Every session, band, or equipment detail you offer must genuinely belong to this record — if you are not sure, stay with what the credits above give you.` +
    ` Never claim a song from another album is on this one, and never frame the set as a shuffle, a mix, or a rotation — the listener is hearing one record in order.` +
    CONCISE_DJ_RULE +
    ` Album opening sign-on: 35 to 45 words max (2 to 3 punchy sentences), single core lore nugget.` +
    ` Mid-session album track breaks: 20 to 30 words max (1 to 2 short sentences), one lore angle only.`
  );
}

/**
 * The per-break album brief: where the needle is, what it just came off, what
 * it lands on next, and which angle this break is working.
 */
export function buildAlbumSegmentBrief(
  album: AlbumContext,
  current: DjTrackContext | undefined,
  rotationIndex?: number,
): string[] {
  const parts: string[] = [`ALBUM DEEP DIVE — the record is ${describeAlbumRelease(album)}.`];
  const total = album.trackList.length;
  const index = current ? findAlbumTrackIndex(album, current.title) : -1;

  if (index >= 0) {
    const entry = album.trackList[index];
    const side = entry.side ? ` on side ${entry.side}` : "";
    parts.push(`Now cueing track ${entry.position} of ${total}${side}: "${entry.title}".`);

    if (index > 0) {
      parts.push(`It follows "${album.trackList[index - 1].title}" — the transition is fair game.`);
    } else {
      parts.push("This is the opening track — you are dropping the needle on side one.");
    }

    const ahead = album.trackList.slice(index + 1, index + 1 + MAX_ALBUM_LOOKAHEAD);
    if (ahead.length) {
      parts.push(`Still to come: ${ahead.map((t) => `"${t.title}"`).join(", ")}.`);
    } else {
      parts.push("This is the closing track — the record ends here.");
    }

    if (entry.note) {
      parts.push(`Verified note on this track — work it in, do not read it verbatim: ${entry.note}`);
    }
  }

  if (album.releaseYear) {
    parts.push(
      `Everything you say about this record sits in ${album.releaseYear} and what led up to it.`,
    );
  }

  const angle = pickAlbumLoreAngle(rotationIndex);
  parts.push(`Lore angle for this break — "${angle.name}": ${angle.instruction}`);
  parts.push(
    "One angle only. Do not try to cover the whole record in this break." +
      " Stay inside the hard word limit for this break — one fascinating fact, then yield to the music.",
  );

  return parts;
}

/**
 * Negative-prompt block for the Anti-Repetition Fact Engine.
 * Empty / omitted `excludedFacts` yields an empty string (no directive).
 */
export function buildAntiRepetitionDirective(excludedFacts?: string[]): string {
  const topics = (excludedFacts ?? [])
    .map((fact) => fact.trim())
    .filter((fact) => fact.length > 0);
  if (!topics.length) return "";

  const bulletList = topics.map((topic) => `- ${topic}`).join("\n");
  return (
    " ANTI-REPETITION DIRECTIVE: The listener has ALREADY heard the following trivia" +
    " points for this artist/album. DO NOT reference or repeat these topics under any" +
    ` circumstances:\n${bulletList}\n` +
    " Focus your commentary on a completely fresh angle (e.g. production technique," +
    " lyrical origin, side personnel, or cultural scene background)."
  );
}

export function buildSystemPrompt(context: PromptBuilderContext): string {
  const custom = context.customPersonaPrompt?.trim();
  const persona =
    (context.personaId ? getPersonaById(context.personaId) : undefined) ?? DEFAULT_PERSONA;
  const basePrompt = custom || buildPersonaDirective(persona);

  const extraBans =
    context.bannedOpeners?.length ?
      ` Also avoid: ${context.bannedOpeners.map((p) => `'${p}'`).join(", ")}.`
    : "";

  return (
    basePrompt +
    STATION_IDENTITY_RULE +
    buildEraDirective(context.eraLock) +
    buildVibeDirective(context.vibePrompt) +
    buildVoiceProfileDirective(context.voiceProfile) +
    buildAlbumLoreDirective(context.albumContext) +
    buildMusicologyDirective() +
    INVENTION_BAN_RULE +
    buildExplicitContentDirective(context.allowExplicit) +
    CONCISE_DJ_RULE +
    OPENING_WORD_LIMIT_RULE +
    MID_SESSION_WORD_LIMIT_RULE +
    // Extended formats (Director's Cut, etc.) intentionally follow the hard
    // length rules so they can relax them without being overwritten.
    buildCommentaryFormatDirective(context.commentaryFormat) +
    SEGMENT_AUTHORITY_RULE +
    TTS_DIALOGUE_RULES +
    TTS_FORMAT_RULES +
    extraBans +
    buildAntiRepetitionDirective(context.excludedFacts)
  );
}

/**
 * Primary DJ script prompt builder — system + user messages for `/api/generate-script`.
 * Accepts optional `excludedFacts` for Anti-Repetition Fact Engine negative injection
 * and optional `broadcastContext` for real-time weather / time-of-day atmosphere.
 */
export function buildDjScriptPrompt(
  context: PromptBuilderContext,
  options?: {
    excludedFacts?: string[];
    broadcastContext?: AtmosphericBroadcastContext;
  },
): { system: string; user: string } {
  const excludedFacts = options?.excludedFacts ?? context.excludedFacts;
  const merged: PromptBuilderContext = {
    ...context,
    excludedFacts,
  };
  let system = buildSystemPrompt(merged);
  if (options?.broadcastContext) {
    system += buildBroadcastAtmosphereDirective(options.broadcastContext);
  }
  return {
    system,
    user: buildUserPrompt(merged),
  };
}

export function buildUserPrompt(context: PromptBuilderContext): string {
  if (context.segmentPlan) {
    return buildSegmentUserPrompt(context.segmentPlan, context);
  }

  const style = pickCommentaryStyle(context.hookAngle);
  const { title, artist, album } = context.track;

  // Legacy path has no segment plan — treat as a mid-session break.
  const parts = [
    `Introduce "${title}" by ${artist}.`,
    `Use the "${style.name}" commentary style: ${style.instruction}`,
    `Keep it under ${context.maxDurationSeconds} seconds when spoken.`,
    buildBreakLengthDirective({ isSessionOpening: false }),
  ];

  if (context.albumContext) {
    parts.push(...buildAlbumSegmentBrief(context.albumContext, context.track));
  } else if (album) {
    parts.push(`Album context: "${album}".`);
  }
  parts.push(`${stationIdentityLine(context)} Stay in station voice.`);

  const trivia = buildTriviaDensityDirective(context.talkLevel, {
    isDeepDive: Boolean(context.albumContext),
  });
  if (trivia) parts.push(trivia.trim());

  parts.push(...buildLoreHistoryPromptLines(context));
  if (context.upcomingQueue?.length) {
    parts.push(
      `Coming up next — optional teaser: ${formatTrackList(context.upcomingQueue)}.` +
        ' Example vibe: "Coming up next we have Song C..."',
    );
  }
  if (context.localEvent) {
    parts.push(formatLocalEventAside(context.localEvent));
  }
  parts.push(buildBroadcastContextDirective(context));
  if (context.hyperLocal?.weatherSummary) {
    parts.push(`Weather mood (use subtly): ${context.hyperLocal.weatherSummary}.`);
  }

  return parts.join(" ");
}

function formatTrackList(tracks: { title: string; artist: string }[]): string {
  return tracks.map((t) => `"${t.title}" by ${t.artist}`).join("; ");
}

function sameLoreTrack(
  a: { title: string; artist: string },
  b: { title: string; artist: string },
): boolean {
  return a.title === b.title && a.artist === b.artist;
}

/**
 * User-prompt lines that pin recap cues to the immediate predecessor (N-1)
 * and keep older `recentHistory` as background only.
 */
export function buildLoreHistoryPromptLines(context: {
  previousTrack?: { title: string; artist: string };
  recentHistory?: { title: string; artist: string }[];
}): string[] {
  const previous =
    context.previousTrack
    ?? (context.recentHistory?.length
      ? context.recentHistory[context.recentHistory.length - 1]
      : undefined);
  const older = (context.recentHistory ?? []).filter(
    (track) => !previous || !sameLoreTrack(track, previous),
  );
  const parts: string[] = [];
  if (previous) {
    parts.push(
      `previousTrack (JUST finished — the single immediate predecessor N-1): "${previous.title}" by ${previous.artist}.`
        + ' Recap cues like "That was [Song]..." or "you just heard" MUST name only this track.',
    );
  }
  if (older.length) {
    parts.push(
      `recentHistory (older background context only — NOT the track that just finished; do not frame these as "you just heard"): ${formatTrackList(older)}.`,
    );
  }
  return parts;
}

/**
 * @deprecated FM dial announcements are banned — always returns undefined.
 * Kept so older callers compile without inventing dial copy.
 */
export function formatStationFrequency(frequency?: number): string | undefined {
  void frequency;
  return undefined;
}

/**
 * The only station identity the DJ is allowed to use. Always emitted so the model
 * never reaches for call letters or an FM dial number.
 */
export function stationIdentityLine(context: PromptBuilderContext): string {
  const name = context.stationName?.trim() || "SongHost";
  const era = isEraLocked(context.eraLock)
    ? ` It is a ${getEraDefinition(context.eraLock).shortLabel} curated station — stay inside that era.`
    : "";
  return (
    `You are live on the SongHost digital stream "${name}" — that is the ONLY station or genre title you may say.` +
    ` NEVER mention FM frequencies, dial numbers, or radio call letters.${era}`
  );
}

/**
 * Tag-on concert mention for breaks whose subject is something else. `local_events`
 * segments feature the show instead, so they build their own copy.
 */
export function formatLocalEventAside(event: LocalConcertEvent): string {
  return (
    `LOCAL SHOW HEADS-UP: ${event.artist} plays ${event.venue} in ${event.city} on ${event.dateLabel}. ` +
    'Slip this in near the end as a quick aside — something like "and heads up, they\'re at [venue] on [date]". ' +
    "Use ONLY these details. Never invent ticket prices, support acts, or a second date."
  );
}

function segmentTakesLocalEventAside(kind: DjSegmentKind): boolean {
  return kind !== "stinger" && kind !== "local_events";
}

/**
 * Signing on to a listener-built station. Without this the DJ opens every saved
 * mix as if it were a house channel the listener happened to tune into.
 */
function savedStationOpeningLines(stationName?: string): string[] {
  const label = stationName ? `"${stationName}"` : "this mix";
  return [
    `PERSONAL STATION SIGN-ON — ${label} is the listener's own saved mix. They picked these songs, named the curated station, and saved it as a SongHost digital stream.`,
    "Open by acknowledging it as their custom mix and welcoming them back to it.",
    "Never call it a preset, a house channel, or one of ours. NEVER mention FM frequencies, dial numbers, or radio call letters.",
  ];
}

export function buildSegmentUserPrompt(
  plan: DjSegmentPlan,
  context: PromptBuilderContext,
): string {
  const parts: string[] = [];
  const current = plan.announceTracks[plan.announceTracks.length - 1];

  parts.push(stationIdentityLine(context));
  parts.push(`Keep it under ${plan.maxDurationSeconds} seconds when spoken.`);
  parts.push(
    buildBreakLengthDirective({
      isSessionOpening: plan.isSessionOpening,
      kind: plan.kind,
    }),
  );

  if (context.isUserSavedStation && plan.isSessionOpening) {
    parts.push(...savedStationOpeningLines(context.stationName));
  }

  // A stinger is a station ID and nothing else — handing it the record would
  // turn a three-second sweeper into a song intro.
  const album = plan.kind === "stinger" ? undefined : context.albumContext;
  if (album) {
    parts.push(...buildAlbumSegmentBrief(album, current, plan.styleRotationIndex));
    if (plan.isSessionOpening) {
      parts.push(
        `ALBUM SIGN-ON — open by telling the listener what record they are about to hear end to end, then start it.` +
          ` Hard cap: 35 to 45 words, one core lore nugget, then drop the needle.`,
      );
    }
  }

  switch (plan.kind) {
    case "recap": {
      const recap = plan.recapTracks?.length ? plan.recapTracks : plan.announceTracks.slice(0, -1);
      const recapList = recap ?? [];
      parts.push(
        `RECAP SEGMENT — this is a look back at a run of songs, not a single track intro.`,
        `You just played ${recapList.length} track${recapList.length === 1 ? "" : "s"} back to back: ${formatTrackList(recapList)}.`,
        "Recap that run as a set — react to the stretch of music as a whole.",
        `Then hand off into "${current.title}" by ${current.artist}.`,
        "Do NOT introduce the earlier songs one at a time.",
      );
      break;
    }
    case "up_next": {
      const preview = plan.upNextTracks?.length
        ? formatTrackList(plan.upNextTracks)
        : null;
      parts.push(
        `UP-NEXT SEGMENT — the point of this break is what's coming, not what's here.`,
        `Land briefly on "${current.title}" by ${current.artist}, then look ahead.`,
      );
      if (preview) {
        parts.push(`Tease what's queued: ${preview}.`);
      }
      parts.push("End on 'stay with us' energy.");
      break;
    }
    case "artist_trivia": {
      const style = COMMENTARY_STYLES.find((s) => s.id === "artist_trivia");
      parts.push(
        `ARTIST DEEP CUT — lead with specific musicology lore about ${current.artist}.`,
        style?.instruction ??
          "Drop one natural piece of band lore, then roll the track.",
        "Be concrete: a real detail, not a general compliment about the band.",
        `Land on "${current.title}" by ${current.artist} at the end.`,
      );
      break;
    }
    case "local_events": {
      const style = COMMENTARY_STYLES.find((s) => s.id === "local_events");
      const event = plan.localEvent ?? context.localEvent;
      if (event) {
        parts.push(
          `LOCAL SHOW SEGMENT — the nearby gig is the point of this break.`,
          `${event.artist} plays ${event.venue} in ${event.city} on ${event.dateLabel}.`,
          "Use ONLY those details — never invent a venue, date, support act, or ticket info.",
        );
        if (plan.listenerCity ?? context.listenerCity) {
          parts.push(`Listener area: ${plan.listenerCity ?? context.listenerCity}.`);
        }
      }
      parts.push(
        style?.instruction ?? "Mention the show casually, then roll the song.",
        `Roll into "${current.title}" by ${current.artist}.`,
      );
      break;
    }
    case "stinger": {
      const station = context.stationName?.trim() || "SongHost";
      parts.push(
        "STATION STINGER — this is NOT a song intro.",
        `Deliver a tight ${plan.maxDurationSeconds}-second station-ID sweeper for the SongHost digital stream "${station}".`,
        `Use that exact curated station or genre title — "${station}" — and nothing else.`,
        "NEVER mention FM frequencies, dial numbers, or radio call letters.",
        "Do NOT mention any song, artist, album, or what is playing next. One short line only.",
      );
      break;
    }
    case "song_intro":
    default: {
      const style = pickCommentaryStyle(context.hookAngle, plan.styleRotationIndex);
      parts.push(
        `SONG INTRO — commentary style for this break: "${style.name}".`,
        style.instruction,
        `Work in "${current.title}" by ${current.artist}.`,
      );
      if (!album && current.album) parts.push(`Album context: "${current.album}".`);
      break;
    }
  }

  // Stingers are pure station ID; local-events segments lead with the gig.
  // Everything else (intros, trivia, recaps, up-next) gets pacing-aware lore.
  const triviaKinds: DjSegmentKind[] = [
    "song_intro",
    "artist_trivia",
    "recap",
    "up_next",
  ];
  if (triviaKinds.includes(plan.kind)) {
    const trivia = buildTriviaDensityDirective(context.talkLevel, {
      isDeepDive: Boolean(album),
      rotationIndex: plan.styleRotationIndex,
      isSessionOpening: plan.isSessionOpening,
    });
    if (trivia) parts.push(trivia.trim());
  }

  // Companion history/queue context — skip when the segment kind already owns
  // that beat (recap / up_next) or when this is a pure station stinger.
  if (plan.kind !== "stinger" && plan.kind !== "recap") {
    parts.push(...buildLoreHistoryPromptLines(context));
  }
  if (plan.kind !== "stinger" && plan.kind !== "up_next" && context.upcomingQueue?.length) {
    parts.push(
      `Coming up next — optional teaser: ${formatTrackList(context.upcomingQueue)}.` +
        ' Example vibe: "Coming up next we have Song C..."',
    );
  }

  const asideEvent = plan.localEvent ?? context.localEvent;
  if (asideEvent && segmentTakesLocalEventAside(plan.kind)) {
    parts.push(formatLocalEventAside(asideEvent));
  }

  parts.push(buildBroadcastContextDirective(context));

  return parts.join(" ");
}

/** Reset style rotation (useful in tests) */
export function resetCommentaryStyleRotation(): void {
  styleCursor = 0;
}
