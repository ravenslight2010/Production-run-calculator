// Parenthetical ingredient info must survive spec imports (Task gap 4):
//   • "X (A)" and "X (B)" are DIFFERENT ingredients — the fuzzy layer of
//     `canonicalize` must never collapse one onto the other (the parenthetical
//     is the distinguishing info: milk type, grind, salt coarseness…).
//   • A typo with the SAME parenthetical ("Mozarella (LMPS)") must still
//     fuzzy-snap onto its known spelling — the guard compares paren
//     signatures, it does not disable fuzzy matching.
//   • One-sided parens ("X (A)" vs "X") stay separate via the pre-existing
//     token-subset guard.
import { describe, it, expect } from "vitest";
import { canonicalize, specNameParenSignature } from "./index";

describe("specNameParenSignature", () => {
  it("extracts a loose, order-independent signature of paren groups", () => {
    expect(specNameParenSignature("Mozzarella (LMPS)")).toBe("lmps");
    expect(specNameParenSignature("Mozzarella")).toBe("");
    expect(specNameParenSignature("Mix (A) Blend (B)")).toBe(
      specNameParenSignature("Mix (B) Blend (A)"),
    );
    // Loose: case/punctuation/spacing inside the parens don't matter.
    expect(specNameParenSignature("Salt (semi-coarse)")).toBe(
      specNameParenSignature("Salt (Semi Coarse)"),
    );
    // Empty parens carry no info.
    expect(specNameParenSignature("Salt ()")).toBe("");
  });
});

describe("canonicalize keeps parenthetical ingredient distinctions", () => {
  const known = ["Mozzarella (LMPS)", "Mozzarella (WMLM)", "Sea Salt (Fine)", "Sea Salt (Coarse)"];

  it("never fuzzy-collapses X (A) onto X (B)", () => {
    // Only one paren variant known: the OTHER variant must import as new,
    // verbatim — not snap onto the near-identical known name.
    const r1 = canonicalize("Mozzarella (WMLM)", ["Mozzarella (LMPS)"], [], "cheeseIngredient");
    expect(r1.value).toBe("Mozzarella (WMLM)");
    expect(r1.source).toBe("new");
    const r2 = canonicalize("Sea Salt (Fine)", ["Sea Salt (Coarse)"], [], "doughIngredient");
    expect(r2.value).toBe("Sea Salt (Fine)");
    expect(r2.source).toBe("new");
  });

  it("still fuzzy-matches a typo with the SAME parenthetical", () => {
    const r = canonicalize("Mozarella (LMPS)", known, [], "cheeseIngredient");
    expect(r.value).toBe("Mozzarella (LMPS)");
    expect(r.source).toBe("fuzzy");
  });

  it("keeps X and X (A) separate (token-subset guard)", () => {
    const r = canonicalize("Mozzarella", known, [], "cheeseIngredient");
    expect(r.value).toBe("Mozzarella");
    expect(r.source).toBe("new");
  });

  it("exact paren-variant names still match themselves", () => {
    const r = canonicalize("sea salt (coarse)", known, [], "cheeseIngredient");
    expect(r.value).toBe("Sea Salt (Coarse)");
    expect(r.source).toBe("exact");
  });
});
