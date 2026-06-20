// Tests for the reviewer-AI pure logic in @workspace/ai-review.
// Web and mobile both consume this lib, so testing it once here covers both.
import { describe, it, expect } from "vitest";
import {
  normalizeReviewStatus,
  normalizeReviewItems,
  buildReviewPrompt,
  sanitizeReviewVerdicts,
  verdictsById,
  MAX_REVIEW_REASON_LEN,
  MAX_REVIEW_ITEMS,
  MAX_REVIEW_ITEM_TEXT_LEN,
  type ReviewItem,
} from "@workspace/ai-review";

describe("normalizeReviewStatus", () => {
  it("maps reject-like words", () => {
    for (const s of ["reject", "WRONG", "incorrect", "bad", "error", "drop", "no"]) {
      expect(normalizeReviewStatus(s)).toBe("reject");
    }
  });

  it("maps warn-like words", () => {
    for (const s of ["warn", "caution", "Risky", "verify", "unsure", "maybe"]) {
      expect(normalizeReviewStatus(s)).toBe("warn");
    }
  });

  it("fails open to ok for unknown/garbage/non-strings", () => {
    for (const s of ["ok", "looks great", "", "42", null, undefined, {}]) {
      expect(normalizeReviewStatus(s as unknown)).toBe("ok");
    }
  });
});

describe("normalizeReviewItems", () => {
  it("drops blank id/text, dedupes by id, caps text length", () => {
    const long = "x".repeat(MAX_REVIEW_ITEM_TEXT_LEN + 50);
    const out = normalizeReviewItems([
      { id: " a ", text: "  first  " },
      { id: "a", text: "dupe id" },
      { id: "", text: "no id" },
      { id: "b", text: "" },
      { id: "c", text: long },
    ]);
    expect(out).toEqual([
      { id: "a", text: "first" },
      { id: "c", text: "x".repeat(MAX_REVIEW_ITEM_TEXT_LEN) },
    ]);
  });

  it("caps the number of items", () => {
    const items = Array.from({ length: MAX_REVIEW_ITEMS + 10 }, (_, i) => ({
      id: `id-${i}`,
      text: `t-${i}`,
    }));
    expect(normalizeReviewItems(items)).toHaveLength(MAX_REVIEW_ITEMS);
  });
});

describe("buildReviewPrompt", () => {
  const items: ReviewItem[] = [
    { id: "s1", text: "Merge Mozz into Mozzarella" },
    { id: "s2", text: "Set finish time to 28:00" },
  ];

  it("includes a system prompt, the feature label, and every item id", () => {
    const { system, user } = buildReviewPrompt(
      "merge suggestions",
      "watch impossible times",
      items,
    );
    expect(system).toContain("merge suggestions");
    expect(system).toContain("watch impossible times");
    expect(user).toContain("id=s1");
    expect(user).toContain("id=s2");
    expect(user).toContain("verdicts");
  });

  it("works with no extra instructions", () => {
    const { system } = buildReviewPrompt("optimize", "", items);
    expect(system.length).toBeGreaterThan(0);
  });
});

describe("sanitizeReviewVerdicts", () => {
  const known = ["s1", "s2", "s3"];

  it("keeps only verdicts whose id is a known item", () => {
    const out = sanitizeReviewVerdicts(
      {
        verdicts: [
          { id: "s1", status: "ok" },
          { id: "ghost", status: "reject", reason: "nope" },
          { id: "s2", status: "warn", reason: "  double-check  " },
        ],
      },
      known,
    );
    expect(out).toEqual([
      { id: "s1", status: "ok" },
      { id: "s2", status: "warn", reason: "double-check" },
    ]);
  });

  it("normalizes status and drops empty reasons", () => {
    const out = sanitizeReviewVerdicts(
      { verdicts: [{ id: "s1", status: "WRONG", reason: "   " }] },
      known,
    );
    expect(out).toEqual([{ id: "s1", status: "reject" }]);
  });

  it("dedupes by id (first wins)", () => {
    const out = sanitizeReviewVerdicts(
      {
        verdicts: [
          { id: "s1", status: "warn", reason: "first" },
          { id: "s1", status: "reject", reason: "second" },
        ],
      },
      known,
    );
    expect(out).toEqual([{ id: "s1", status: "warn", reason: "first" }]);
  });

  it("caps the reason length", () => {
    const out = sanitizeReviewVerdicts(
      {
        verdicts: [{ id: "s1", status: "warn", reason: "r".repeat(MAX_REVIEW_REASON_LEN + 50) }],
      },
      known,
    );
    expect(out[0]?.reason?.length).toBe(MAX_REVIEW_REASON_LEN);
  });

  it("accepts a bare array as well as a {verdicts} wrapper", () => {
    const out = sanitizeReviewVerdicts([{ id: "s3", status: "ok" }], known);
    expect(out).toEqual([{ id: "s3", status: "ok" }]);
  });

  it("returns [] for malformed top-level shapes", () => {
    for (const bad of [null, 42, "nope", {}, { verdicts: "x" }]) {
      expect(sanitizeReviewVerdicts(bad, known)).toEqual([]);
    }
  });
});

describe("verdictsById", () => {
  it("indexes verdicts by id", () => {
    const m = verdictsById([
      { id: "s1", status: "ok" },
      { id: "s2", status: "warn", reason: "hmm" },
    ]);
    expect(m.get("s2")?.reason).toBe("hmm");
    expect(m.has("s1")).toBe(true);
  });
});
