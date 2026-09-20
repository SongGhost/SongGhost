/**
 * Break-package cache identity for two-ahead prefetch (Pass 3).
 *
 * Packages are addressed by upcoming track id **and** a settings fingerprint
 * (voice, lore tier, persona, vibe, pacing, …). A fingerprint change is a
 * cache miss — stale clips must not air after Host Studio edits.
 *
 * Depth is exactly {@link TWO_AHEAD_DEPTH}: N+1 and N+2 while Track N plays.
 * Pass 4 first-playlist "that was / up next" is planned in the scheduler /
 * AudioPlayer lookahead — this helper only names the next two tracks.
 */

export const TWO_AHEAD_DEPTH = 2;

const KEY_SEP = "\u001e";

export type BreakSettingsFingerprintInput = {
  provider?: string | null;
  voice?: string | null;
  voiceSlot?: number | string | null;
  personaId?: string | null;
  commentaryFormat?: string | null;
  chatterPacing?: string | null;
  vibePrompt?: string | null;
  voiceProfile?: {
    energy?: string;
    accent?: string;
    snark?: string;
    pacing?: string;
  } | null;
  tier?: string | null;
  allowExplicit?: boolean | null;
  alwaysAnnounceSongs?: boolean | null;
  homeCity?: string | null;
  stationId?: string | null;
  stationName?: string | null;
  eraLock?: unknown;
  albumContext?: unknown;
};

export type TwoAheadTrack = {
  trackKey: string;
  title: string;
  artist: string;
};

export type TwoAheadTarget = TwoAheadTrack & {
  /** Predecessor for recap copy — on-air N for N+1, N+1 for N+2. */
  previousTrack?: { title: string; artist: string };
  /** 1 = next transition, 2 = the one after. */
  depth: 1 | 2;
};

function compact(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/**
 * Stable string of Host Studio / station knobs that change script or voice.
 * Does **not** include per-track `segmentPlan` — that travels on the package.
 */
export function buildBreakSettingsFingerprint(
  input: BreakSettingsFingerprintInput,
): string {
  const profile = input.voiceProfile;
  const voiceProfileKey = profile
    ? [profile.energy, profile.accent, profile.snark, profile.pacing]
        .map((part) => part ?? "")
        .join(":")
    : "";
  return [
    compact(input.provider),
    compact(input.voice),
    compact(input.voiceSlot),
    compact(input.personaId),
    compact(input.commentaryFormat),
    compact(input.chatterPacing),
    compact(input.vibePrompt),
    voiceProfileKey,
    compact(input.tier),
    input.allowExplicit === true ? "1" : "0",
    input.alwaysAnnounceSongs === true ? "1" : "0",
    compact(input.homeCity).toLowerCase(),
    compact(input.stationId),
    compact(input.stationName),
    compact(input.eraLock),
    compact(input.albumContext),
  ].join("|");
}

export function breakPackageCacheKey(
  trackKey: string,
  fingerprint: string,
): string {
  return `${fingerprint}${KEY_SEP}${trackKey}`;
}

export function trackKeyFromPackageCacheKey(cacheKey: string): string {
  const sep = cacheKey.indexOf(KEY_SEP);
  return sep < 0 ? cacheKey : cacheKey.slice(sep + KEY_SEP.length);
}

/**
 * Next {@link TWO_AHEAD_DEPTH} transitions after `currentIndex`.
 * Does not include the on-air row. First-playlist pack planning stays in
 * `planDjSegment({ isFirstPlaylistTransition })`, not here.
 */
export function twoAheadTargets(
  tracks: readonly TwoAheadTrack[],
  currentIndex: number,
): TwoAheadTarget[] {
  if (!Number.isInteger(currentIndex) || currentIndex < 0) return [];
  const targets: TwoAheadTarget[] = [];
  for (let depth = 1; depth <= TWO_AHEAD_DEPTH; depth += 1) {
    const track = tracks[currentIndex + depth];
    const key = track?.trackKey?.trim();
    if (!track || !key) break;
    const predecessor = tracks[currentIndex + depth - 1];
    const previousTrack =
      predecessor?.title?.trim() && predecessor?.artist?.trim()
        ? { title: predecessor.title.trim(), artist: predecessor.artist.trim() }
        : undefined;
    targets.push({
      trackKey: key,
      title: track.title,
      artist: track.artist,
      previousTrack,
      depth: depth as 1 | 2,
    });
  }
  return targets;
}
