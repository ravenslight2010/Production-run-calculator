import { describe, it, expect } from "vitest";
import {
  buildSuggestMergesPrompt,
  sanitizeSuggestMerges,
  validateSuggestMergesBody,
  MAX_MERGE_NAMES,
  MAX_MERGE_ALIASES,
  MAX_MERGE_NAME_LEN,
} from "./aiSuggestMerges";

describe("validateSuggestMergesBody — happy path", () => {
  it("accepts a well-formed body and returns the cleaned names/aliases", () => {
    const result = validateSuggestMergesBody({
      names: ["Mozzarella", "Mozz", "Pepperoni"],
      aliases: [{ externalName: "Mozz", canonicalName: "Mozzarella" }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.names).toEqual(["Mozzarella", "Mozz", "Pepperoni"]);
      expect(result.data.aliases).toEqual([
        { externalName: "Mozz", canonicalName: "Mozzarella" },
      ]);
    }
  });

  it("accepts a body with only names (aliases optional)", () => {
    const result = validateSuggestMergesBody({ names: ["Cheese"] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.aliases).toEqual([]);
  });
});

describe("validateSuggestMergesBody — name cleaning", () => {
  it("trims, drops blanks, and dedupes case-insensitively", () => {
    const result = validateSuggestMergesBody({
      names: ["  Mozz  ", "mozz", "MOZZ", "", "   ", "Sauce"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // First-seen spelling wins; later case variants and blanks dropped.
      expect(result.data.names).toEqual(["Mozz", "Sauce"]);
    }
  });

  it("caps each name to MAX_MERGE_NAME_LEN", () => {
    const long = "x".repeat(MAX_MERGE_NAME_LEN + 50);
    const result = validateSuggestMergesBody({ names: [long] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.names[0]?.length).toBe(MAX_MERGE_NAME_LEN);
  });

  it("rejects a body whose names are all blank/whitespace", () => {
    const result = validateSuggestMergesBody({ names: ["", "   ", "\t"] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });
});

describe("validateSuggestMergesBody — cost-abuse guards", () => {
  it("does NOT let blank-string padding bypass the MAX_MERGE_NAMES cap", () => {
    // One real name plus a flood of blanks must NOT explode the prompt: the
    // blanks are dropped, so this is a tiny (valid) request, not an oversized one.
    const padded = ["RealName", ...Array.from({ length: MAX_MERGE_NAMES * 2 }, () => "")];
    const result = validateSuggestMergesBody({ names: padded });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.names).toEqual(["RealName"]);
    }
  });

  it("rejects more than MAX_MERGE_NAMES distinct real names", () => {
    const names = Array.from({ length: MAX_MERGE_NAMES + 1 }, (_, i) => `name-${i}`);
    const result = validateSuggestMergesBody({ names });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain(String(MAX_MERGE_NAMES));
    }
  });

  it("accepts exactly MAX_MERGE_NAMES distinct names", () => {
    const names = Array.from({ length: MAX_MERGE_NAMES }, (_, i) => `name-${i}`);
    const result = validateSuggestMergesBody({ names });
    expect(result.ok).toBe(true);
  });

  it("rejects more than MAX_MERGE_ALIASES real aliases", () => {
    const aliases = Array.from({ length: MAX_MERGE_ALIASES + 1 }, (_, i) => ({
      externalName: `ext-${i}`,
      canonicalName: `canon-${i}`,
    }));
    const result = validateSuggestMergesBody({ names: ["Real"], aliases });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("drops blank-padded aliases before the alias cap check", () => {
    const aliases = [
      { externalName: "Mozz", canonicalName: "Mozzarella" },
      ...Array.from({ length: MAX_MERGE_ALIASES * 2 }, () => ({
        externalName: "",
        canonicalName: "",
      })),
    ];
    const result = validateSuggestMergesBody({ names: ["Real"], aliases });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.aliases).toEqual([
        { externalName: "Mozz", canonicalName: "Mozzarella" },
      ]);
    }
  });
});

describe("validateSuggestMergesBody — schema rejection", () => {
  it("rejects non-object / malformed bodies with status 400", () => {
    for (const bad of [null, undefined, 42, "nope", {}, { names: "not-an-array" }]) {
      const result = validateSuggestMergesBody(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    }
  });
});

describe("sanitizeSuggestMerges — untrusted AI output", () => {
  const NAMES = ["Mozzarella", "Mozz", "Pepperoni", "Peperoni", "Sauce"];

  it("keeps only groups built from real names and returns known-name spellings", () => {
    const out = sanitizeSuggestMerges(
      {
        suggestions: [
          { target: "Mozzarella", sources: ["Mozz"], reason: "abbrev" },
          { target: "GhostCheese", sources: ["Mozz"] }, // target not a real name
          { target: "Pepperoni", sources: ["Hallucinated"] }, // source not real
        ],
      },
      NAMES,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.target).toBe("Mozzarella");
    expect(out[0]?.sources).toEqual(["Mozz"]);
  });

  it("collapses to [] for malformed top-level shapes", () => {
    for (const bad of [null, 42, "nope", {}, { suggestions: "x" }]) {
      expect(sanitizeSuggestMerges(bad, NAMES)).toEqual([]);
    }
  });
});

describe("buildSuggestMergesPrompt", () => {
  it("includes a non-empty system prompt and lists every name", () => {
    const input = validateSuggestMergesBody({ names: ["Mozzarella", "Mozz"] });
    if (!input.ok) throw new Error("setup failed");
    const { system, user } = buildSuggestMergesPrompt(input.data);
    expect(system.length).toBeGreaterThan(0);
    expect(user).toContain("Mozzarella");
    expect(user).toContain("Mozz");
    expect(user).toContain("NAMES:");
  });

  it("surfaces known aliases in the prompt when provided", () => {
    const input = validateSuggestMergesBody({
      names: ["Mozzarella", "Mozz"],
      aliases: [{ externalName: "Mozz", canonicalName: "Mozzarella" }],
    });
    if (!input.ok) throw new Error("setup failed");
    const { user } = buildSuggestMergesPrompt(input.data);
    expect(user).toContain("KNOWN MERGE ALIASES");
    expect(user).toContain('"Mozz" => "Mozzarella"');
  });
});
