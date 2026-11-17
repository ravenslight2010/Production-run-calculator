import { compareImportSourceVersions, type ImportSnapshot } from "@workspace/spec-import/import-changes";
import { validateImportAppliedValues } from "@workspace/spec-import/import-applied-values";
import { fetchImportHistory, type ImportHistoryImportType } from "./importHistory";
import type { ImportSafetyReview } from "./importSafetyReview";

export async function localImportSourceBaseline(type: ImportHistoryImportType, sourceKey: string | undefined, candidate: ImportSnapshot, date?: string): Promise<ImportSafetyReview["baseline"]> {
  if (!sourceKey) return { status: "unavailable", label: "No recognized source identity. A previous workbook cannot be reconstructed from counts or current factory values.", changes: [] };
  // Existing scope/capability-gated history is bounded and newest-first.
  const rows = await fetchImportHistory({ type, sourceKey, status: "complete" });
  const previous = rows[0];
  const baseline = validateImportAppliedValues(previous?.summary.appliedValues);
  if (!previous || !baseline) return {
    status: "unavailable",
    label: previous ? `History ${previous.id} has no retained applied-value baseline (legacy or coverage unavailable). Earlier records are not silently substituted.`
      : "No successful Apply history exists for this scoped source identity.",
    changes: [],
  };
  return {
    status: "available",
    label: `History ${previous.id} · ${new Date(previous.createdAt).toLocaleString()} · ${previous.summary.persistence}. Applied business values, not source-only workbook facts. Local verification does not prove remote delivery; schedule acknowledgment is per day, not an atomic multi-day transaction. Source absence is not a deletion instruction.`,
    changes: compareImportSourceVersions(date ? { runs: (baseline.runs ?? []).filter((row) => row.date === date) } : baseline, candidate),
  };
}
