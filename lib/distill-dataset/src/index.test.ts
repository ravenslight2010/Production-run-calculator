import { describe, expect, it } from "vitest";
import {
  assertNoCrossPartitionContentDuplicates,
  assignBrandPartitions,
  assessTrainSafety,
  canonicalJson,
  createApplyLogCandidate,
  jaccard,
  hashCriticalGoldEvidence,
  hashHumanApplyRecord,
  levenshteinDistance,
  normalizeForNearDup,
  redactPrivateCopy,
  sha256,
  shingleSet,
  trainNearDupFlags,
  validateRedactionConfig,
  verifyCandidate,
} from "./index.js";

const systemPrompt = "Production system prompt with the NaN defect fixed.";
const promptHash = sha256(systemPrompt);
const sourceText = "Brand\tAlpine\nAllergen\tNone";
const criticalFields = ["profile.brand", "profile.pizzasPerCase"];

function corpusCandidate(overrides: Record<string, unknown> = {}) {
  const sourceSha256 = sha256(sourceText);
  const goldValues = {
    "profile.brand": "Alpine Foods",
    "profile.pizzasPerCase": 12,
  };
  return {
    source: "corpus",
    brand: "Alpine Foods",
    sourceText,
    userContent: `Parse this workbook:\n${sourceText}`,
    assistantText: '{"profile":{"brand":"Alpine Foods","pizzasPerCase":12}}',
    criticalFields,
    parseVersion: "41",
    systemPromptSha256: promptHash,
    goldValues,
    deterministicValues: {
      profile: { brand: "Alpine Foods", pizzasPerCase: 12 },
    },
    goldEvidence: {
      kind: "independent-human-gold",
      reviewerCapability: "review-spec-gold",
      sourceSha256,
      reviewerIdSha256: "a".repeat(64),
      reviewedAt: "2026-10-02T12:00:00.000Z",
      fieldPaths: criticalFields,
      goldValuesSha256: hashCriticalGoldEvidence({
        sourceSha256,
        criticalFields,
        goldValues,
      }),
    },
    ...overrides,
  };
}

function applyCandidate(overrides: Record<string, unknown> = {}) {
  const sourceSha256 = sha256(sourceText);
  const humanApply = {
    operationId: "op_1234567890123456",
    scope: "live" as const,
    status: "applied" as const,
    actorCapability: "manage-profiles",
    actorIdSha256: "b".repeat(64),
    appliedAt: "2026-10-02T12:01:00.000Z",
    sourceSha256,
    appliedValues: {
      profile: { brand: "Alpine Foods", pizzasPerCase: 12 },
    },
  };
  return {
    source: "applylog",
    brand: "Alpine Foods",
    sourceText,
    userContent: `Parse this workbook:\n${sourceText}`,
    assistantText: '{"profile":{"brand":"Alpine Foods","pizzasPerCase":10}}',
    criticalFields,
    parseVersion: "41",
    systemPromptSha256: promptHash,
    humanApply: {
      ...humanApply,
      recordSha256: hashHumanApplyRecord(humanApply),
    },
    ...overrides,
  };
}

