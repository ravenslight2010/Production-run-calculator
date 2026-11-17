// Tests for the shared corrections-memory logic in @workspace/ai-memory.
// Web and mobile both consume this lib, so testing it once here covers both.
import { describe, it, expect } from "vitest";
import {
  correctionKey,
  normalizeCorrections,
  dropConflictingCorrections,
  filterCorrectionsByDomain,
  buildCorrectionsBlock,
  MAX_CORRECTION_TEXT_LEN,
  type AiCorrection,
  knowledgeKey,
  normalizeKnowledge,
  filterKnowledgeByDomain,
  buildKnowledgeBlock,
  MAX_KNOWLEDGE_FACT_LEN,
  type FacilityKnowledge,
  normalizeConversationTurns,
  trimConversationWindow,
  buildConversationBlock,
  MAX_TURN_TEXT_LEN,
  type ConversationTurn,
  auditAiMemory,
} from "@workspace/ai-memory";

describe("correctionKey", () => {
  it("is case-insensitive and trims domain + fromText", () => {
    expect(correctionKey("Ingredient", "  Mozz ")).toBe(correctionKey("ingredient", "mozz"));
  });

  it("separates domain from name so the same name in two domains differs", () => {
    expect(correctionKey("brand", "Acme")).not.toBe(correctionKey("flavor", "Acme"));
  });
});

describe("normalizeCorrections", () => {
  it("trims, drops blanks, and drops self-references", () => {
    const out = normalizeCorrections([
      { domain: "ingredient", fromText: "  Mozz ", toText: " Mozzarella " },
      { domain: "ingredient", fromText: "Same", toText: "same" },
      { domain: "", fromText: "x", toText: "y" },
      { domain: "brand", fromText: "  ", toText: "y" },
      { domain: "brand", fromText: "x", toText: "" },
      null,
      undefined,
    ]);
    expect(out).toEqual([{ domain: "ingredient", fromText: "Mozz", toText: "Mozzarella" }]);
  });

  it("dedupes by (domain, fromText) case-insensitively with last write winning", () => {
    const out = normalizeCorrections([
      { domain: "ingredient", fromText: "Mozz", toText: "Mozzarella" },
      { domain: "Ingredient", fromText: "MOZZ", toText: "Whole Milk Mozzarella" },
    ]);
    expect(out).toEqual([
      { domain: "Ingredient", fromText: "MOZZ", toText: "Whole Milk Mozzarella" },
    ]);
  });

  it("keeps the same name across different domains as separate entries", () => {
    const out = normalizeCorrections([
      { domain: "brand", fromText: "Acme", toText: "Acme Foods" },
      { domain: "flavor", fromText: "Acme", toText: "Acme Classic" },
    ]);
    expect(out).toHaveLength(2);
  });

  it("caps each field to the max length", () => {
    const long = "x".repeat(MAX_CORRECTION_TEXT_LEN + 50);
    const out = normalizeCorrections([{ domain: "d".repeat(300), fromText: long, toText: "y" }]);
    expect(out[0]?.domain.length).toBe(MAX_CORRECTION_TEXT_LEN);
    expect(out[0]?.fromText.length).toBe(MAX_CORRECTION_TEXT_LEN);
  });

  it("bounds the count when limit is given", () => {
    const raw = Array.from({ length: 10 }, (_, i) => ({
      domain: "ingredient",
      fromText: `from-${i}`,
      toText: `to-${i}`,
    }));
    expect(normalizeCorrections(raw, { limit: 3 })).toHaveLength(3);
  });

  it("returns [] for null/undefined/garbage", () => {
    expect(normalizeCorrections(null)).toEqual([]);
    expect(normalizeCorrections(undefined)).toEqual([]);
    expect(normalizeCorrections([42 as unknown as AiCorrection])).toEqual([]);
  });
});

