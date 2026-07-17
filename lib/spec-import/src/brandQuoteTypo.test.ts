import { describe, expect, it } from "vitest";
import {
  sanitizeParsedSpecImport,
  specImportBrandMatchKey,
  specImportNameMatchKey,
} from "./index";

describe("specImportNameMatchKey double-quote typo fold", () => {
  it('folds a mid-word straight double-quote like an apostrophe (Aldo"s == Aldo\'s)', () => {
    expect(specImportNameMatchKey('Aldo"s')).toBe(specImportNameMatchKey("Aldo's"));
    expect(specImportNameMatchKey('Aldo"s')).toBe("aldos");
  });

  it("folds curly double quotes between letters too", () => {
    expect(specImportNameMatchKey("Aldo”s")).toBe("aldos");
    expect(specImportNameMatchKey("Aldo“s")).toBe("aldos");
  });

  it("folds the curly single open quote", () => {
    expect(specImportNameMatchKey("Aldo‘s")).toBe("aldos");
  });

  it("keeps inch marks intact (not letter-bounded)", () => {
    // Trailing inch mark: unchanged key.
    expect(specImportNameMatchKey('12" Dies')).toBe("12 dies");
    // Between digits / digit-letter: still a separator, not a fold.
    expect(specImportNameMatchKey('12"x16"')).toBe("12 x16");
  });

  it("brand match key collapses the typo onto the real brand", () => {
    expect(specImportBrandMatchKey('Aldo"s')).toBe(specImportBrandMatchKey("Aldo's"));
    expect(specImportBrandMatchKey('Aldo"s')).toBe("aldo");
  });
});

describe("sanitizeParsedSpecImport known-brand key snap", () => {
  const raw = {
    profiles: [
      {
        brand: 'Aldo"s',
        flavor: "SAUSAGE",
        sauceOzPerPizza: 4,
        applicators: [],
      },
    ],
    recipes: [],
  };

  it("snaps a punctuation-typo brand onto the known spelling and warns", () => {
    const out = sanitizeParsedSpecImport(raw, {}, { knownBrands: ["Aldo's"] });
    expect(out.profiles).toHaveLength(1);
    expect(out.profiles[0].brand).toBe("Aldo's");
    expect(out.profiles[0].sauceOzPerPizza).toBe(4);
    const messages = (out.warnings ?? []).map((w) => w.message).join("\n");
    expect(messages).toContain('Corrected brand "Aldo"s" to "Aldo\'s".');
  });

  it("snaps even when grounding source text contains the typo tokens", () => {
    const out = sanitizeParsedSpecImport(raw, {}, {
      knownBrands: ["Aldo's"],
      sourceText: 'ALDO"S PIZZA SPECS\tSAUSAGE\t4 oz',
    });
    expect(out.profiles[0].brand).toBe("Aldo's");
  });

  it("keeps a genuinely new brand verbatim", () => {
    const out = sanitizeParsedSpecImport(raw, {}, { knownBrands: ["Corner Booth"] });
    expect(out.profiles[0].brand).toBe('Aldo"s');
  });

  it("first known brand wins when two known brands share a loose key (documented tie policy)", () => {
    // `Aldo's` and `Aldos Pizza` both key to "aldo" (possessive fold + "pizza"
    // filler drop). The snap map keeps the FIRST known brand per key, so a
    // typo row snaps deterministically to it. Real factories haven't hit this;
    // this test locks the policy so a change is deliberate.
    const out = sanitizeParsedSpecImport(raw, {}, { knownBrands: ["Aldo's", "Aldos Pizza"] });
    expect(out.profiles[0].brand).toBe("Aldo's");
  });

  it("does not rewrite a brand that differs only in case", () => {
    const out = sanitizeParsedSpecImport(
      { profiles: [{ brand: "aldo's", flavor: "SAUSAGE", applicators: [] }], recipes: [] },
      {},
      { knownBrands: ["Aldo's"] },
    );
    // Case-only difference: snapped to the known spelling silently (no warning).
    expect(out.profiles[0].brand).toBe("Aldo's");
    const messages = (out.warnings ?? []).map((w) => w.message).join("\n");
    expect(messages).not.toContain("Corrected brand");
  });
});
