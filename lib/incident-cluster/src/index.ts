// Pure, deterministic helpers for grouping reported incidents / crashes into
// root-cause clusters. The AI narration is advisory only: the server asks a
// model to propose themes, but everything here is fail-safe and testable.
//
//   - `buildFallbackClusters` groups incidents deterministically (by platform +
//     screen) so managers ALWAYS get a useful grouping even when the AI is
//     unavailable or returns nothing usable.
//   - `summarizeIncidentForPrompt` shapes one incident into a compact line for
//     the prompt (no PII beyond what's already in the incident log).
//   - `sanitizeClusters` canonicalizes raw AI JSON: drops unknown incident ids,
//     clamps strings, normalizes severity, recomputes counts, and rejects empty
//     clusters. The server never trusts AI ids/counts directly.
//
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
const MAX_STR = 600;
const MAX_THEME = 120;

function clampStr(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

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

// One compact prompt line per incident. Kept terse so many incidents fit in the
// prompt budget. Counts > 1 are flagged so the model weighs recurring issues.
export function summarizeIncidentForPrompt(incident: IncidentForCluster): string {
  const platform = incident.appPlatform || "unknown";
  const screen = incident.screen || "unknown";
  const src = incident.source === "auto_crash" ? "crash" : "report";
  const seen = incident.count > 1 ? ` (seen ${incident.count}x)` : "";
  const msg = clampStr(incident.message, 200) || "(no message)";
  return `- [${incident.id}] ${src} on ${platform}/${screen}${seen}: ${msg}`;
}

// Deterministic grouping by platform + screen. This is the fail-safe result the
// manager sees whenever the AI can't be used. Groups are ordered by total
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

// Canonicalize raw AI JSON ({ clusters: [...] }) into trusted clusters. Unknown
// incident ids are dropped, counts are recomputed from the surviving ids (never
// trusted from the model), empty clusters are rejected, and we cap the count.
// `validIds` is the set of ids the server actually has; `byId` maps id ->
// incident so counts stay recurrence-weighted.
export function sanitizeClusters(
  raw: unknown,
  byId: Map<string, IncidentForCluster>,
): IncidentCluster[] {
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(root.clusters) ? root.clusters : [];
  const out: IncidentCluster[] = [];
  const seenIds = new Set<string>();

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const rawIds = Array.isArray(obj.incidentIds) ? obj.incidentIds : [];
    const ids: string[] = [];
    const members: IncidentForCluster[] = [];
    for (const rid of rawIds) {
      const id = typeof rid === "string" ? rid : "";
      if (!id || seenIds.has(id)) continue;
      const inc = byId.get(id);
      if (!inc) continue; // hallucinated id — drop it
      ids.push(id);
      members.push(inc);
      seenIds.add(id);
    }
    if (ids.length === 0) continue; // empty after filtering — reject

    const total = totalOccurrences(members);
    const theme = clampStr(obj.theme, MAX_THEME) || members[0]!.screen || "Issue";
    out.push({
      theme,
      rootCauseHypothesis: clampStr(obj.rootCauseHypothesis, MAX_STR),
      recommendedAction: clampStr(obj.recommendedAction, MAX_STR),
      severity: normSeverity(obj.severity, total),
      incidentIds: ids,
      incidentCount: total,
    });
    if (out.length >= MAX_CLUSTERS) break;
  }

  out.sort((a, b) => b.incidentCount - a.incidentCount || a.theme.localeCompare(b.theme));
  return out;
}

const SEVERITY_RANK: Record<ClusterSeverity, number> = { high: 3, medium: 2, low: 1 };

export function severityRank(s: ClusterSeverity): number {
  return SEVERITY_RANK[s] ?? 0;
}