describe("dropConflictingCorrections", () => {
  it("drops both directions of a contradictory cycle within a domain", () => {
    const out = dropConflictingCorrections([
      { domain: "flavor", fromText: "PEPPERONI", toText: "ULTIMATE PEPPERONI" },
      { domain: "flavor", fromText: "ULTIMATE PEPPERONI", toText: "PEPPERONI" },
    ]);
    expect(out).toEqual([]);
  });

  it("drops the whole chain/collapse when a target is also a source", () => {
    // Real-world pollution: several unrelated flavors mapped to one target that
    // is itself re-mapped ("Red Hot Chicken" is both a target and a source).
    const out = dropConflictingCorrections([
      { domain: "flavor", fromText: "CHICKEN TIKKA MASALA", toText: "Red Hot Chicken" },
      { domain: "flavor", fromText: "CLUB", toText: "Red Hot Chicken" },
      { domain: "flavor", fromText: "Red Hot Chicken", toText: "Red Hot" },
      { domain: "flavor", fromText: "Buffalo Chicken", toText: "BBQ Chicken" },
    ]);
    expect(out).toEqual([
      { domain: "flavor", fromText: "Buffalo Chicken", toText: "BBQ Chicken" },
    ]);
  });

  it("keeps coherent many-to-one mappings (legit for ingredient/item domains)", () => {
    const input: AiCorrection[] = [
      { domain: "ingredient", fromText: "mozz", toText: "Whole Mozzarella" },
      { domain: "ingredient", fromText: "mozzarella cheese", toText: "Whole Mozzarella" },
    ];
    expect(dropConflictingCorrections(input)).toEqual(input);
  });

  it("scopes conflicts by domain (same name in two domains is independent)", () => {
    const input: AiCorrection[] = [
      { domain: "flavor", fromText: "Pep", toText: "Pepperoni" },
      { domain: "brand", fromText: "Pepperoni", toText: "Acme" },
    ];
    expect(dropConflictingCorrections(input)).toEqual(input);
  });
});

describe("filterCorrectionsByDomain", () => {
  const pool: AiCorrection[] = [
    { domain: "ingredient", fromText: "Mozz", toText: "Mozzarella" },
    { domain: "brand", fromText: "Acme", toText: "Acme Foods" },
    { domain: "flavor", fromText: "Pep", toText: "Pepperoni" },
  ];

  it("keeps only allow-listed domains, case-insensitively", () => {
    const out = filterCorrectionsByDomain(pool, ["Ingredient", "FLAVOR"]);
    expect(out.map((c) => c.domain)).toEqual(["ingredient", "flavor"]);
  });

  it("returns [] when nothing matches", () => {
    expect(filterCorrectionsByDomain(pool, ["die"])).toEqual([]);
  });
});

describe("buildCorrectionsBlock", () => {
  const pool: AiCorrection[] = [
    { domain: "ingredient", fromText: "Mozz", toText: "Mozzarella" },
    { domain: "brand", fromText: "Acme", toText: "Acme Foods" },
  ];

  it("returns an empty string for an empty pool", () => {
    expect(buildCorrectionsBlock([])).toBe("");
  });

  it("renders a heading plus one line per correction with domain tags", () => {
    const block = buildCorrectionsBlock(pool);
    expect(block).toContain("GLOBAL KNOWN CORRECTIONS");
    expect(block).toContain('[ingredient] "Mozz" => "Mozzarella"');
    expect(block).toContain('[brand] "Acme" => "Acme Foods"');
  });

  it("honors a custom heading and a limit (keeps the first N)", () => {
    const block = buildCorrectionsBlock(pool, { heading: "PAST FIXES:", limit: 1 });
    expect(block).toContain("PAST FIXES:");
    expect(block).toContain("Mozz");
    expect(block).not.toContain("Acme");
  });
});

describe("knowledgeKey", () => {
  it("is case-insensitive and trims domain + key", () => {
    expect(knowledgeKey("Downtime", "  Oven-1 ")).toBe(knowledgeKey("downtime", "oven-1"));
  });

  it("separates domain from key so the same key in two domains differs", () => {
    expect(knowledgeKey("downtime", "x")).not.toBe(knowledgeKey("throughput", "x"));
  });
});

