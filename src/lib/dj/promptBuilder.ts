/**
 * DJ prompt variety engine — rotates commentary styles and enforces banned tropes.
 */

import { DEFAULT_PERSONA, getPersonaById } from "@/data/personas";
import type { DJPromptContext, DjHookAngle, DjSegmentPlan } from "@/types/dj";

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

const BANNED_OPENERS_RULE = ` STRICTLY FORBIDDEN openers and phrases: ${BANNED_OPENER_PHRASES.map((p) => `'${p}'`).join(", ")}. Never start with trivia-setup lines or lazy segues.`;

const TTS_FORMAT_RULES = ` PUNCTUATION FOR TTS: Use ellipses (...) for natural breath pauses between thoughts. Use em-dashes (—) for casual mid-sentence pivots. Keep EVERY sentence under 12 words — short bursts sound alive on radio. No run-on sentences.${BANNED_OPENERS_RULE}`;

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
      "Open like you're live on this station right now — quick frequency callout energy, listener vibe, or what's spinning next on the dial. Keep it personal and in-the-moment.",
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

let styleCursor = 0;

const LEGACY_STYLE_MAP: Partial<Record<DjHookAngle, DjHookAngle>> = {
  storyteller: "historical_context",
  opinion_hype: "station_banter",
  production_musician: "album_trivia",
  casual_tease: "listener_shoutout",
};

/** Round-robin style picker for even rotation across intros */
export function pickCommentaryStyle(preferred?: DjHookAngle): CommentaryStyle {
  const resolved = preferred ? (LEGACY_STYLE_MAP[preferred] ?? preferred) : undefined;
  if (resolved) {
    const match = COMMENTARY_STYLES.find((s) => s.id === resolved);
    if (match) return match;
  }

  const style = COMMENTARY_STYLES[styleCursor % COMMENTARY_STYLES.length];
  styleCursor += 1;
  return style;
}

export function buildSystemPrompt(context: DJPromptContext): string {
  const persona = context.personaId ? getPersonaById(context.personaId) : undefined;
  const basePrompt =
    persona?.systemPrompt ??
    context.customPersonaPrompt?.trim() ??
    DEFAULT_PERSONA.systemPrompt;

  const extraBans =
    context.bannedOpeners?.length ?
      ` Also avoid: ${context.bannedOpeners.map((p) => `'${p}'`).join(", ")}.`
    : "";

  return basePrompt + TTS_DIALOGUE_RULES + TTS_FORMAT_RULES + extraBans;
}

export function buildUserPrompt(context: DJPromptContext): string {
  if (context.segmentPlan) {
    return buildSegmentUserPrompt(context.segmentPlan, context);
  }

  const style = pickCommentaryStyle(context.hookAngle);
  const { title, artist, album } = context.track;

  const parts = [
    `Introduce "${title}" by ${artist}.`,
    `Use the "${style.name}" commentary style: ${style.instruction}`,
    `Keep it under ${context.maxDurationSeconds} seconds when spoken.`,
  ];

  if (album) parts.push(`Album context: "${album}".`);
  if (context.stationName) {
    parts.push(`You are on "${context.stationName}" — stay in station voice.`);
  }
  if (context.previousTrack) {
    parts.push(
      `Previous track was "${context.previousTrack.title}" by ${context.previousTrack.artist} — optional quick transition only.`,
    );
  }
  if (context.hyperLocal?.timeOfDay) {
    parts.push(`Time-of-day vibe: ${context.hyperLocal.timeOfDay}.`);
  }
  if (context.hyperLocal?.weatherSummary) {
    parts.push(`Weather mood (use subtly): ${context.hyperLocal.weatherSummary}.`);
  }

  return parts.join(" ");
}

function formatTrackList(tracks: { title: string; artist: string }[]): string {
  return tracks.map((t) => `"${t.title}" by ${t.artist}`).join("; ");
}

export function buildSegmentUserPrompt(plan: DjSegmentPlan, context: DJPromptContext): string {
  const parts: string[] = [];
  const current = plan.announceTracks[plan.announceTracks.length - 1];
  const stationLine = context.stationName
    ? `You are live on "${context.stationName}".`
    : "You are live on the radio.";

  parts.push(stationLine);
  parts.push(`Keep it under ${plan.maxDurationSeconds} seconds when spoken.`);

  switch (plan.kind) {
    case "recap": {
      const recap = plan.recapTracks?.length ? plan.recapTracks : plan.announceTracks.slice(0, -1);
      parts.push(
        `RECAP SEGMENT: You just spun ${formatTrackList(recap ?? [])}.`,
        `Now introduce the current track: "${current.title}" by ${current.artist}.`,
        "Sound like a real DJ between songs — quick energy, maybe a weekend vibe or 'how about that run of tracks' feel.",
      );
      break;
    }
    case "up_next": {
      const preview = plan.upNextTracks?.length
        ? formatTrackList(plan.upNextTracks)
        : null;
      parts.push(
        `UP-NEXT SEGMENT: Introduce "${current.title}" by ${current.artist} now playing.`,
      );
      if (preview) {
        parts.push(`Tease what's coming up next on the queue: ${preview}.`);
      }
      parts.push("Keep it forward-looking — 'stay with us' energy.");
      break;
    }
    case "artist_trivia": {
      const style = COMMENTARY_STYLES.find((s) => s.id === "artist_trivia");
      parts.push(
        `Introduce "${current.title}" by ${current.artist}.`,
        style?.instruction ??
          "Drop one natural piece of band lore, then roll the track.",
      );
      break;
    }
    case "local_events": {
      const style = COMMENTARY_STYLES.find((s) => s.id === "local_events");
      const event = plan.localEvent ?? context.localEvent;
      if (event) {
        parts.push(
          `LOCAL SHOW: ${event.artist} plays ${event.venue} in ${event.city} on ${event.dateLabel}.`,
        );
        if (plan.listenerCity ?? context.listenerCity) {
          parts.push(`Listener area: ${plan.listenerCity ?? context.listenerCity}.`);
        }
      }
      parts.push(
        `Introduce "${current.title}" by ${current.artist}.`,
        style?.instruction ?? "Mention the show casually, then roll the song.",
      );
      break;
    }
    default: {
      const style = pickCommentaryStyle(context.hookAngle);
      parts.push(
        `Introduce "${current.title}" by ${current.artist}.`,
        `Use the "${style.name}" commentary style: ${style.instruction}`,
      );
    }
  }

  if (context.hyperLocal?.timeOfDay) {
    parts.push(`Time-of-day vibe: ${context.hyperLocal.timeOfDay}.`);
  }

  return parts.join(" ");
}

/** Reset style rotation (useful in tests) */
export function resetCommentaryStyleRotation(): void {
  styleCursor = 0;
}
