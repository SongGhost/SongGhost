import { describe, expect, it } from "vitest";
import {
  TTS_TRAILING_BREAK_TAG,
  ensureTerminalPunctuation,
  prepareTtsSynthesisText,
  ssmlBreaksToEllipsis,
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

describe("stripSsmlBreakTags / ssmlBreaksToEllipsis", () => {
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
});

describe("prepareTtsSynthesisText", () => {
  it("pads ElevenLabs copy with a trailing break tag", () => {
    expect(prepareTtsSynthesisText("On SongHost", "elevenlabs")).toBe(
      `On SongHost. ${TTS_TRAILING_BREAK_TAG}`,
    );
  });

  it("preserves mid-script SSML breaks for ElevenLabs", () => {
    expect(
      prepareTtsSynthesisText(
        'Listen close <break time="300ms"/> this break changed hip-hop',
        "elevenlabs",
      ),
    ).toBe(
      `Listen close <break time="300ms"/> this break changed hip-hop. ${TTS_TRAILING_BREAK_TAG}`,
    );
  });

  it("does not double-append break tags", () => {
    const alreadyPadded = `Hello. ${TTS_TRAILING_BREAK_TAG}`;
    expect(prepareTtsSynthesisText(alreadyPadded, "elevenlabs")).toBe(
      alreadyPadded,
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
    ).toBe("Listen close... this break changed hip-hop...");
  });
});
