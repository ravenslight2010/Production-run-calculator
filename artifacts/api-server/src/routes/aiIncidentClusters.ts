import { AiIncidentClustersBody } from "@workspace/api-zod";
import * as z from "zod";
import {
  buildFallbackClusters,
  type IncidentForCluster,
} from "@workspace/incident-cluster";
import type { IncidentDTO } from "../lib/incidents";

// Deterministic incident grouping across the incident log. Reads the recorded
// incidents (manager-only) and groups recurring reports/crashes by screen and
// platform. Read-only and advisory; never edits anything.

export type IncidentClustersBody = z.infer<typeof AiIncidentClustersBody>;

// Don't feed an unbounded log into one prompt. Newest-first, capped.
export const CLUSTER_MAX_INCIDENTS = 120;
// Below this there's no meaningful pattern to surface.
export const CLUSTER_MIN_INCIDENTS = 2;
export const DEFAULT_LOOKBACK_DAYS = 30;

export type ClusterValidationResult =
  | { ok: true; data: IncidentClustersBody }
  | { ok: false; status: number; error: string };

export function validateClustersBody(body: unknown): ClusterValidationResult {
  // Body is optional; treat missing/empty as {}.
  const parsed = AiIncidentClustersBody.safeParse(body ?? {});
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Invalid incident-clusters input" };
  }
  return { ok: true, data: parsed.data };
}

// Pull a short message out of an incident's context for the prompt + theme.
function incidentMessage(incident: IncidentDTO): string {
  const ctx = (incident.context ?? {}) as Record<string, unknown>;
  const desc = typeof ctx.description === "string" ? ctx.description.trim() : "";
  const errMsg = typeof ctx.errorMessage === "string" ? ctx.errorMessage.trim() : "";
  return desc || errMsg || incident.diagnosis?.trim() || "";
}

// Shape DB incidents into the pure lib's input, filtered to the lookback window
// and capped (newest-first).
export function shapeIncidents(
  incidents: IncidentDTO[],
  lookbackDays: number,
  nowMs: number,
): { shaped: IncidentForCluster[] } {
  const cutoff = nowMs - lookbackDays * 24 * 60 * 60 * 1000;
  const sorted = [...incidents].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const shaped: IncidentForCluster[] = [];
  for (const inc of sorted) {
    const created = new Date(inc.createdAt).getTime();
    if (Number.isFinite(created) && created < cutoff) continue;
    const recurrence = (inc.recurrence ?? null) as { count?: number } | null;
    shaped.push({
      id: inc.id,
      appPlatform: inc.appPlatform,
      screen: inc.screen,
      source: inc.source,
      message: incidentMessage(inc),
      count: Math.max(1, Math.round(recurrence?.count ?? 1)),
    });
    if (shaped.length >= CLUSTER_MAX_INCIDENTS) break;
  }
  return { shaped };
}

export { buildFallbackClusters };
