import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PREFERENCES_SYNC_DEBOUNCE_MS,
  flushPreferencesSyncForTests,
  schedulePreferencesSync,
} from "../cloud-sync";

describe("schedulePreferencesSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { window?: unknown }).window = {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true }),
    );
  });

  afterEach(() => {
    flushPreferencesSyncForTests(false);
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete (globalThis as { window?: unknown }).window;
  });

  it("debounces rapid Host Studio writes into a single POST", async () => {
    schedulePreferencesSync({ commentaryFormat: "standard" });
    schedulePreferencesSync({ commentaryFormat: "directors_cut", lastStationId: "90s-alt" });
    expect(fetch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(PREFERENCES_SYNC_DEBOUNCE_MS);
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      body?: string;
    };
    expect(JSON.parse(init.body ?? "{}")).toEqual({
      preferences: {
        commentaryFormat: "directors_cut",
        lastStationId: "90s-alt",
      },
    });
  });
});
