/**
 * AI Curator prompt and the honesty checks around the model's list.
 * The model is asked for up to 25 real songs. Pads, repeats, and invented
 * fillers are dropped here so a short honest list stays short.
 */

export const CURATE_TRACK_CAP = 25;
export const CURATE_MAX_TOKENS = 2500;
/** First ask can wander inside the prompt. A repeat stays cooler so the scene holds. */
export const CURATE_TEMPERATURE = 0.85;
export const CURATE_REPEAT_TEMPERATURE = 0.4;

export type CuratedSongRef = {
  title: string;
  artist: string;
};

const PAD_TITLE =
  /^(song|track|title|placeholder|filler|untitled|tbd|n a|na|unknown|test|fake|invented|dummy)(\s+\d+)?$/i;
const PAD_ARTIST =
  /^(artist|various artists|unknown artist|unknown|placeholder|filler|tbd|n a|na|fake|invented|dummy)(\s+\d+)?$/i;
const PAD_PHRASE =
  /\b(placeholder|filler track|invented title|not a real song|lorem ipsum)\b/i;

export function curatedSongKey(song: CuratedSongRef): string {
  const squash = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return `${squash(song.artist)}::${squash(song.title)}`;
}

export function isPaddedCuratedSong(song: CuratedSongRef): boolean {
  const title = song.title.trim();
  const artist = song.artist.trim();
  if (!title || !artist) return true;
  if (PAD_TITLE.test(title) || PAD_ARTIST.test(artist)) return true;
  if (PAD_PHRASE.test(title) || PAD_PHRASE.test(artist)) return true;
  if (/^(song|track)\s+\d+$/i.test(title)) return true;
  return false;
}

export function parsePreviousTitles(value: unknown): CuratedSongRef[] {
  if (!Array.isArray(value)) return [];
  const out: CuratedSongRef[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const title = "title" in row && typeof row.title === "string" ? row.title.trim() : "";
    const artist = "artist" in row && typeof row.artist === "string" ? row.artist.trim() : "";
    if (!title || !artist) continue;
    out.push({ title, artist });
  }
  return out;
}

const ARTIST_LEAD = /^(?:artists?\s+like|like|similar to|in the style of|in the vein of)\s+/i;
const SCENE_HINT =
  /\b(?:19|20)\d{2}s?\b|\b(?:rainy|monday|tuesday|wednesday|thursday|friday|saturday|sunday|night|morning|drive|vibe|mood|indie|hip[\s-]?hop|rap|country|jazz|atlanta|playlist|genre|decade|summer|winter|dusk|highway|scene)\b/i;

/** One named artist uses that neighborhood. A scene or genre does not. */
export function curatorPromptTarget(
  prompt: string,
): { kind: "artist"; artist: string } | { kind: "scene" } {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  if (!trimmed) return { kind: "scene" };
  const lead = ARTIST_LEAD.test(trimmed);
  const artist = trimmed.replace(ARTIST_LEAD, "").replace(/[?.!]+$/g, "").trim();
  if (!artist) return { kind: "scene" };
  if (lead && !SCENE_HINT.test(artist)) return { kind: "artist", artist };
  if (!lead && !SCENE_HINT.test(trimmed)) {
    const words = artist.split(" ");
    if (words.length >= 1 && words.length <= 6) return { kind: "artist", artist };
  }
  return { kind: "scene" };
}

export function withNeighborhoodDescription(description: string, count: number, target = 50): string {
  const vibe = description.trim();
  if (count >= target) return vibe;
  const note =
    count <= 0
      ? `Fewer than ${target} songs truly fit, and no different real songs were left.`
      : `Fewer than ${target} songs truly fit, so this station has ${count}.`;
  if (vibe.toLowerCase().includes("fewer than")) return vibe;
  if (!vibe) return note;
  const lead = /[.!?]$/.test(vibe) ? vibe : `${vibe}.`;
  return `${lead} ${note}`;
}