describe("verified candidate handling", () => {
  it("creates a verified source-bound candidate only from an authorized completed live Apply", () => {
    const record = {
      operationId: "import_1234567890123456",
      importType: "spec",
      scope: "live",
      status: "applied",
      undoneAt: null,
      actorCapability: "manage-profiles",
      actorIdSha256: "b".repeat(64),
      sourceSha256: sha256(sourceText),
      appliedAt: "2026-10-02T12:01:00.000Z",
      sourceText,
      parseVersion: "41",
      appliedValues: {
        brandProfiles: [{ brand: "Alpine Foods", flavor: "Four Cheese", values: { pizzasPerCase: 12 } }],
      },
    };
    const candidate = createApplyLogCandidate(record, {
      systemPromptSha256: promptHash,
      currentParseVersion: "41",
    });
    expect(candidate?.sourceText).toBe(sourceText);
    expect(candidate?.humanApply?.appliedValues).toEqual(record.appliedValues);
    expect(candidate?.humanApply?.sourceSha256).toBe(sha256(sourceText));
    expect(candidate && verifyCandidate(candidate, {
      systemPromptSha256: promptHash,
      currentParseVersion: "41",
    }).state).toBe("verified");
  });

  it.each([
    ["unauthorized capability", { actorCapability: "manage-inventory" }],
    ["missing source", { sourceText: null }],
    ["undone", { status: "undone", undoneAt: "2026-10-02T12:02:00.000Z" }],
    ["pending", { status: "applying" }],
  ])("rejects Apply export record with %s", (_label, overrides) => {
    const record = {
      operationId: "import_1234567890123456",
      importType: "spec",
      scope: "live",
      status: "applied",
      undoneAt: null,
      actorCapability: "manage-profiles",
      actorIdSha256: "b".repeat(64),
      appliedAt: "2026-10-02T12:01:00.000Z",
      sourceText,
      parseVersion: "41",
      appliedValues: {
        brandProfiles: [{ brand: "Alpine Foods", flavor: "Four Cheese" }],
      },
      ...overrides,
    };
    expect(createApplyLogCandidate(record, {
      systemPromptSha256: promptHash,
      currentParseVersion: "41",
    })).toBeNull();
  });

  it("accepts exact deterministic agreement backed by independent source labels", () => {
    const result = verifyCandidate(corpusCandidate(), {
      systemPromptSha256: promptHash,
      currentParseVersion: "41",
    });
    expect(result.state).toBe("verified");
    if (result.state !== "verified") return;
    expect(result.candidate.verificationPath).toBe("deterministic-agreement");
    expect(result.candidate.assistantContent).toBe(
      '{"profile":{"brand":"Alpine Foods","pizzasPerCase":12}}',
    );
    const safety = assessTrainSafety(
      {
        parseVersion: result.candidate.parseVersion,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: result.candidate.userContent },
          { role: "assistant", content: result.candidate.assistantContent },
        ],
      },
      {
        criticalFields,
        goldValues: result.candidate.goldValues,
        expectedSystemPrompt: systemPrompt,
        currentParseVersion: "41",
        sourceSha256: result.candidate.sourceSha256,
        sourceEvidenceSha256: result.candidate.sourceEvidenceSha256,
      },
    );
    expect(safety).toEqual({ safe: true, reasons: [] });
  });

  it("accepts an authorized Apply record and records edit distance for a correction", () => {
    const result = verifyCandidate(applyCandidate(), {
      systemPromptSha256: promptHash,
      currentParseVersion: "41",
    });
    expect(result.state).toBe("verified");
    if (result.state !== "verified") return;
    expect(result.candidate.verificationPath).toBe("human-apply");
    expect(result.candidate.editDistance).toBeGreaterThan(0);
    expect(result.candidate.assistantContent).toBe(
      '{"profile":{"brand":"Alpine Foods","pizzasPerCase":12}}',
    );
  });

  it("quarantines mismatches with reviewable reason codes", () => {
    const candidate = corpusCandidate({
      assistantText: '{"profile":{"brand":"Alpine Foods","pizzasPerCase":10}}',
    });
    const result = verifyCandidate(candidate, {
      systemPromptSha256: promptHash,
      currentParseVersion: "41",
    });
    expect(result.state).toBe("quarantine");
    if (result.state !== "quarantine") return;
    expect(result.reasons).toContain("assistant_mismatch:profile.pizzasPerCase");
  });

  it("quarantines gold values when their digest no longer matches the source-backed values", () => {
    const candidate = corpusCandidate() as ReturnType<typeof corpusCandidate> & {
      goldEvidence: { goldValuesSha256: string };
    };
    candidate.goldEvidence.goldValuesSha256 = "f".repeat(64);
    const result = verifyCandidate(candidate, {
      systemPromptSha256: promptHash,
      currentParseVersion: "41",
    });
    expect(result.state).toBe("quarantine");
    if (result.state !== "quarantine") return;
    expect(result.reasons).toContain("gold_values_hash_mismatch");
  });

  it("binds each candidate ID to its complete input record", () => {
    const original = verifyCandidate(corpusCandidate(), {
      systemPromptSha256: promptHash,
      currentParseVersion: "41",
    });
    const changed = verifyCandidate(corpusCandidate({
      assistantText: '{"profile":{"brand":"Alpine Foods","pizzasPerCase":13}}',
    }), {
      systemPromptSha256: promptHash,
      currentParseVersion: "41",
    });
    expect(original.id).not.toBe(changed.id);
  });

  it("quarantines Apply evidence that is not a committed manager-authorized action", () => {
    const result = verifyCandidate(applyCandidate({
      humanApply: {
        ...applyCandidate().humanApply,
        status: "undone",
        actorCapability: "read-only",
      },
    }), {
      systemPromptSha256: promptHash,
      currentParseVersion: "41",
    });
    expect(result.state).toBe("quarantine");
    if (result.state !== "quarantine") return;
    expect(result.reasons).toContain("apply_record_not_applied");
    expect(result.reasons).toContain("apply_actor_not_authorized");
  });

  it("quarantines malformed Apply evidence instead of throwing", () => {
    const result = verifyCandidate(applyCandidate({
      humanApply: { scope: "live", appliedValues: "not-an-object" },
    }), {
      systemPromptSha256: promptHash,
      currentParseVersion: "41",
    });
    expect(result.state).toBe("quarantine");
    if (result.state !== "quarantine") return;
    expect(result.reasons).toContain("apply_record_hash_mismatch");
  });

  it("quarantines prompt and schema drift", () => {
    const result = verifyCandidate(corpusCandidate({
      parseVersion: "40",
      systemPromptSha256: "c".repeat(64),
    }), {
      systemPromptSha256: promptHash,
      currentParseVersion: "41",
    });
    expect(result.state).toBe("quarantine");
    if (result.state !== "quarantine") return;
    expect(result.reasons).toContain("parse_version_mismatch");
    expect(result.reasons).toContain("production_prompt_mismatch");
  });
});

