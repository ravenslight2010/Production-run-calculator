// Pure, deterministic helpers for grouping reported incidents / crashes into
// root-cause clusters. The AI narration is advisory only: the server asks a
// model to propose themes, but everything here is fail-safe and testable.
//
//   - `buildFallbackClusters` groups incidents deterministically (by platform +
//     screen) so managers ALWAYS get a useful grouping even when the AI is
//     unavailable or returns nothing usable.
// This lib is server-side only (incidents live in the DB, not in client sync),
// but the pure logic lives here so it can be unit-tested in isolation.

export type ClusterSeverity = "low" | "medium" | "high";

// Minimal shape of an incident needed for clustering. Decoupled from the DB row
// type so the lib has no dependency on @workspace/db.
export interface IncidentForCluster {
  id: string;
  appPlatform: string;
  screen: string;
  source: string;
  // Short human-readable error/description text used for the prompt + theme.
  message: string;
  // Recurrence count (>= 1). Incidents seen many times weigh heavier.
  count: number;
}

export interface IncidentCluster {
  theme: string;
  rootCauseHypothesis: string;
  recommendedAction: string;
  severity: ClusterSeverity;
  incidentIds: string[];
  incidentCount: number;
}

const MAX_CLUSTERS = 8;
function normSeverity(v: unknown, totalCount: number): ClusterSeverity {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "high" || s === "medium" || s === "low") return s;
  // Deterministic default from volume when the AI omits/garbles severity.
  if (totalCount >= 5) return "high";
  if (totalCount >= 2) return "medium";
  return "low";
}

// Collapse runs of whitespace and lowercase for grouping keys.
function normKey(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}

// Total occurrences across a set of incidents (recurrence-weighted).
export function totalOccurrences(incidents: IncidentForCluster[]): number {
  return incidents.reduce((sum, i) => sum + Math.max(1, Math.round(i.count || 1)), 0);
}

// Deterministic grouping by platform + screen. This is the fail-safe result the
// manager sees. Groups are ordered by total
// occurrences (busiest first), then alphabetically for stability.
export function buildFallbackClusters(incidents: IncidentForCluster[]): IncidentCluster[] {
  const groups = new Map<string, IncidentForCluster[]>();
  for (const inc of incidents) {
    const key = `${normKey(inc.appPlatform || "unknown")}::${normKey(inc.screen || "unknown")}`;
    const arr = groups.get(key);
    if (arr) arr.push(inc);
    else groups.set(key, [inc]);
  }

  const clusters: IncidentCluster[] = [];
  for (const arr of groups.values()) {
    const first = arr[0]!;
    const platform = first.appPlatform || "unknown";
    const screen = first.screen || "unknown";
    const total = totalOccurrences(arr);
    clusters.push({
      theme: `${screen} (${platform})`,
      rootCauseHypothesis:
        arr.length === 1
          ? "A single report on this screen. Not yet a confirmed pattern."
          : `${arr.length} separate reports on the ${screen} screen suggest a recurring issue here.`,
      recommendedAction: `Review the reports for ${screen} on ${platform} together and check whether they share a trigger.`,
      severity: normSeverity(undefined, total),
      incidentIds: arr.map((i) => i.id),
      incidentCount: total,
    });
  }

  clusters.sort(
    (a, b) => b.incidentCount - a.incidentCount || a.theme.localeCompare(b.theme),
  );
  return clusters.slice(0, MAX_CLUSTERS);
}

const SEVERITY_RANK: Record<ClusterSeverity, number> = { high: 3, medium: 2, low: 1 };

export function severityRank(s: ClusterSeverity): number {
  return SEVERITY_RANK[s] ?? 0;
}
