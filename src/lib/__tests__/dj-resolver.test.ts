import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERSONA,
  LEGACY_PERSONA_ALIASES,
  PERSONAS,
  getPersonaById,
  resolvePersonaId,
  STANDARD_VOICE_SETTINGS,
} from "@/data/personas";
import { STATIONS } from "@/data/stations";
import {
  DECADE_DJ_MAP,
  GENRE_DJ_MAP,
  resolveDjForQuery,
  resolveDjForStation,
  resolveDjIdForQuery,
} from "../dj-resolver";

describe("persona roster", () => {
  it("ships exactly the five standard hosts", () => {
    expect(PERSONAS.map((p) => p.id)).toEqual([
      "sloane-vance",
      "johnny-static",
      "devon-pulse",
      "kira-nova",
      "jasper-reed",
    ]);
  });

  it("calibrates every host to the standard ElevenLabs settings", () => {
    for (const persona of PERSONAS) {
      expect(persona.voiceSettings.stability).toBe(0.5);
      expect(persona.voiceSettings.similarity_boost).toBe(0.75);
      expect(persona.voiceSettings.style).toBe(0.15);
      expect(persona.voiceSettings).toEqual(STANDARD_VOICE_SETTINGS);
    }
  });

  it("gives every host a distinct ElevenLabs voice id", () => {
    const ids = PERSONAS.map((p) => p.elevenLabsVoiceId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
  });

  it("describes gender, tone, and vibe for the script prompt", () => {
    for (const persona of PERSONAS) {
      expect(["female", "male"]).toContain(persona.gender);
      expect(persona.tone.length).toBeGreaterThan(0);
      expect(persona.vibe.length).toBeGreaterThan(0);
    }
  });
});

describe("legacy persona ids", () => {
  it("maps every retired id onto a live host", () => {
    for (const [legacy, replacement] of Object.entries(LEGACY_PERSONA_ALIASES)) {
      expect(getPersonaById(legacy)?.id).toBe(replacement);
      expect(resolvePersonaId(legacy)).toBe(replacement);
    }
  });

  it("falls back to the default host for unknown or missing ids", () => {
    expect(resolvePersonaId("dj-nobody")).toBe(DEFAULT_PERSONA.id);
    expect(resolvePersonaId(undefined)).toBe(DEFAULT_PERSONA.id);
    expect(getPersonaById("dj-nobody")).toBeUndefined();
  });
});

describe("preset station hosts", () => {
  it("assigns every preset station a host that exists", () => {
    for (const station of STATIONS) {
      expect(getPersonaById(station.defaultPersonaId), station.id).toBeDefined();
    }
  });
});

describe("resolveDjForQuery", () => {
  it("routes genres to their specialist host", () => {
    expect(resolveDjIdForQuery("grunge and alternative rock")).toBe("sloane-vance");
    expect(resolveDjIdForQuery("classic rock anthems")).toBe("johnny-static");
    expect(resolveDjIdForQuery("boom bap hip hop")).toBe("devon-pulse");
    expect(resolveDjIdForQuery("deep house and techno")).toBe("kira-nova");
    expect(resolveDjIdForQuery("bluegrass and americana")).toBe("jasper-reed");
  });

  it("prefers the longest keyword so sub-genres beat their parent", () => {
    expect(resolveDjIdForQuery("post-rock cinematic")).toBe("sloane-vance");
    expect(resolveDjIdForQuery("smooth jazz lounge")).toBe("devon-pulse");
  });

  it("lets genre outrank decade", () => {
    expect(resolveDjIdForQuery("90s hip hop")).toBe("devon-pulse");
    expect(resolveDjIdForQuery("90s grunge")).toBe("sloane-vance");
  });

  it("falls back to decade when no genre is named", () => {
    expect(resolveDjIdForQuery("70s deep cuts")).toBe("johnny-static");
    expect(resolveDjIdForQuery("2010s throwbacks")).toBe("sloane-vance");
  });

  it("reads supplied genre tags alongside the query", () => {
    expect(resolveDjIdForQuery("songs for a night drive", ["synthwave"])).toBe("kira-nova");
  });

  it("returns the default host when nothing matches", () => {
    expect(resolveDjForQuery("zzzz")).toBe(DEFAULT_PERSONA);
    expect(resolveDjForQuery("")).toBe(DEFAULT_PERSONA);
  });

  it("keeps every mapped keyword pointing at a real host", () => {
    for (const id of [...Object.values(GENRE_DJ_MAP), ...Object.values(DECADE_DJ_MAP)]) {
      expect(getPersonaById(id)).toBeDefined();
    }
  });
});

describe("resolveDjForStation", () => {
  it("honors an explicit assignment", () => {
    expect(resolveDjForStation({ name: "Techno Underground", defaultPersonaId: "jasper-reed" }).id)
      .toBe("jasper-reed");
  });

  it("upgrades a legacy assignment", () => {
    expect(resolveDjForStation({ name: "Anything", defaultPersonaId: "wolfman" }).id).toBe(
      "johnny-static",
    );
  });

  it("resolves from name and description when no host is set", () => {
    expect(
      resolveDjForStation({ name: "My Mix", description: "late night r&b and soul" }).id,
    ).toBe("devon-pulse");
  });
});
