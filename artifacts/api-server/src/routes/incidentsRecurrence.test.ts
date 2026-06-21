import { describe, it, expect } from "vitest";
import type { FacilityKnowledge } from "@workspace/ai-memory";
import type { IncidentContext } from "../lib/incidents";
import {
  incidentSignature,
  jaccard,
  analyzeIncidentHistory,
  parseSeenCount,
  parseLastWorkaround,
  buildIncidentMemoryFact,
  INCIDENT_MEMORY_DOMAIN,
  SIMILARITY_THRESHOLD,
  MAX_SIMILAR_INCIDENTS,
  type IncidentSignatureInput,
} from "./incidentsAi";

function sigInput(overrides: Partial<IncidentSignatureInput> = {}): IncidentSignatureInput {
  return {
    screen: "run",
    appPlatform: "web",
    context: {},
    ...overrides,
  };
}

// Build a facility-memory pool entry. By default it lands in the incidents
// domain so analyzeIncidentHistory considers it.
function memory(key: string, fact: string, domain = INCIDENT_MEMORY_DOMAIN): FacilityKnowledge {
  return { domain, key, fact };
}

describe("incidentSignature", () => {
  it("is platform|screen|tokens, fully lower-cased", () => {
    const sig = incidentSignature(
      sigInput({
        screen: "Run",
        appPlatform: "Web",
        context: { description: "Save Button Broken" },
      }),
    );
    expect(sig).toBe("web|run|broken-button-save");
  });

  it("drops stopwords and tokens shorter than 3 chars", () => {
    // "the", "does", "when" are stopwords; "to", "is" are < 3 chars.
    const sig = incidentSignature(
      sigInput({ context: { description: "the save does nothing when I tap is to" } }),
    );
    const tokens = sig.split("|")[2].split("-");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("does");
    expect(tokens).not.toContain("when");
    expect(tokens).not.toContain("to");
    expect(tokens).not.toContain("is");
    expect(tokens).toEqual(["nothing", "save", "tap"]);
  });

  it("dedupes and sorts tokens so word order does not matter", () => {
    const a = incidentSignature(sigInput({ context: { description: "save button save button" } }));
    const b = incidentSignature(sigInput({ context: { description: "button save" } }));
    expect(a).toBe(b);
    expect(a).toBe("web|run|button-save");
  });

  it("caps the signature at 8 significant tokens", () => {
    const sig = incidentSignature(
      sigInput({
        context: {
          description: "alpha bravo charlie delta echo foxtrot golf hotel india juliet",
        },
      }),
    );
    const tokens = sig.split("|")[2].split("-");
    expect(tokens).toHaveLength(8);
    // Sorted alphabetically, so the first 8 are taken.
    expect(tokens).toEqual([
      "alpha",
      "bravo",
      "charlie",
      "delta",
      "echo",
      "foxtrot",
      "golf",
      "hotel",
    ]);
  });

  it("keys on the error message for a crash, otherwise the description", () => {
    const crash = incidentSignature(
      sigInput({ context: { errorMessage: "cannot read undefined", description: "ignored words" } }),
    );
    expect(crash).toBe("web|run|cannot-read-undefined");

    const report = incidentSignature(sigInput({ context: { description: "the report words" } }));
    expect(report).toBe("web|run|report-words");
  });
});

describe("jaccard", () => {
  it("is 0 for two empty sets", () => {
    expect(jaccard([], [])).toBe(0);
  });

  it("is 1 for identical sets", () => {
    expect(jaccard(["a", "b"], ["b", "a"])).toBe(1);
  });

  it("is 0 for fully disjoint sets", () => {
    expect(jaccard(["a", "b"], ["c", "d"])).toBe(0);
  });

  it("scores just above the similarity threshold (2/5 = 0.4)", () => {
    const score = jaccard(["alpha", "bravo", "charlie"], ["alpha", "bravo", "delta", "echo"]);
    expect(score).toBeCloseTo(0.4, 5);
    expect(score).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
  });

  it("scores just below the similarity threshold (1/3 ≈ 0.333)", () => {
    const score = jaccard(["alpha", "bravo"], ["alpha", "charlie"]);
    expect(score).toBeCloseTo(1 / 3, 5);
    expect(score).toBeLessThan(SIMILARITY_THRESHOLD);
  });
});

