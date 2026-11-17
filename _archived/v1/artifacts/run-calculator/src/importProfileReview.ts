import { compareImportSnapshots, type ImportSnapshot } from "@workspace/spec-import/import-changes";
import { loadBrandFlavors, loadRawProfile } from "./storage";
import { requestImportSafetyReview, importReviewIdentityEpoch } from "./importSafetyReview";
import { localImportSourceBaseline } from "./importSourceBaseline";
import type { ImportHistoryImportType } from "./importHistory";
import { validateImportAppliedValues } from "@workspace/spec-import/import-applied-values";

export type ReviewedProfilePatch = {
  brand: string;
  flavors?: readonly string[];
  patch: Record<string, unknown>;
};

/** Mirrors guide commits: sequential targeted patches, never an inferred delete. */
export async function reviewProfileImport(title: string, rows: readonly ReviewedProfilePatch[], type: ImportHistoryImportType, sourceKey?: string): Promise<{ values?: ImportSnapshot; verify: () => void } | null> {
  const epoch = importReviewIdentityEpoch();
  const flavors = loadBrandFlavors();
  const before: ImportSnapshot = { profiles: [] };
  const after: ImportSnapshot = { profiles: [] };
  const targets = new Map<string, { brand: string; flavor: string; patch: Record<string, unknown> }>();
  for (const row of rows) {
    const brand = row.brand.trim();
    if (!brand || !Object.keys(row.patch).length) continue;
    const picked = (row.flavors ?? []).map((flavor) => flavor.trim()).filter(Boolean);
    for (const flavor of picked.length ? picked : ["", ...(flavors[brand] ?? [])]) {
      const key = JSON.stringify([brand, flavor]);
      const previous = targets.get(key);
      targets.set(key, { brand, flavor, patch: { ...previous?.patch, ...row.patch } });
    }
  }
  const originals = new Map<string, string>();
  const appliedValues: ImportSnapshot = { profiles: [] };
  for (const [key, target] of targets) {
    const raw = loadRawProfile(target.brand, target.flavor);
    originals.set(key, JSON.stringify(raw));
    if (raw) before.profiles.push({ ...raw, key, brand: target.brand, flavor: target.flavor });
    after.profiles.push({ ...raw, ...target.patch, key, brand: target.brand, flavor: target.flavor });
    appliedValues.profiles.push({ ...target.patch, key, brand: target.brand, flavor: target.flavor });
  }
  const values = validateImportAppliedValues(appliedValues) ?? undefined;
  const baseline = await localImportSourceBaseline(type, sourceKey, appliedValues);
  const approved = await requestImportSafetyReview({
    title,
    recovery: "Profile patches use the existing local queue/sync path, not an atomic import transaction. No guarded import Undo. Current values are this device's profile snapshot; remote unreceived edits cannot be verified here. Inventory is unchanged.",
    changes: compareImportSnapshots(before, after),
    baseline: values ? baseline : { status: "unavailable", label: "Applied-value receipt exceeds the bounded coverage limit (500 rows / 100 KB) or contains unsupported fields. Full changes remain visible above; no baseline will be retained.", changes: [] },
  }, epoch);
  if (!approved) return null;
  if (JSON.stringify(loadBrandFlavors()) !== JSON.stringify(flavors) ||
      [...targets].some(([key, target]) => originals.get(key) !== JSON.stringify(loadRawProfile(target.brand, target.flavor)))) {
    throw new Error("Profiles changed while the import was being reviewed. Review the guide again before applying.");
  }
  return {
    values,
    verify: () => {
      for (const target of targets.values()) {
        const current = loadRawProfile(target.brand, target.flavor);
        if (Object.entries(target.patch).some(([field, value]) => JSON.stringify(current?.[field]) !== JSON.stringify(value))) {
          throw new Error("Some profile changes could not be verified locally. Do not assume the whole guide was saved. Reopen the guide and review current values; this path has no atomic rollback.");
        }
      }
    },
  };
}
