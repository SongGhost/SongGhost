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
};
