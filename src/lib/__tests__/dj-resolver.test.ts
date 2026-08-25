import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERSONA,
  ELEVENLABS_PREMADE_ANTONI,
  ELEVENLABS_PREMADE_RACHEL,
  LEGACY_PERSONA_ALIASES,
  LEGACY_PERSONA_VOICE,
  PERSONAS,
  getPersonaById,
  getPersonaTtsInstructions,
  migratePersistedPersonaId,
  resolvePersonaId,
  resolvePremadeFallbackVoiceId,
} from "@/data/personas";
import { resolveActiveHost, SHORT_PRO_PERSONA_ALIASES } from "@/lib/dj/personaConfig";
import { STATIONS } from "@/data/stations";
import {
  DECADE_DJ_MAP,
  GENRE_DJ_MAP,
  getPersonaForStation,
  resolveDjForQuery,
  resolveDjForStation,
  resolveDjIdForQuery,
} from "../dj-resolver";

describe("persona roster", () => {
  it("ships exactly the four character personas", () => {
    expect(PERSONAS.map((p) => p.id)).toEqual([
      "standard-broadcast",
      "warm-companion",
      "sarcastic-critic",
      "the-musicologist",
    ]);
  });

  it("carries an LLM system prompt and TTS instructions on every persona", () => {
    for (const persona of PERSONAS) {
      expect(persona.systemPrompt.length).toBeGreaterThan(0);
      expect(persona.ttsInstructions.length).toBeGreaterThan(0);
      expect(persona.voice.length).toBeGreaterThan(0);
      expect(persona.tier === "free" || persona.tier === "pro").toBe(true);
    }
    expect(PERSONAS.filter((p) => p.tier === "free").map((p) => p.id)).toEqual([
      "standard-broadcast",
    ]);
  });
});

describe("legacy persona ids", () => {
  it("maps every retired id onto a live host", () => {
    for (const [legacy, replacement] of Object.entries(LEGACY_PERSONA_ALIASES)) {
      expect(getPersonaById(legacy)?.id).toBe(replacement);
      expect(resolvePersonaId(legacy)).toBe(replacement);
    }
  });

  it("maps short Pro picker ids onto canonical roster hosts", () => {
    expect(resolvePersonaId("devon")).toBe("warm-companion");
    expect(resolvePersonaId("Devon")).toBe("warm-companion");
    expect(getPersonaById("devon")?.id).toBe("warm-companion");
    expect(resolvePersonaId("sloane")).toBe("sarcastic-critic");
    expect(resolvePersonaId("kira")).toBe("warm-companion");
    expect(resolvePersonaId("jasper")).toBe("the-musicologist");
    for (const [shortId, canonical] of Object.entries(SHORT_PRO_PERSONA_ALIASES)) {
      expect(resolvePersonaId(shortId)).toBe(canonical);
    }
    expect(resolveActiveHost("devon", true).personaId).toBe("warm-companion");
    expect(resolveActiveHost("devon", true).displayName).toBe("Warm Companion");
  });

  it("never maps an unknown male library voice onto Rachel", () => {
    const devonLibraryId = "2ajXGJNYBR0iNHpS4VZb";
    expect(resolvePremadeFallbackVoiceId(devonLibraryId)).toBe(devonLibraryId);
    expect(resolvePremadeFallbackVoiceId(devonLibraryId, "male")).toBe(
      ELEVENLABS_PREMADE_ANTONI,
    );
    expect(resolvePremadeFallbackVoiceId(devonLibraryId, "female")).toBe(
      ELEVENLABS_PREMADE_RACHEL,
    );
  });

  it("falls back to the default host for unknown or missing ids", () => {
    expect(resolvePersonaId("dj-nobody")).toBe(DEFAULT_PERSONA.id);
    expect(resolvePersonaId(undefined)).toBe(DEFAULT_PERSONA.id);
    expect(getPersonaById("dj-nobody")).toBeUndefined();
  });
});

describe("named-host migration table", () => {
  const table: Array<[string, string, string]> = [
    ["henry", "warm-companion", "onyx"],
    ["sloane-vance", "sarcastic-critic", "alloy"],
    ["miles", "warm-companion", "onyx"],
    ["devon-pulse", "warm-companion", "echo"],
    ["kira-nova", "warm-companion", "nova"],
    ["jasper-reed", "the-musicologist", "fable"],
  ];

  it("maps each old persona id to the new persona without rewriting voice", () => {
    for (const [oldId, newId, voice] of table) {
      expect(resolvePersonaId(oldId)).toBe(newId);
      expect(migratePersistedPersonaId(oldId)).toBe(newId);
      expect(getPersonaById(oldId)?.id).toBe(newId);
      expect(LEGACY_PERSONA_VOICE[oldId]).toBe(voice);
      // Migration helper returns only the persona id — voice stays on prefs.
      expect(typeof migratePersistedPersonaId(oldId)).toBe("string");
    }
  });

  it("exposes TTS instructions for every live persona", () => {
    for (const persona of PERSONAS) {
      expect(getPersonaTtsInstructions(persona.id)).toBe(persona.ttsInstructions);
    }
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
  it("lands unmatched and genre queries on Standard Broadcast", () => {
    expect(resolveDjIdForQuery("90s Country")).toBe("standard-broadcast");
    expect(resolveDjIdForQuery("90s Seattle grunge")).toBe("standard-broadcast");
    expect(resolveDjIdForQuery("classic rock anthems")).toBe("standard-broadcast");
    expect(resolveDjIdForQuery("alternative and indie rock")).toBe("standard-broadcast");
    expect(resolveDjIdForQuery("boom bap hip hop")).toBe("standard-broadcast");
    expect(resolveDjIdForQuery("Lo-Fi Study")).toBe("standard-broadcast");
  });

  it("still maps decade keywords onto Standard Broadcast", () => {
    expect(resolveDjIdForQuery("70s deep cuts")).toBe("standard-broadcast");
    expect(resolveDjIdForQuery("2010s throwbacks")).toBe("standard-broadcast");
  });

  it("ignores supplied genre tags for host identity", () => {
    expect(resolveDjIdForQuery("songs for a night drive", ["synthwave"])).toBe(
      "standard-broadcast",
    );
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

describe("getPersonaForStation", () => {
  it("honors an explicit assignment after migrating legacy ids", () => {
    expect(
      getPersonaForStation({
        name: "Techno Underground",
        defaultPersonaId: "jasper-reed",
      }).id,
    ).toBe("the-musicologist");
  });

  it("upgrades a legacy assignment", () => {
    expect(getPersonaForStation({ name: "Anything", defaultPersonaId: "wolfman" }).id).toBe(
      "warm-companion",
    );
  });

  it("resolves from name and description when no host is set", () => {
    expect(
      getPersonaForStation({ name: "My Mix", description: "late night soul and jazz" }).id,
    ).toBe("standard-broadcast");
    expect(getPersonaForStation({ name: "90s Country" }).id).toBe("standard-broadcast");
    expect(getPersonaForStation({ name: "Lo-Fi Study" }).id).toBe("standard-broadcast");
    expect(getPersonaForStation({ name: "90s Boom Bap" }).id).toBe("standard-broadcast");
  });

  it("keeps resolveDjForStation as an alias", () => {
    expect(
      resolveDjForStation({ name: "My Mix", description: "late night soul and jazz" }).id,
    ).toBe("standard-broadcast");
  });
});
