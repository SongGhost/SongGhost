export { buildFactPack, nuggetCapForDepth } from "./factPack";
export { buildNewWordsPrompt } from "./prompt";
export { composeDraft, composeNewBreak } from "./compose";
export { scriptPassesGate, wordCeiling, wordCount } from "./gate";
export { playNewBreak } from "./playNewBreak";
export { resolveNewWordsFromBody } from "./handleRequest";
export { synthesizeNewBreak } from "./synthesize";
export type { FactPack, FactPackInput, NewBreakShape } from "./types";
export type { PlayNewBreakOptions, PlayNewBreakResult } from "./playNewBreak";
