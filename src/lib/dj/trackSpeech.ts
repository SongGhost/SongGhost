/**
 * Shared radio-name sanitizer for DJ-spoken song/artist copy.
 *
 * Queue metadata and YouTube titles stay raw. Only spoken scripts, LLM
 * prompts, and Broadcast Log / teleprompter transcript text go through here.
 */

export type SpeechTrack = {
  artist: string;
  title: string;
};

type SpeechTrackInput = {
  artist?: string | null;
  title?: string | null;
};

/** Bracketed upload tags: [HD], [HD Remaster], [Official Video], [4K]. */
const BRACKET_TAG_RE = /\s*\[[^\]]*\]/g;

/**
 * Parenthetical upload / quality tags. Keeps structural titles such as
 * (Pt. 2), (Radio Edit), and (feat. …).
 */
const QUALITY_PAREN_RE =
  /\s*\(\s*(?:official(?:\s+(?:music\s+)?video|\s+audio|\s+lyric(?:s)?(?:\s+video)?)?|(?:music\s+)?video|lyric(?:s)?(?:\s+video)?|audio|visualizer|colorized|remaster(?:ed)?(?:\s+\d{4})?|hd(?:\s+remaster(?:ed)?)?|hq|4k|8k|1080p|720p|480p|mv)\s*\)/gi;

/** Trailing dashed quality dumps: " - HD Remaster", " — Official Video". */
const TRAILING_QUALITY_RE =
  /\s*[-–—:]\s*(?:official(?:\s+(?:music\s+)?video|\s+audio|\s+lyric(?:s)?(?:\s+video)?)?|lyric(?:s)?(?:\s+video)?|audio|visualizer|hd(?:\s+remaster(?:ed)?)?|hq|4k|8k|1080p|720p|480p|remaster(?:ed)?)\s*$/gi;

const TRAILING_QUALITY_TOKEN_RE = /\s+\b(?:4k|8k|hd|hq|1080p|720p|480p|mv)\s*$/gi;

function cleanLabel(raw: string): string {
  let text = raw.trim();
  if (!text) return "";

  text = text.replace(BRACKET_TAG_RE, "");
  text = text.replace(QUALITY_PAREN_RE, "");
  text = text.replace(TRAILING_QUALITY_RE, "");
  text = text.replace(TRAILING_QUALITY_TOKEN_RE, "");
  text = text.replace(/[\u2026]/g, "");
  text = text.replace(/\.{2,}/g, "");
  text = text.replace(/["“”]/g, "");
  text = text.replace(/[|•·]/g, " ");
  text = text.replace(/[[\]{}]/g, "");
  text = text.replace(/\s*\(\s*\)/g, "");
  text = text.replace(/\s*[-–—:/]+\s*$/g, "");
  return text.replace(/\s+/g, " ").trim();
}

function normalizeSpeechName(value: string): string {
  return value
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function labelsMatch(left: string, right: string): boolean {
  const a = normalizeSpeechName(left);
  const b = normalizeSpeechName(right);
  return Boolean(a && b && a === b);
}

function splitArtistTitle(
  title: string,
): { artist: string; title: string } | null {
  const parts = title.split(/\s+[-–—]\s+/);
  if (parts.length < 2) return null;
  const artist = parts[0]?.trim() ?? "";
  const rest = parts.slice(1).join(" - ").trim();
  if (!artist || !rest) return null;
  return { artist, title: rest };
}

/**
 * Structured artist + title for spoken copy. Does not invent a song name.
 * When the title is a YouTube "Artist - Song" dump and the left side matches
 * the structured artist, only the song portion is kept.
 */
export function cleanTrackForSpeech(track: SpeechTrackInput): SpeechTrack {
  let artist = cleanLabel(track.artist ?? "");
  let title = cleanLabel(track.title ?? "");

  const split = splitArtistTitle(title);
  if (split) {
    if (artist && labelsMatch(artist, split.artist)) {
      title = split.title;
    } else if (!artist) {
      artist = split.artist;
      title = split.title;
    }
  }

  return { artist, title };
}

/** Same as {@link cleanTrackForSpeech} — radio names, not a filename dump. */
export function formatTrackForDj(track: SpeechTrackInput): SpeechTrack {
  return cleanTrackForSpeech(track);
}

/** Natural "Title by Artist" phrase for prompts and templated lines. */
export function formatTrackByline(track: SpeechTrackInput): string {
  const { artist, title } = cleanTrackForSpeech(track);
  if (title && artist) return `${title} by ${artist}`;
  return title || artist || "this one";
}

/**
 * One sentence terminator. Collapses "B.I.G.." so TTS does not say "dot dot".
 */
export function finishSpokenSentence(text: string): string {
  let spoken = text.replace(/\s+/g, " ").trim();
  if (!spoken) return spoken;
  spoken = spoken.replace(/([A-Za-z]\.)\.$/g, "$1");
  spoken = spoken.replace(/([.!?])\.$/g, "$1");
  if (!/[.!?]$/.test(spoken) && !/\.\.\.$/.test(spoken) && !/…$/.test(spoken)) {
    spoken += ".";
  }
  return spoken;
}

export function applySpeechFields<T extends { title: string; artist: string }>(
  track: T,
): T {
  const cleaned = cleanTrackForSpeech(track);
  return { ...track, title: cleaned.title, artist: cleaned.artist };
}

export function sanitizeSpeechTracks<T extends { title: string; artist: string }>(
  tracks: T[] | undefined,
): T[] | undefined {
  return tracks?.map(applySpeechFields);
}

export function sanitizeDjSegmentPlan<
  T extends {
    announceTracks: { title: string; artist: string }[];
    recapTracks?: { title: string; artist: string }[];
    upNextTracks?: { title: string; artist: string }[];
  },
>(plan: T): T {
  return {
    ...plan,
    announceTracks: plan.announceTracks.map(applySpeechFields),
    recapTracks: sanitizeSpeechTracks(plan.recapTracks),
    upNextTracks: sanitizeSpeechTracks(plan.upNextTracks),
  };
}
