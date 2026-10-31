import { compareImportSnapshots, type ImportSnapshot } from "@workspace/spec-import/import-changes";
import { requestImportSafetyReview, importReviewIdentityEpoch } from "./importSafetyReview";
import { localImportSourceBaseline } from "./importSourceBaseline";
import { validateImportAppliedValues } from "@workspace/spec-import/import-applied-values";

export function scheduleAppliedValues(date: string, runs: readonly { brand: string; flavor: string; casesPlanned: number; notes: string }[]): ImportSnapshot | undefined {
  return validateImportAppliedValues({ runs: runs.map((row, index) => ({ key: `${date}:${index}`, date, brand: row.brand, flavor: row.flavor, casesPlanned: row.casesPlanned, notes: row.notes })) }) ?? undefined;
}

export async function reviewScheduleImport(
  date: string,
  before: ImportSnapshot,
  after: ImportSnapshot,
  localEditor = false,
  sourceKey?: string,
  appliedValues?: ImportSnapshot,
): Promise<boolean> {
  const epoch = importReviewIdentityEpoch();
  const baseline = !localEditor && appliedValues
    ? await localImportSourceBaseline("schedule", sourceKey, appliedValues, date)
    : { status: "unavailable", label: localEditor ? "Editor-only proposal: not an acknowledged Apply and not saved as a source baseline."
      : "Applied-value receipt is unavailable or exceeds bounded history coverage (500 rows / 100 KB). Counts and current runs are not source-version evidence.", changes: [] };
  return requestImportSafetyReview({
    title: `Review schedule changes · ${date || "editor"}`,
    recovery: localEditor
      ? "Changes enter the schedule editor only; Save Schedule is a separate step. No atomic import Undo or stock writes."
      : "Each day saves separately using the existing snapshot conflict fence. This is not an atomic multi-day Apply and has no guarded import Undo. Only explicit replaced imported runs are removed; started, completed and manual runs remain protected.",
    changes: compareImportSnapshots(before, after),
    baseline,
  }, epoch);
}
