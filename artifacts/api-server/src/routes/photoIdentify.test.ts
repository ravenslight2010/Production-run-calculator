import { describe, it, expect } from "vitest";
import {
  sanitizeGuesses,
  validateIdentifyPhotoBody,
  MAX_CANDIDATES,
  MAX_IMAGE_BASE64_CHARS,
} from "./photoIdentify";

// A valid PhotoGuess-shaped item, used as a baseline that other tests tweak.
function guess(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Mozzarella",
    qty: 3,
    unit: "cases",
    category: "ingredient",
    matchedKey: "mozz",
    confidence: 0.8,
    ...overrides,
  };
}

describe("sanitizeGuesses", () => {
  it("returns no items when the top-level shape is wrong (non-JSON / malformed output)", () => {
    // JSON.parse already runs upstream, so these are the parsed-but-malformed
    // shapes a flaky model can still produce.
    expect(sanitizeGuesses(null, new Set())).toEqual([]);
    expect(sanitizeGuesses("not an object", new Set())).toEqual([]);
    expect(sanitizeGuesses(42, new Set())).toEqual([]);
    expect(sanitizeGuesses([], new Set())).toEqual([]);
    expect(sanitizeGuesses({ items: "nope" }, new Set())).toEqual([]);
  });

  it("treats a missing items array as an empty result", () => {
    expect(sanitizeGuesses({}, new Set())).toEqual([]);
    expect(sanitizeGuesses({ items: [] }, new Set())).toEqual([]);
  });

  it("drops individual items that fail validation but keeps valid ones", () => {
    const raw = {
      items: [
        guess({ name: "Cheese" }),
        null, // not an object → fails per-item parse
        "garbage", // not an object → fails per-item parse
        guess({ name: "   " }), // blank/whitespace name → dropped
        guess({ name: "Boxes", category: "packaging", matchedKey: null }),
      ],
    };
    const out = sanitizeGuesses(raw, new Set(["mozz"]));
    expect(out.map((g) => g.name)).toEqual(["Cheese", "Boxes"]);
  });

  it("nulls out a matchedKey that is not in the supplied candidates", () => {
    const raw = { items: [guess({ matchedKey: "ghost-key" })] };
    const out = sanitizeGuesses(raw, new Set(["mozz", "sauce"]));
    expect(out).toHaveLength(1);
    expect(out[0].matchedKey).toBeNull();
  });

  it("keeps a matchedKey that is present in the supplied candidates", () => {
    const raw = { items: [guess({ matchedKey: "mozz" })] };
    const out = sanitizeGuesses(raw, new Set(["mozz", "sauce"]));
    expect(out[0].matchedKey).toBe("mozz");
  });

  it("clamps confidence into the 0..1 range", () => {
    const raw = {
      items: [
        guess({ name: "High", confidence: 5 }),
        guess({ name: "Low", confidence: -2 }),
        guess({ name: "Mid", confidence: 0.42 }),
      ],
    };
    const out = sanitizeGuesses(raw, new Set(["mozz"]));
    const byName = Object.fromEntries(out.map((g) => [g.name, g.confidence]));
    expect(byName.High).toBe(1);
    expect(byName.Low).toBe(0);
    expect(byName.Mid).toBeCloseTo(0.42);
  });

  it("defaults a missing confidence to 0", () => {
    const raw = { items: [guess({ name: "No-conf", confidence: undefined })] };
    const out = sanitizeGuesses(raw, new Set(["mozz"]));
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBe(0);
  });

  it("drops an item whose confidence cannot be coerced to a number", () => {
    const raw = { items: [guess({ name: "Bad-conf", confidence: "not-a-number" })] };
    const out = sanitizeGuesses(raw, new Set(["mozz"]));
    expect(out).toEqual([]);
  });

  it("normalizes category to ingredient unless it is exactly packaging", () => {
    const raw = {
      items: [
        guess({ name: "A", category: "PACKAGING" }),
        guess({ name: "B", category: "ingredient" }),
        guess({ name: "C", category: "random-garbage" }),
        guess({ name: "D", category: undefined }),
      ],
    };
    const out = sanitizeGuesses(raw, new Set(["mozz"]));
    const byName = Object.fromEntries(out.map((g) => [g.name, g.category]));
    expect(byName.A).toBe("packaging");
    expect(byName.B).toBe("ingredient");
    expect(byName.C).toBe("ingredient");
    expect(byName.D).toBe("ingredient");
  });

  it("coerces and floors invalid quantities to 0 and defaults a blank unit", () => {
    const raw = {
      items: [
        guess({ name: "Neg", qty: -4, unit: "" }),
        guess({ name: "Zero", qty: 0 }),
        guess({ name: "Str", qty: "7" }),
      ],
    };
    const out = sanitizeGuesses(raw, new Set(["mozz"]));
    const byName = Object.fromEntries(out.map((g) => [g.name, g]));
    expect(byName.Neg.qty).toBe(0);
    expect(byName.Neg.unit).toBe("units");
    expect(byName.Zero.qty).toBe(0);
    expect(byName.Str.qty).toBe(7);
  });
});

describe("validateIdentifyPhotoBody", () => {
  const validImage = "a".repeat(32);

  it("rejects a missing imageBase64 with 400", () => {
    const result = validateIdentifyPhotoBody({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("rejects a too-short imageBase64 with 400", () => {
    const result = validateIdentifyPhotoBody({ imageBase64: "tooshort" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe("imageBase64 required");
    }
  });

  it("rejects an oversized imageBase64 with 413", () => {
    const result = validateIdentifyPhotoBody({
      imageBase64: "a".repeat(MAX_IMAGE_BASE64_CHARS + 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(413);
  });

  it("rejects too many candidates with 400", () => {
    const candidates = Array.from({ length: MAX_CANDIDATES + 1 }, (_, i) => ({
      key: `k${i}`,
      category: "ingredient",
      name: `n${i}`,
      unit: "cases",
    }));
    const result = validateIdentifyPhotoBody({ imageBase64: validImage, candidates });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("accepts a valid body and returns the candidate key set", () => {
    const result = validateIdentifyPhotoBody({
      imageBase64: validImage,
      candidates: [
        { key: "mozz", category: "ingredient", name: "Mozzarella", unit: "cases" },
        { key: "box", category: "packaging", name: "Boxes", unit: "cases" },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidateKeys).toEqual(new Set(["mozz", "box"]));
      expect(result.data.imageBase64).toBe(validImage);
    }
  });

  it("accepts a valid body with no candidates and returns an empty key set", () => {
    const result = validateIdentifyPhotoBody({ imageBase64: validImage });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.candidateKeys.size).toBe(0);
  });

  it("rejects a candidate with an oversized name/key/unit/category with 400", () => {
    const base = { key: "mozz", category: "ingredient", name: "Mozzarella", unit: "cases" };
    for (const field of ["key", "category", "name", "unit"] as const) {
      const result = validateIdentifyPhotoBody({
        imageBase64: validImage,
        candidates: [{ ...base, [field]: "x".repeat(5000) }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    }
  });
});
