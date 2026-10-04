import { describe, expect, it } from "vitest";
import {
  assessTrainSafety,
  assertBrandPartitionIntegrity,
  toManifestEntry,
  validateDistillManifestEntry,
  validateDistillTrainingExample,
  type DistillTrainingExample,
} from "./index.js";

const digest = "a".repeat(64);

function baseExample(
  overrides: Partial<DistillTrainingExample> = {},
): DistillTrainingExample {
  return {
    manifestVersion: 1,
    id: "brandA-spec-001-chunk01",
    partition: "train",
    brandCode: "brandA",
    verified: "human-apply",
    schemaVersion: 40,
    contentSha256: digest,
    source: "apply-log",
    createdAt: "2026-09-28T00:00:00.000Z",
    messages: [
      { role: "system", content: "Extract fields as JSON only." },
      { role: "user", content: "Workbook chunk for Brand A pizza." },
      {
        role: "assistant",
        content: JSON.stringify({ productName: "Cheese", cartonSize: 12 }),
      },
    ],
    ...overrides,
  };
}

describe("validateDistillManifestEntry", () => {
  it("accepts a complete git-safe row", () => {
    const entry = toManifestEntry(baseExample());
    expect(validateDistillManifestEntry(entry)).toEqual(entry);
  });

  it("rejects bad sha and partition", () => {
    const entry = toManifestEntry(baseExample());
    expect(() =>
      validateDistillManifestEntry({ ...entry, contentSha256: "nope" }),
    ).toThrow(/SHA-256/);
    expect(() =>
      validateDistillManifestEntry({ ...entry, partition: "prod" }),
    ).toThrow(/partition/);
  });
});

describe("validateDistillTrainingExample", () => {
  it("requires user and assistant turns", () => {
    expect(validateDistillTrainingExample(baseExample()).messages).toHaveLength(
      3,
    );
    expect(() =>
      validateDistillTrainingExample(
        baseExample({
          messages: [{ role: "system", content: "only system" }],
        }),
      ),
    ).toThrow(/at least/);
  });
});

describe("assessTrainSafety", () => {
  it("passes a clean verified example", () => {
    const result = assessTrainSafety(baseExample(), {
      criticalFields: ["cartonSize", "productName"],
      goldNonBlankFields: ["cartonSize", "productName"],
    });
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("rejects markdown fences and blank-poison", () => {
    const fenced = assessTrainSafety(
      baseExample({
        messages: [
          { role: "system", content: "Extract." },
          { role: "user", content: "chunk" },
          {
            role: "assistant",
            content: "```json\n{\"cartonSize\":12}\n```",
          },
        ],
      }),
    );
    expect(fenced.ok).toBe(false);
    expect(fenced.reasons.some((r) => /markdown/.test(r))).toBe(true);

    const poison = assessTrainSafety(
      baseExample({
        messages: [
          { role: "system", content: "Extract." },
          { role: "user", content: "chunk" },
          {
            role: "assistant",
            content: JSON.stringify({ productName: "Cheese", cartonSize: null }),
          },
        ],
      }),
      {
        criticalFields: ["cartonSize"],
        goldNonBlankFields: ["cartonSize"],
      },
    );
    expect(poison.ok).toBe(false);
    expect(poison.suggestedPartition).toBe("quarantine");
    expect(poison.reasons.some((r) => /blank-poison/.test(r))).toBe(true);
  });

  it("flags holdout near-dup and brand leak options", () => {
    const result = assessTrainSafety(baseExample(), {
      nearDuplicateOfHoldout: true,
      brandInOtherPartition: true,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
  });
});

describe("assertBrandPartitionIntegrity", () => {
  it("allows same brand only within one live partition", () => {
    const a = toManifestEntry(baseExample({ id: "1", partition: "train" }));
    const b = toManifestEntry(
      baseExample({ id: "2", partition: "train", contentSha256: "b".repeat(64) }),
    );
    expect(() => assertBrandPartitionIntegrity([a, b])).not.toThrow();

    const leaked = toManifestEntry(
      baseExample({ id: "3", partition: "holdout", contentSha256: "c".repeat(64) }),
    );
    expect(() => assertBrandPartitionIntegrity([a, leaked])).toThrow(
      /brand partition leak/,
    );
  });
});
