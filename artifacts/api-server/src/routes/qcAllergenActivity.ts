export type ActivityRunSource = "completed-snapshot" | "active-day-state" | "unavailable";

export type ActivityManualAllergen = {
  status: "recorded" | "unavailable";
  value: string | null;
};

export type ActivitySnapshotRun = {
  runId: string;
  label: string;
  source: ActivityRunSource;
  manualAllergen: ActivityManualAllergen;
  ended: boolean;
};

export type ActivitySnapshotResult =
  | { status: "available"; runs: ActivitySnapshotRun[] }
  | {
    status: "unavailable";
    reason: "invalid-snapshot" | "date-mismatch" | "invalid-run" | "duplicate-run" | "too-many-runs";
  };

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function runLabel(run: Record<string, unknown>): string {
  const brand = typeof run.brand === "string" ? run.brand.trim() : "";
  const flavor = typeof run.flavor === "string" ? run.flavor.trim() : "";
  return [brand, flavor].filter(Boolean).join(" ") || "Production run";
}

function manualValue(runValues: Record<string, unknown> | null, runId: string): ActivityManualAllergen {
  const values = objectRecord(runValues?.[runId]);
  const allergen = values?.allergen;
  return typeof allergen === "string"
    ? { status: "recorded", value: allergen }
    : { status: "unavailable", value: null };
}

export function projectActivitySnapshot(
  value: unknown,
  expectedDate: string,
  source: Exclude<ActivityRunSource, "unavailable">,
): ActivitySnapshotResult {
  const snapshot = objectRecord(value);
  const dayState = objectRecord(snapshot?.dayState);
  if (!snapshot || !dayState || !Array.isArray(dayState.runs)) {
    return { status: "unavailable", reason: "invalid-snapshot" };
  }
  if (dayState.date !== expectedDate) {
    return { status: "unavailable", reason: "date-mismatch" };
  }
  if (dayState.runs.length > 600) return { status: "unavailable", reason: "too-many-runs" };
  const runValues = objectRecord(snapshot.runValues);
  const seen = new Set<string>();
  const runs: ActivitySnapshotRun[] = [];
  for (const rawRun of dayState.runs) {
    const run = objectRecord(rawRun);
    if (!run || typeof run.id !== "string" || run.id.length < 1 || run.id.length > 200) {
      return { status: "unavailable", reason: "invalid-run" };
    }
    if (seen.has(run.id)) return { status: "unavailable", reason: "duplicate-run" };
    seen.add(run.id);
    runs.push({
      runId: run.id,
      label: runLabel(run),
      source,
      manualAllergen: manualValue(runValues, run.id),
      ended: run.finished === true,
    });
  }
  return { status: "available", runs };
}

export function projectAllergenReview(payload: Record<string, unknown>) {
  const footprint = objectRecord(payload.footprint);
  const allergens = Array.isArray(footprint?.allergens)
    && footprint.allergens.every((value) => typeof value === "string")
    ? footprint.allergens as string[]
    : null;
  const unknownIngredients = Array.isArray(footprint?.unknownIngredients)
    && footprint.unknownIngredients.every((value) => typeof value === "string")
    ? footprint.unknownIngredients as string[]
    : null;
  const missingComponents = Array.isArray(footprint?.missingComponents)
    && footprint.missingComponents.every((value) => typeof value === "string")
    ? footprint.missingComponents as string[]
    : null;
  const reviewed = payload.footprintReviewed === true;
  const hasUnknownCoverage = !unknownIngredients || unknownIngredients.length > 0
    || !missingComponents || missingComponents.length > 0;
  const state = !reviewed
    ? "unknown"
    : footprint?.status !== "complete" || hasUnknownCoverage
      ? "unknown"
      : allergens?.length === 0
        ? "reviewed-empty"
        : allergens
          ? "reviewed"
          : "unknown";
  return {
    state: state as "reviewed-empty" | "reviewed" | "unknown",
    allergens,
    unknownIngredients,
    missingComponents,
    note: typeof payload.note === "string" ? payload.note : null,
  };
}