export function buildCurateSystemPrompt(personaRosterLine: string, scene?: string): string {
  const locked = scene?.trim();
  const sceneLock = locked
    ? ` SCENE LOCK: This is a repeat of "${locked}". Every song must fit that same decade, genre, mood, and scene. Do not change decade or genre. Do not drift to a different kind of act. Different real songs only.`
    : "";
  return `You are an expert music curator for SongHost, a digital stream / curated station app. NEVER mention FM frequencies, dial numbers, or radio call letters. Given a user prompt, return a JSON object with:
- "name": short station name (max 40 chars)
- "description": one-line vibe description. When you return fewer than ${CURATE_TRACK_CAP} songs, say in this description that fewer than ${CURATE_TRACK_CAP} songs truly fit.
- "personaId": one of: ${personaRosterLine}
- "accentColor": hex color matching the vibe (e.g. #F2AD4A)
- "tracks": array of up to ${CURATE_TRACK_CAP} objects with "title" and "artist" — real songs that truly fit this prompt. If there are not ${CURATE_TRACK_CAP} honest matches, return fewer. Never invent titles to fill the count. Never pad with songs that do not fit.${sceneLock}

Return ONLY valid JSON, no markdown.`;
}

export function buildCurateUserContent(
  prompt: string,
  previous: readonly CuratedSongRef[],
): string {
  const trimmed = prompt.trim();
  if (previous.length === 0) return trimmed;

  const lines = previous
    .filter((song) => song.artist.trim() && song.title.trim())
    .map((song) => `- ${song.artist.trim()} — ${song.title.trim()}`)
    .join("\n");

  return `${trimmed}

The listener asked again for this same station. SCENE LOCK: stay inside "${trimmed}" — the same era, mood, and scene. Do not change decade or genre. Name different real songs. Do not repeat any of these:
${lines}
If you cannot find different real songs that still fit, return the shorter list and say so in the description. Do not invent titles to fill the count.`;
}

export function selectHonestCuratedTracks(
  raw: readonly { title?: string; artist?: string }[] | undefined,
  previous: readonly CuratedSongRef[],
  cap = CURATE_TRACK_CAP,
): { tracks: CuratedSongRef[]; droppedRepeats: boolean } {
  const previousKeys = new Set(
    previous.map((song) => curatedSongKey(song)).filter((key) => key !== "::"),
  );
  const seen = new Set<string>();
  const tracks: CuratedSongRef[] = [];
  let droppedRepeats = false;

  for (const row of raw ?? []) {
    const title = typeof row?.title === "string" ? row.title.trim() : "";
    const artist = typeof row?.artist === "string" ? row.artist.trim() : "";
    if (!title || !artist) continue;
    const song = { title, artist };
    if (isPaddedCuratedSong(song)) continue;
    const key = curatedSongKey(song);
    if (!key || key === "::" || seen.has(key)) continue;
    if (previousKeys.has(key)) {
      droppedRepeats = true;
      continue;
    }
    seen.add(key);
    tracks.push(song);
    if (tracks.length >= cap) break;
  }

  return { tracks, droppedRepeats };
}

export function withHonestStationDescription(
  description: string,
  count: number,
  options?: { droppedRepeats?: boolean },
): string {
  const vibe = description.trim();
  const notes: string[] = [];
  if (options?.droppedRepeats) {
    notes.push("Different songs from last time, still the same era, mood, and scene.");
  }
  if (count < CURATE_TRACK_CAP) {
    notes.push(
      count <= 0
        ? "Fewer than 25 songs truly fit, and no different real songs were left."
        : `Fewer than 25 songs truly fit, so this station has ${count}.`,
    );
  }
  if (notes.length === 0) return vibe;

  const alreadyShort = vibe.toLowerCase().includes("fewer than 25");
  const alreadyDifferent = vibe.toLowerCase().includes("different songs");
  const pending = notes.filter((note) => {
    if (alreadyShort && note.startsWith("Fewer than 25")) return false;
    if (alreadyDifferent && note.startsWith("Different songs")) return false;
    return true;
  });
  if (pending.length === 0) return vibe;
  const addition = pending.join(" ");
  if (!vibe) return addition;
  const lead = /[.!?]$/.test(vibe) ? vibe : `${vibe}.`;
  return `${lead} ${addition}`;
}