describe("normalizeKnowledge", () => {
  it("trims, drops blanks/incomplete entries", () => {
    const out = normalizeKnowledge([
      { domain: "downtime", key: "  oven-1 ", fact: "  Oven 1 jams hourly  " },
      { domain: "", key: "x", fact: "y" },
      { domain: "d", key: "  ", fact: "y" },
      { domain: "d", key: "k", fact: "" },
      null,
      undefined,
    ]);
    expect(out).toEqual([{ domain: "downtime", key: "oven-1", fact: "Oven 1 jams hourly" }]);
  });

  it("dedupes by (domain, key) case-insensitively with last write winning", () => {
    const out = normalizeKnowledge([
      { domain: "downtime", key: "oven-1", fact: "jams hourly" },
      { domain: "Downtime", key: "OVEN-1", fact: "jams every 30 min" },
    ]);
    expect(out).toEqual([{ domain: "Downtime", key: "OVEN-1", fact: "jams every 30 min" }]);
  });

  it("keeps the same key across different domains as separate entries", () => {
    const out = normalizeKnowledge([
      { domain: "downtime", key: "line-a", fact: "stalls" },
      { domain: "throughput", key: "line-a", fact: "fast" },
    ]);
    expect(out).toHaveLength(2);
  });

  it("caps the fact to the max length", () => {
    const long = "x".repeat(MAX_KNOWLEDGE_FACT_LEN + 50);
    const out = normalizeKnowledge([{ domain: "general", key: "k", fact: long }]);
    expect(out[0]?.fact.length).toBe(MAX_KNOWLEDGE_FACT_LEN);
  });

  it("bounds the count when limit is given", () => {
    const raw = Array.from({ length: 10 }, (_, i) => ({
      domain: "general",
      key: `k-${i}`,
      fact: `fact-${i}`,
    }));
    expect(normalizeKnowledge(raw, { limit: 3 })).toHaveLength(3);
  });

  it("returns [] for null/undefined/garbage", () => {
    expect(normalizeKnowledge(null)).toEqual([]);
    expect(normalizeKnowledge(undefined)).toEqual([]);
    expect(normalizeKnowledge([42 as unknown as FacilityKnowledge])).toEqual([]);
  });
});

describe("filterKnowledgeByDomain", () => {
  const pool: FacilityKnowledge[] = [
    { domain: "downtime", key: "a", fact: "1" },
    { domain: "throughput", key: "b", fact: "2" },
    { domain: "incident", key: "c", fact: "3" },
  ];

  it("keeps only allow-listed domains, case-insensitively", () => {
    const out = filterKnowledgeByDomain(pool, ["Downtime", "INCIDENT"]);
    expect(out.map((e) => e.domain)).toEqual(["downtime", "incident"]);
  });

  it("returns [] when nothing matches", () => {
    expect(filterKnowledgeByDomain(pool, ["weather"])).toEqual([]);
  });
});

describe("buildKnowledgeBlock", () => {
  const pool: FacilityKnowledge[] = [
    { domain: "downtime", key: "a", fact: "Oven 1 jams hourly" },
    { domain: "throughput", key: "b", fact: "Line A averages 90 PPM" },
  ];

  it("returns an empty string for an empty pool", () => {
    expect(buildKnowledgeBlock([])).toBe("");
  });

  it("renders a heading plus one line per fact with domain tags", () => {
    const block = buildKnowledgeBlock(pool);
    expect(block).toContain("FACILITY MEMORY");
    expect(block).toContain("[downtime] Oven 1 jams hourly");
    expect(block).toContain("[throughput] Line A averages 90 PPM");
  });

  it("honors a custom heading and a limit (keeps the first N)", () => {
    const block = buildKnowledgeBlock(pool, { heading: "KNOWN:", limit: 1 });
    expect(block).toContain("KNOWN:");
    expect(block).toContain("Oven 1");
    expect(block).not.toContain("Line A");
  });
});

describe("normalizeConversationTurns", () => {
  it("coerces role, trims, drops blanks, and preserves order", () => {
    const out = normalizeConversationTurns([
      { role: "user", text: "  hi  " },
      { role: "weird", text: "treated as user" },
      { role: "assistant", text: "hello" },
      { role: "user", text: "   " },
      null,
    ]);
    expect(out).toEqual([
      { role: "user", text: "hi" },
      { role: "user", text: "treated as user" },
      { role: "assistant", text: "hello" },
    ]);
  });

  it("caps text length and keeps only the most recent window", () => {
    const long = "x".repeat(MAX_TURN_TEXT_LEN + 10);
    const raw = [
      { role: "user", text: long },
      { role: "assistant", text: "a" },
      { role: "user", text: "b" },
    ];
    const out = normalizeConversationTurns(raw, { window: 2 });
    expect(out).toHaveLength(2);
    expect(out.map((t) => t.text)).toEqual(["a", "b"]);
  });

  it("returns [] for null/undefined", () => {
    expect(normalizeConversationTurns(null)).toEqual([]);
    expect(normalizeConversationTurns(undefined)).toEqual([]);
  });
});

describe("trimConversationWindow", () => {
  const turns: ConversationTurn[] = [
    { role: "user", text: "1" },
    { role: "assistant", text: "2" },
    { role: "user", text: "3" },
  ];

  it("keeps the last N turns", () => {
    expect(trimConversationWindow(turns, 2).map((t) => t.text)).toEqual(["2", "3"]);
  });

  it("returns the list unchanged when window is non-positive or larger", () => {
    expect(trimConversationWindow(turns, 0)).toEqual(turns);
    expect(trimConversationWindow(turns, 99)).toEqual(turns);
  });
});

