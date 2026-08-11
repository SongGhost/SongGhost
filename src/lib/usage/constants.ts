/**
 * Legacy Free-tier monthly DJ break allowance (rolling 30-day window).
 * Break-cap enforcement is disabled — Free sessions get unlimited breaks.
 * Kept for soft usage analytics / backward-compatible imports.
 */
export const FREE_MONTHLY_BREAK_LIMIT = Number.POSITIVE_INFINITY;

/** Length of the metering window in milliseconds. */
export const USAGE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
