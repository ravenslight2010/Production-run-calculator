import { describe, expect, it } from "vitest";
import {
  findNearDuplicates,
  jaccard,
  jaccardTexts,
  normalizeForNearDup,
  shingleSet,
  trainNearDupFlags,
} from "./nearDup.js";

describe("normalizeForNearDup", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeForNearDup("  Hello   WORLD\n\tFoo  ")).toBe(
      "hello world foo",
    );
  });
});

describe("shingleSet + jaccard", () => {
  it("scores identical text as 1", () => {
    const t = "brand a cheese pizza 12 per carton line speed 45";
    expect(jaccardTexts(t, t)).toBe(1);
  });

  it("scores unrelated text low", () => {
    const a = "brand a cheese pizza carton size twelve";
    const b = "completely different warehouse logistics memo";
    expect(jaccardTexts(a, b)).toBeLessThan(0.2);
  });

  it("scores near-edits high with word shingles", () => {
    const a =
      "product cheese pizza carton size 12 cases per hour 400 line north";
    const b =
      "product cheese pizza carton size 12 cases per hour 410 line north";
    // 12 words, 3-word shingles -> 10 shingles per side. Changing 1 word
    // touches 3 consecutive shingles, so intersection = 10-3=7,
    // union = 10+3=13 (the 3 changed shingles differ on each side) ->
    // 7/13 ~= 0.538. The original 0.7 threshold was never reachable for a
    // single-word edit at this shingle size; 0.5 still clearly separates
    // this from the "unrelated text" case below (<0.2).
    const score = jaccardTexts(a, b, { shingleSize: 3, shingleMode: "word" });
    expect(score).toBeGreaterThan(0.5);
  });

  it("handles short texts without throwing", () => {
    expect(shingleSet("ab", { shingleMode: "word", shingleSize: 3 }).size).toBe(
      1,
    );
    expect(jaccard(new Set(), new Set())).toBe(1);
    expect(jaccard(new Set(["x"]), new Set())).toBe(0);
  });
});

describe("findNearDuplicates", () => {
  it("finds pairs above threshold", () => {
    const items = [
      { id: "1", text: "alpha beta gamma delta epsilon zeta" },
      { id: "2", text: "alpha beta gamma delta epsilon eta" },
      { id: "3", text: "completely different words here now" },
    ];
    const hits = findNearDuplicates(items, {
      shingleSize: 2,
      shingleMode: "word",
      threshold: 0.5,
    });
    const pair12 = hits.find(
      (h) =>
        (h.leftId === "1" && h.rightId === "2") ||
        (h.leftId === "2" && h.rightId === "1"),
    );
    expect(pair12).toBeDefined();
    expect(hits.some((h) => h.leftId === "3" || h.rightId === "3")).toBe(
      false,
    );
  });
});

describe("trainNearDupFlags", () => {
  it("flags train items near eval set", () => {
    const train = [
      {
        id: "t1",
        text: "spec sheet brand x flavor mushroom carton 10 cases 200",
      },
      {
        id: "t2",
        text: "unrelated maintenance checklist valve inspection torque",
      },
    ];
    const evalSet = [
      {
        id: "h1",
        text: "spec sheet brand x flavor mushroom carton 10 cases 210",
      },
    ];
    const flags = trainNearDupFlags(train, evalSet, {
      shingleSize: 3,
      shingleMode: "word",
      threshold: 0.6,
    });
    expect(flags.get("t1")?.flag).toBe(true);
    expect(flags.get("t1")?.matchedId).toBe("h1");
    expect(flags.get("t2")?.flag).toBe(false);
  });
});