describe("buildConversationBlock", () => {
  const turns: ConversationTurn[] = [
    { role: "user", text: "How many runs left?" },
    { role: "assistant", text: "Three." },
  ];

  it("returns an empty string for an empty history", () => {
    expect(buildConversationBlock([])).toBe("");
  });

  it("renders a heading plus User/Assistant lines oldest first", () => {
    const block = buildConversationBlock(turns);
    expect(block).toContain("RECENT CONVERSATION");
    expect(block).toContain("User: How many runs left?");
    expect(block).toContain("Assistant: Three.");
    expect(block.indexOf("User:")).toBeLessThan(block.indexOf("Assistant:"));
  });

  it("keeps only the last N turns when a limit is given", () => {
    const block = buildConversationBlock(turns, { limit: 1 });
    expect(block).toContain("Three.");
    expect(block).not.toContain("How many runs left?");
  });
});

describe("auditAiMemory", () => {
  const correction = (id: number, fromText: string, toText: string, domain = "ingredient") => ({
    id,
    domain,
    fromText,
    toText,
  });

  it("returns a read-only deterministic plan for duplicates, chains, cycles, and canonical target changes", () => {
    const input = {
      corrections: [
        correction(1, "Old Mozz", "Mozz"),
        correction(2, "Old Mozz", "Mozz"), // duplicate database row
        correction(3, "Legacy", "Middle"),
        correction(4, "Middle", "Current"),
        correction(5, "Round", "Square", "die"),
        correction(6, "Square", "Round", "die"),
        correction(7, "Old Brand", "No Longer Current", "brand"),
      ],
      facilityKnowledge: [],
      canonicalAliases: [
        { domain: "brand", fromText: "Old Brand", toText: "Current Brand", source: "merge alias" },
      ],
      activeNamesByDomain: {
        ingredient: ["Mozz", "Current"],
        brand: ["Current Brand"],
        die: ["Round", "Square"],
      },
    };
    const before = JSON.parse(JSON.stringify(input));
    const report = auditAiMemory(input);

    expect(report.correctionFindings.find((f) => f.entry.id === 2)?.status).toBe("duplicate");
    expect(report.correctionFindings.find((f) => f.entry.id === 3)?.status).toBe("chain");
    expect(report.correctionFindings.find((f) => f.entry.id === 5)?.status).toBe("cycle");
    expect(report.correctionFindings.find((f) => f.entry.id === 6)?.status).toBe("cycle");
    const outdated = report.correctionFindings.find((f) => f.entry.id === 7);
    expect(outdated?.status).toBe("outdated-target");
    expect(outdated?.safeRepair).toMatchObject({
      action: "retarget",
      after: { toText: "Current Brand" },
    });
    expect(report.safeRepairs).toHaveLength(5);
    expect(input).toEqual(before);
    expect(report.conversationHistoryExcluded).toBe(true);
  });

  it("keeps historic merged-away source aliases and only flags a missing target for review", () => {
    const report = auditAiMemory({
      corrections: [
        correction(1, "Historic Source", "Active Ingredient"),
        correction(2, "Unknown Source", "Missing Target"),
      ],
      facilityKnowledge: [],
      canonicalAliases: [],
      activeNamesByDomain: { ingredient: ["Active Ingredient"] },
      mergedAwayNames: ["historic source"],
    });
    expect(report.correctionFindings.map((finding) => finding.status)).toEqual(["healthy", "orphaned"]);
    expect(report.safeRepairs).toHaveLength(0);
  });

  it("reports facility facts separately without generating a delete plan", () => {
    const report = auditAiMemory({
      corrections: [],
      facilityKnowledge: [
        { id: 10, domain: "general", key: "first", fact: "Old Mozz is preferred.", source: "retired-tool" },
        { id: 11, domain: "general", key: "second", fact: "Old Mozz is preferred.", source: "retired-tool" },
      ],
      canonicalAliases: [
        { domain: "ingredient", fromText: "Old Mozz", toText: "Whole Mozz", source: "merge alias" },
      ],
      activeNamesByDomain: { ingredient: ["Whole Mozz"] },
      knownFacilitySources: ["current-tool"],
    });
    expect(report.facilityKnowledgeFindings.map((finding) => finding.status)).toEqual([
      "superseded-name-reference",
      "exact-duplicate",
    ]);
    expect(report.safeRepairs).toEqual([]);
  });
});
