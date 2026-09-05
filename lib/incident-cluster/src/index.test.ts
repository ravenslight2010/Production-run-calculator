import { describe, it, expect } from "vitest";
import {
  buildFallbackClusters,
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

describe("severityRank", () => {
  it("orders high > medium > low", () => {
    expect(severityRank("high")).toBeGreaterThan(severityRank("medium"));
    expect(severityRank("medium")).toBeGreaterThan(severityRank("low"));
  });
});
