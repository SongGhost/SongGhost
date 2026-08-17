import { describe, expect, it } from "vitest";
import { formatScriptForTts, sanitizeDjScript } from "../dj-script";

describe("sanitizeDjScript", () => {
  it("strips markdown headers, underscores, asterisks, and emojis", () => {
    expect(sanitizeDjScript("# Intro\nThis _track_ is fire 🔥")).toBe(
      "Intro This track is fire",
    );
  });

  it("strips unpaired asterisks and leftover markdown", () => {
    expect(sanitizeDjScript("Hello * world")).toBe("Hello world");
  });

  it("strips stage directions and orphan trailing punctuation", () => {
    expect(sanitizeDjScript("Welcome back [laughs] (aside) —")).toBe(
      "Welcome back",
    );
  });

  it("keeps spoken copy intact", () => {
    expect(
      sanitizeDjScript('That was "Dreams" by Fleetwood Mac, off Rumours.'),
    ).toBe('That was "Dreams" by Fleetwood Mac, off Rumours.');
  });
});

describe("formatScriptForTts", () => {
  it("inserts per-clause ellipses on the default (Mode B) path", () => {
    const formatted = formatScriptForTts(
      "This is a first sentence. This is a second sentence.",
    );
    expect(formatted).toContain(" ... ");
  });

  it("keeps Mode A pauses at sentence boundaries only", () => {
    const formatted = formatScriptForTts(
      "This is a first sentence. This is a second sentence.",
      { compactPauses: true },
    );
    expect(formatted).not.toContain("...");
    expect(formatted).toContain("This is a first sentence.");
    expect(formatted).toContain("This is a second sentence.");
  });

  it("collapses mid-script ellipses on the Mode A path", () => {
    const formatted = formatScriptForTts(
      "Wait... this one changed everything.",
      { compactPauses: true },
    );
    expect(formatted).not.toContain("...");
    expect(formatted).toMatch(/Wait\.\s+this one changed everything\./i);
  });
});
