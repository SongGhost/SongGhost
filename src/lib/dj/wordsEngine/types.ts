/**
 * New DJ words — types only.
 * Classic teaching prompts do not live here.
 */

import type { CommentaryFormat, DjSegmentPlan } from "@/types/dj";
import type { AlbumContext } from "@/types/station";

export type NewBreakShape =
  | "lore"
  | "catchup"
  | "song_id"
  | "stinger"
  | "recap"
  | "teaser";

export type FactNugget = {
  id: string;
  /** One true sentence. The only fact text the host may speak. */
  sentence: string;
};

export type SpeechName = {
  title: string;
  artist: string;
};

export type FactPack = {
  engine: "new";
  depth: CommentaryFormat;
  maxNuggets: number;
  personaId: string;
  shape: NewBreakShape;
  /** 0 names-first, 1 fact-first, 2 that-was frame when a previous song exists. */
  shapeVariant: 0 | 1 | 2;
  stationName?: string;
  includeStationId: boolean;
  now: SpeechName;
  previous?: SpeechName;
  recapLines: string[];
  nuggets: FactNugget[];
  allowExplicit: boolean;
  allowedYears: number[];
  /** Song 1. The spoken line is the station welcome, not a fact break. */
  sessionOpening: boolean;
};

export type FactPackInput = {
  title?: string;
  artist?: string;
  album?: string;
  releaseYear?: number;
  stationName?: string;
  personaId?: string;
  depth?: CommentaryFormat;
  plan?: DjSegmentPlan;
  previous?: SpeechName;
  albumContext?: AlbumContext | null;
  allowExplicit?: boolean;
  weatherSummary?: string;
  homeCity?: string;
  /**
   * Year or album filled from an existing catalog lookup when the row
   * itself had neither. Never invented. Sleeve and row fields win.
   */
  lookupYear?: number;
  lookupAlbum?: string;
  /** iTunes track number, used when the sleeve has no position. */
  lookupTrackNumber?: number;
  /** iTunes disc number, only when it is past disc 1. */
  lookupDiscNumber?: number;
  /**
   * MusicBrainz producer names, used only when the sleeve has no producer.
   * Spoken with the existing producer nugget.
   */
  lookupProducer?: string;
  /**
   * MusicBrainz "recorded at" place, used only when the sleeve has no studio.
   * Spoken with the existing studio nugget.
   */
  lookupStudio?: string;
  /**
   * MusicBrainz engineer names. Spoken as credit nuggets.
   * Vocal and instrument relationships are not included.
   */
  lookupEngineers?: string[];
  /**
   * A catalog sentence that is not a genre or era tag.
   * "Listed as" and "filed under" lines are ignored.
   */
  catalogNote?: string;
  /** Ignored. An era tag is not a fact. */
  eraTag?: string;
  /** Ignored. A genre tag is not a fact. */
  genreTag?: string;
  /** Nugget ids already spoken for this song and artist in the session. */
  spokenFactIds?: string[];
};
