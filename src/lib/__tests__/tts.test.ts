import { describe, expect, it } from "vitest";
import {
  ensureTerminalPunctuation,
  prepareTtsSynthesisText,
  ssmlBreaksToEllipsis,
  stripAllSsmlTags,
  stripSsmlBreakTags,
} from "../tts";

describe("ensureTerminalPunctuation", () => {
  it("appends a period when the script is open-ended", () => {
    expect(ensureTerminalPunctuation("Welcome back to SongHost")).toBe(
      "Welcome back to SongHost.",
    );
  });

  it("preserves existing terminators", () => {
    expect(ensureTerminalPunctuation("Here we go!")).toBe("Here we go!");
    expect(ensureTerminalPunctuation("Really?")).toBe("Really?");
    expect(ensureTerminalPunctuation("Soft landing...")).toBe("Soft landing...");
  });
});

describe("stripSsmlBreakTags / ssmlBreaksToEllipsis / stripAllSsmlTags", () => {
  it("strips break tags cleanly", () => {
    expect(
      stripSsmlBreakTags('Before <break time="300ms"/> after'),
    ).toBe("Before after");
  });

  it("converts break tags to ellipsis pacing cues", () => {
    expect(
      ssmlBreaksToEllipsis('Before <break time="500ms"/> after'),
    ).toBe("Before... after");
  });

  it("converts breaks and strips other SSML/XML tags", () => {
    expect(
      stripAllSsmlTags(
        'Before <break time="300ms"/> <say-as interpret-as="characters">OK</say-as> after',
      ),
    ).toBe("Before ... OK after");
  });
});

describe("prepareTtsSynthesisText", () => {
  it("pads copy with a soft trailing ellipsis for ElevenLabs", () => {
    expect(prepareTtsSynthesisText("On SongHost", "elevenlabs")).toBe(
      "On SongHost...",
    );
  });

  it("strips mid-script SSML breaks for ElevenLabs (no raw XML)", () => {
    expect(
      prepareTtsSynthesisText(
        'Listen close <break time="300ms"/> this break changed hip-hop',
        "elevenlabs",
      ),
    ).toBe("Listen close ... this break changed hip-hop...");
  });

  it("does not leave raw trailing break tags in the ElevenLabs payload", () => {
    const alreadyPadded = `Hello. <break time="0.4s" />`;
    expect(prepareTtsSynthesisText(alreadyPadded, "elevenlabs")).toBe(
      "Hello...",
    );
  });

  it("strips SSML and uses a soft ellipsis pause for OpenAI", () => {
    expect(prepareTtsSynthesisText("On SongHost", "openai")).toBe(
      "On SongHost...",
    );
    expect(
      prepareTtsSynthesisText(
        'Listen close <break time="300ms"/> this break changed hip-hop',
        "openai",
      ),
    ).toBe("Listen close ... this break changed hip-hop...");
  });

  it("strips say-as and other XML before either provider", () => {
    expect(
      prepareTtsSynthesisText(
        'Call letters <say-as interpret-as="characters">WXYZ</say-as> tonight',
        "elevenlabs",
      ),
    ).toBe("Call letters WXYZ tonight...");
  });
});