describe("analyzeIncidentHistory — threshold filtering", () => {
  it("includes a match scoring at/above the threshold", () => {
    // new tokens: [alpha, bravo, charlie]; seeded: [alpha, bravo, delta, echo] → 0.4
    const knowledge = [memory("web|run|alpha-bravo-delta-echo", "Seen 1x. helped: retry")];
    const result = analyzeIncidentHistory(
      knowledge,
      sigInput({ context: { description: "alpha bravo charlie" } }),
    );
    expect(result.similar).toHaveLength(1);
    expect(result.similar[0].score).toBeCloseTo(0.4, 5);
    expect(result.similar[0].exact).toBe(false);
  });

  it("excludes a match scoring below the threshold", () => {
    // new tokens: [alpha, bravo]; seeded: [alpha, charlie] → 0.333 < 0.34
    const knowledge = [memory("web|run|alpha-charlie", "Seen 1x. helped: retry")];
    const result = analyzeIncidentHistory(
      knowledge,
      sigInput({ context: { description: "alpha bravo" } }),
    );
    expect(result.similar).toHaveLength(0);
    expect(result.recurrence).toBeNull();
  });

  it("ignores knowledge outside the incidents domain", () => {
    const knowledge = [
      memory("web|run|alpha-bravo-delta-echo", "Seen 1x. helped: retry", "downtime"),
    ];
    const result = analyzeIncidentHistory(
      knowledge,
      sigInput({ context: { description: "alpha bravo charlie" } }),
    );
    expect(result.similar).toHaveLength(0);
  });
});

describe("analyzeIncidentHistory — MAX_SIMILAR_INCIDENTS capping", () => {
  it("returns at most MAX_SIMILAR_INCIDENTS, ranked by score descending", () => {
    // new tokens: [alpha, bravo, charlie, delta]. jaccard = inter / union.
    const newDesc = "alpha bravo charlie delta";
    const knowledge = [
      // shares 3, +1 extra → 3/5 = 0.6
      memory("web|run|alpha-bravo-charlie-echo", "Seen 1x. m1"),
      // shares all 4, +1 extra → 4/5 = 0.8 (highest)
      memory("web|run|alpha-bravo-charlie-delta-echo", "Seen 1x. m2"),
      // shares 3, +1 extra → 3/5 = 0.6
      memory("web|run|alpha-bravo-charlie-foxtrot", "Seen 1x. m3"),
      // shares 3, +1 extra → 3/5 = 0.6
      memory("web|run|alpha-bravo-charlie-golf", "Seen 1x. m4"),
      // shares 3, +1 extra → 3/5 = 0.6
      memory("web|run|alpha-bravo-charlie-hotel", "Seen 1x. m5"),
    ];
    const result = analyzeIncidentHistory(
      knowledge,
      sigInput({ context: { description: newDesc } }),
    );
    // Five entries clear the threshold but only MAX_SIMILAR_INCIDENTS are kept.
    expect(result.similar).toHaveLength(MAX_SIMILAR_INCIDENTS);
    // Highest score first (0.8), the rest 0.6; confirm descending order.
    expect(result.similar[0].score).toBeCloseTo(0.8, 5);
    expect(result.similar[1].score).toBeCloseTo(0.6, 5);
    for (let i = 1; i < result.similar.length; i += 1) {
      expect(result.similar[i - 1].score).toBeGreaterThanOrEqual(result.similar[i].score);
    }
  });
});