describe("redaction and brand partitions", () => {
  it("redacts configured table columns on a copy while preserving row and cell structure", () => {
    const source = "Supplier\tUnit Price\tIngredient\nAcme Foods\t$2.50\tMozzarella";
    const config = validateRedactionConfig({
      version: 1,
      replacement: "[REDACTED]",
      sensitiveHeaders: ["Supplier", "Unit Price"],
    });
    const redacted = redactPrivateCopy(source, config);
    expect(redacted).toBe("Supplier\tUnit Price\tIngredient\n[REDACTED]\t[REDACTED]\tMozzarella");
    expect(source).toContain("Acme Foods");
    expect(redacted.split("\n")[1]?.split("\t")).toHaveLength(3);
  });

  it("redacts configured exact values without changing tab/newline layout", () => {
    const config = validateRedactionConfig({
      version: 1,
      replacement: "[REDACTED]",
      sensitiveHeaders: [],
      literalValues: ["Acme Foods"],
    });
    const result = redactPrivateCopy("Vendor: Acme Foods\nRows\t1", config);
    expect(result).toBe("Vendor: [REDACTED]\nRows\t1");
  });

  it("rejects redaction replacements that could change workbook cell structure", () => {
    expect(() => validateRedactionConfig({
      version: 1,
      replacement: "\t",
      sensitiveHeaders: ["Supplier"],
    })).toThrow("single-cell");
  });

  it("uses deterministic 70/15/15 brand allocation with a holdout brand at seven or more", () => {
    const brands = Array.from({ length: 20 }, (_, index) => `Brand ${index}`);
    const result = assignBrandPartitions(brands);
    const counts = [...result.partitions.values()].reduce<Record<string, number>>((acc, value) => {
      acc[value] = (acc[value] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ train: 14, development: 3, holdout: 3 });
    expect(result.warnings).toEqual([]);
  });

  it("preserves an evaluation holdout on an equal largest-remainder tie", () => {
    const result = assignBrandPartitions(Array.from({ length: 10 }, (_, index) => `Brand ${index}`));
    expect([...result.partitions.values()].filter((partition) => partition === "holdout")).toHaveLength(2);
    expect([...result.partitions.values()].filter((partition) => partition === "development")).toHaveLength(1);
  });

  it("warns below seven brands and never silently invents a holdout", () => {
    const result = assignBrandPartitions(["A", "B", "C", "D", "E", "F"]);
    expect(result.warnings.some((warning) => warning.includes("small brand holdout"))).toBe(true);
    expect([...result.partitions.values()].filter((partition) => partition === "holdout")).toHaveLength(1);
  });
});

describe("exact and near-duplicate controls", () => {
  it("blocks exact content hashes across live partitions", () => {
    expect(() => assertNoCrossPartitionContentDuplicates([
      { contentSha256: "d".repeat(64), partition: "train" },
      { contentSha256: "d".repeat(64), partition: "holdout" },
    ])).toThrow("content hash leak");
  });

  it("does not treat two empty texts as near duplicates", () => {
    expect(jaccard(shingleSet(""), shingleSet(""))).toBe(0);
    expect(trainNearDupFlags(
      [{ id: "train-a", text: "" }],
      [{ id: "holdout-a", text: "" }],
    ).get("train-a")?.flag).toBe(false);
  });

  it("flags highly overlapping training input against development or holdout input", () => {
    const left = "brand alpine cheese crust mozzarella shredded cheese 12 pizzas per case";
    const right = "brand alpine cheese crust mozzarella shredded cheese 12 pizzas per case";
    expect(normalizeForNearDup("  BRÄND\tALPINE  ")).toBe("bränd alpine");
    const flags = trainNearDupFlags(
      [{ id: "train-a", text: left }],
      [{ id: "holdout-a", text: right }],
    );
    expect(flags.get("train-a")).toMatchObject({ flag: true, matchedId: "holdout-a" });
  });

  it("binds canonical hashing to structured values and keeps quarantine out of duplicate fences", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(() => assertNoCrossPartitionContentDuplicates([
      { contentSha256: "e".repeat(64), partition: "train" },
      { contentSha256: "e".repeat(64), partition: "quarantine" },
    ])).not.toThrow();
  });

  it("calculates deterministic edit distance", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
    expect(levenshteinDistance("", "abc")).toBe(3);
  });
});