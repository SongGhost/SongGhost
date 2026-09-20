import { describe, expect, it } from "vitest";
import {
  LOCAL_LORE_WORD_MAX,
  OPENAI_LORE_WORD_MAX,
  loreWordMaxForProvider,
} from "../loreBudget";

describe("lore word budgets", () => {
  it("keeps OpenAI Director's Cut long-form", () => {
    expect(loreWordMaxForProvider("directors_cut")).toBe(110);
    expect(loreWordMaxForProvider("directors_cut", "openai")).toBe(110);
    expect(OPENAI_LORE_WORD_MAX.directors_cut).toBe(110);
  });

  it("uses a tighter local Director's Cut that is still longer than Standard", () => {
    expect(loreWordMaxForProvider("directors_cut", "local")).toBe(62);
    expect(LOCAL_LORE_WORD_MAX.directors_cut).toBeGreaterThan(
      LOCAL_LORE_WORD_MAX.standard,
    );
    expect(LOCAL_LORE_WORD_MAX.directors_cut).toBeGreaterThan(40);
  });
});