describe("analyzeIncidentHistory — exact vs similar recurrence count", () => {
  it("uses the stored exact-key occurrence count when the signature matches exactly", () => {
    const input = sigInput({ context: { description: "save button broken" } });
    const signature = incidentSignature(input);
    const knowledge = [
      memory(signature, "Seen 4x on \"run\" (web). Problem: x. What helped last time: refresh"),
    ];
    const result = analyzeIncidentHistory(knowledge, input);
    expect(result.signature).toBe(signature);
    expect(result.priorExactCount).toBe(4);
    expect(result.recurrence).not.toBeNull();
    expect(result.recurrence?.count).toBe(4);
    expect(result.recurrence?.lastWorkaround).toBe("refresh");
    expect(result.similar[0].exact).toBe(true);
    expect(result.similar[0].score).toBe(1);
  });

  it("falls back to the similar-match count when there is no exact hit", () => {
    // Two distinct similar (non-exact) entries, no exact-key match.
    const knowledge = [
      memory("web|run|alpha-bravo-delta-echo", "Seen 9x. What helped last time: retry once"),
      memory("web|run|alpha-bravo-charlie-foxtrot", "Seen 2x. What helped last time: refresh"),
    ];
    const result = analyzeIncidentHistory(
      knowledge,
      sigInput({ context: { description: "alpha bravo charlie" } }),
    );
    expect(result.priorExactCount).toBe(0);
    expect(result.similar.length).toBe(2);
    // No exact hit → count is the number of similar matches, NOT a stored "Seen Nx".
    expect(result.recurrence?.count).toBe(2);
    // lastWorkaround comes from the highest-scoring similar entry.
    expect(result.recurrence?.lastWorkaround).toBeTypeOf("string");
  });

  it("returns a null recurrence when nothing matches", () => {
    const knowledge = [memory("web|run|totally-unrelated-words-here", "Seen 5x. helped: nope")];
    const result = analyzeIncidentHistory(
      knowledge,
      sigInput({ context: { description: "alpha bravo charlie" } }),
    );
    expect(result.similar).toHaveLength(0);
    expect(result.recurrence).toBeNull();
    expect(result.priorExactCount).toBe(0);
  });

  it("never reports a recurrence count below 1 when a match exists", () => {
    // Exact match whose stored fact has no parseable "Seen Nx" → priorExactCount 0,
    // but an exact match still exists, so count is clamped to >= 1.
    const input = sigInput({ context: { description: "save button broken" } });
    const signature = incidentSignature(input);
    const knowledge = [memory(signature, "What helped last time: refresh")];
    const result = analyzeIncidentHistory(knowledge, input);
    expect(result.priorExactCount).toBe(0);
    expect(result.recurrence?.count).toBe(1);
  });
});

describe("parseSeenCount / parseLastWorkaround / buildIncidentMemoryFact round-trip", () => {
  const ctx: IncidentContext = { errorMessage: "Cannot read property foo of undefined" };
  const input = sigInput({ screen: "Run", appPlatform: "web", context: ctx });

  it("round-trips the count and workaround through a built fact", () => {
    const fact = buildIncidentMemoryFact(input, 3, "Refresh the app and retry");
    expect(parseSeenCount(fact)).toBe(3);
    expect(parseLastWorkaround(fact)).toBe("Refresh the app and retry");
  });

  it("includes the screen, platform, and problem signal in the fact", () => {
    const fact = buildIncidentMemoryFact(input, 1, "retry");
    expect(fact).toContain('"Run"');
    expect(fact).toContain("(web)");
    expect(fact).toContain("Cannot read property foo of undefined");
  });

  it("uses placeholders when details/workaround are empty", () => {
    const fact = buildIncidentMemoryFact(sigInput({ context: {} }), 2, "");
    expect(fact).toContain("(no details captured)");
    expect(fact).toContain("(no workaround captured)");
    // Placeholder workaround is still parsed back verbatim.
    expect(parseLastWorkaround(fact)).toBe("(no workaround captured)");
    expect(parseSeenCount(fact)).toBe(2);
  });

  describe("parseSeenCount edge cases", () => {
    it("returns 0 when no count is present", () => {
      expect(parseSeenCount("no number here")).toBe(0);
    });

    it("is case-insensitive on the 'Seen Nx' marker", () => {
      expect(parseSeenCount("seen 7X on something")).toBe(7);
    });
  });

  describe("parseLastWorkaround edge cases", () => {
    it("returns null when the marker is absent", () => {
      expect(parseLastWorkaround("Seen 1x. Problem: stuff.")).toBeNull();
    });

    it("is case-insensitive and trims the captured text", () => {
      expect(parseLastWorkaround("What Helped Last Time:   restart the app  ")).toBe(
        "restart the app",
      );
    });
  });
});
