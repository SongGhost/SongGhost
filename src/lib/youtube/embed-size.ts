/** Hidden embed size — matches the live dial host (below YouTube's 200×200 minimum). */
export const YT_EMBED_HIDDEN = { width: 320, height: 180 } as const;

/** Visible test size — meets Required Minimum Functionality (≥200×200). */
export const YT_EMBED_VISIBLE = { width: 320, height: 200 } as const;
