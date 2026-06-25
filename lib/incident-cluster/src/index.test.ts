import { describe, it, expect } from "vitest";
import {
  buildFallbackClusters,
  sanitizeClusters,
  summarizeIncidentForPrompt,
  totalOccurrences,
  severityRank,
  type IncidentForCluster,
} from "./index";

function inc(partial: Partial<IncidentForCluster> & { id: string }): IncidentForCluster {
  return {
    appPlatform: "web",
    screen: "Run",
    source: "user_report",
    message: "something went wrong",
    count: 1,
    ...partial,
  };
}

function byId(incidents: IncidentForCluster[]): Map<string, IncidentForCluster> {
  return new Map(incidents.map((i) => [i.id, i]));
}

describe("totalOccurrences", () => {
  it("sums recurrence counts, treating missing/zero as 1", () => {
    expect(
      totalOccurrences([
        inc({ id: "a", count: 3 }),
        inc({ id: "b", count: 0 }),
        inc({ id: "c", count: 2 }),
      ]),
    ).toBe(6);
  });
});

describe("summarizeIncidentForPrompt", () => {
  it("renders a compact line and flags recurrence", () => {
    const line = summarizeIncidentForPrompt(
      inc({ id: "x1", appPlatform: "mobile", screen: "Inventory", count: 4, source: "auto_crash" }),
    );
    expect(line).toContain("[x1]");
    expect(line).toContain("crash");
    expect(line).toContain("mobile/Inventory");
    expect(line).toContain("seen 4x");
  });

  it("handles empty message", () => {
    const line = summarizeIncidentForPrompt(inc({ id: "x2", message: "" }));
    expect(line).toContain("(no message)");
  });
});

describe("buildFallbackClusters", () => {
  it("groups by platform + screen and orders by occurrences", () => {
    const incidents = [
      inc({ id: "1", screen: "Run", appPlatform: "web" }),
      inc({ id: "2", screen: "Run", appPlatform: "web", count: 3 }),
      inc({ id: "3", screen: "Inventory", appPlatform: "web" }),
    ];
    const clusters = buildFallbackClusters(incidents);
    expect(clusters).toHaveLength(2);
    // Run/web has 1+3 = 4 occurrences, Inventory 1 → Run first.
    expect(clusters[0]!.incidentIds.sort()).toEqual(["1", "2"]);
    expect(clusters[0]!.incidentCount).toBe(4);
    expect(clusters[1]!.incidentIds).toEqual(["3"]);
  });

  it("treats same screen on different platforms as distinct clusters", () => {
    const clusters = buildFallbackClusters([
      inc({ id: "1", screen: "Run", appPlatform: "web" }),
      inc({ id: "2", screen: "Run", appPlatform: "mobile" }),
    ]);
    expect(clusters).toHaveLength(2);
  });

  it("returns empty for no incidents", () => {
    expect(buildFallbackClusters([])).toEqual([]);
  });

  it("escalates severity by volume", () => {
    const many = Array.from({ length: 5 }, (_, i) => inc({ id: `m${i}` }));
    const clusters = buildFallbackClusters(many);
    expect(clusters[0]!.severity).toBe("high");
  });
});

describe("sanitizeClusters", () => {
  const incidents = [inc({ id: "a", count: 2 }), inc({ id: "b" }), inc({ id: "c" })];
  const map = byId(incidents);

  it("drops hallucinated ids and recomputes counts from survivors", () => {
    const raw = {
      clusters: [
        {
          theme: "Run crashes",
          rootCauseHypothesis: "stale state",
          recommendedAction: "refresh",
          severity: "high",
          incidentIds: ["a", "ZZZ", "b"],
        },
      ],
    };
    const out = sanitizeClusters(raw, map);
    expect(out).toHaveLength(1);
    expect(out[0]!.incidentIds).toEqual(["a", "b"]);
    // a.count=2 + b.count=1 → 3 (NOT trusted from AI)
    expect(out[0]!.incidentCount).toBe(3);
    expect(out[0]!.severity).toBe("high");
  });

  it("rejects clusters that are empty after filtering", () => {
    const out = sanitizeClusters({ clusters: [{ theme: "ghost", incidentIds: ["ZZZ"] }] }, map);
    expect(out).toEqual([]);
  });

  it("does not put the same id in two clusters", () => {
    const raw = {
      clusters: [
        { theme: "one", incidentIds: ["a", "b"] },
        { theme: "two", incidentIds: ["b", "c"] },
      ],
    };
    const out = sanitizeClusters(raw, map);
    const allIds = out.flatMap((c) => c.incidentIds);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("normalizes bad severity from volume and clamps strings", () => {
    const raw = {
      clusters: [
        {
          theme: "x".repeat(500),
          rootCauseHypothesis: "y".repeat(5000),
          severity: "catastrophic",
          incidentIds: ["a"],
        },
      ],
    };
    const out = sanitizeClusters(raw, map);
    expect(out[0]!.theme.length).toBeLessThanOrEqual(120);
    expect(out[0]!.rootCauseHypothesis.length).toBeLessThanOrEqual(600);
    // a.count=2 → medium
    expect(out[0]!.severity).toBe("medium");
  });

  it("falls back gracefully on garbage input", () => {
    expect(sanitizeClusters(null, map)).toEqual([]);
    expect(sanitizeClusters({}, map)).toEqual([]);
    expect(sanitizeClusters({ clusters: "nope" }, map)).toEqual([]);
  });
});

describe("severityRank", () => {
  it("orders high > medium > low", () => {
    expect(severityRank("high")).toBeGreaterThan(severityRank("medium"));
    expect(severityRank("medium")).toBeGreaterThan(severityRank("low"));
  });
});
