import { describe, expect, it, vi } from "vitest";
import { BreakFlightCoordinator } from "../break-flight";

describe("BreakFlightCoordinator", () => {
  it("ignores results from a superseded generation", () => {
    const flight = new BreakFlightCoordinator();
    const first = flight.begin("track_change");
    const second = flight.begin("skip");

    expect(flight.isCurrent(first.generation)).toBe(false);
    expect(flight.canPlay(first.generation)).toBe(false);
    expect(first.signal.aborted).toBe(true);
    expect(flight.canPlay(second.generation)).toBe(true);
    expect(second.generation).toBeGreaterThan(first.generation);
  });

  it("refuses play after music has started for that transition", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const flight = new BreakFlightCoordinator();
    const attempt = flight.begin("track_change");

    flight.markMusicReleased(attempt.generation, "music_released");

    expect(flight.isMusicReleased(attempt.generation)).toBe(true);
    expect(flight.canPlay(attempt.generation)).toBe(false);
    expect(attempt.signal.aborted).toBe(true);
    expect(log).toHaveBeenCalledWith(
      "[SongHost] music released",
      { generation: attempt.generation, trigger: "music_released" },
    );
    expect(warn).not.toHaveBeenCalled();
    log.mockRestore();
    warn.mockRestore();
  });

  it("does not mark music released for a stale generation", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const flight = new BreakFlightCoordinator();
    const first = flight.begin("track_change");
    const second = flight.begin("skip");

    flight.markMusicReleased(first.generation, "timeout");

    expect(flight.isMusicReleased(first.generation)).toBe(false);
    expect(flight.canPlay(second.generation)).toBe(true);
    warn.mockRestore();
  });
});
