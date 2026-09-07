import {
  RepairRegistry,
  runAutomaticRepairs,
  runRegisteredRepair,
  type RepairDefinition,
  type RepairTransaction,
} from "./repairRegistry";
import * as liveProfile from "./repairs/liveProfileRecipeLinkRepair";
import * as crbIngredient from "./repairs/crbIngredientRepair";
import * as markerHygiene from "./repairs/markerAndImportHygieneRepairs";
import * as remainingMarkerHygiene from "./repairs/remainingMarkerResultImportHygieneRepairs";
import * as cheeseNormalization from "./repairs/cheeseRecipeNormalizationRepairs";
import * as remainingCheeseNormalization from "./repairs/remainingCheeseRecipeNormalizationRepairs";
import * as mixDough from "./repairs/mixDoughRepairs";
import * as doughMerge from "./repairs/doughMergeVanishRestoreRepair";
import * as historicalProfiles from "./repairs/historicalProfileAndContaminationRepairs";
import * as augustImports from "./repairs/augustImportRepairs";
import * as remainingAugustImports from "./repairs/remainingAugustImportRepairs";
import * as profileStub from "./repairs/profileNameLinkStubPurgeRepair";
import * as aug19Profile from "./repairs/aug19SavedSpecProfileRepair";
import * as aug19ProfileV2 from "./repairs/aug19SavedSpecProfileRepairV2";
import * as sourceReconciliation from "./repairs/sourceLibraryReconciliationRepair";

export {
  pickMixDuplicateLosers,
} from "./repairs/mixDoughRepairs";
export {
  healAldoCheeseOzInValues,
  recomputeCheeseSharesFromLbs,
} from "./repairs/remainingCheeseRecipeNormalizationRepairs";
export {
  healBoboApplicatorsInParse,
  healNaturalPepInValues,
  healNaturalPepList,
  findVerifiedFreshDeviceCopiedRunIds,
} from "./repairs/historicalProfileAndContaminationRepairs";
export { applySavedSpecProfileFields } from "./repairs/aug19SavedSpecProfileRepair";
export { applySavedSpecProfileFieldsV2 } from "./repairs/aug19SavedSpecProfileRepairV2";

/** Immutable released order. Never derive or sort this list. */
export const AUTOMATIC_DATA_HEAL_IDS = Object.freeze([
  "data-heal-result-backfill-v1",
  "ingredient-active-name-dedupe-v1",
  "live-profile-recipe-link-repair-v1",
  "crb-ingredient-conversion-v1",
  "crb-dough-family-consolidation-v1",
  "cheese-import-poison-cleanup-v1",
  "spec-alias-hygiene-purge-v1",
  "cheese-recipe-name-dedupe-v1",
  "generic-mix-poison-purge-v2",
  "cheese-named-mix-crossover-purge-v1",
  "cheese-share-backfill-v1",
  "cheese-oz-depoison-v1",
  "named-recipe-name-cleanup-v1",
  "dough-batch-yield-depoison-v1",
  "dough-family-weight-depoison-v1",
  "smd-pep-cheese-mix-restore-v1",
  "sea-salt-alias-undo-v1",
  "mix-duplicate-name-purge-v1",
  "purchased-crust-die-heal-v1",
  "dough-variant-suffix-dedupe-v1",
  "dough-merge-vanish-restore-v1",
  "bogus-merge-alias-purge-v1",
  "basha-hannaford-crosslink-parse-purge-v1",
  "aldo-cheese-tolerance-oz-v1",
  "bobo-cross-family-alias-undo-v1",
  "lowes-natural-pep-name-v1",
  "brand-fan-dough-depoison-v1",
  "brand-drift-rename-v1",
  "crb-dough-lucia-variant-customers-v2",
  "july-2026-profile-corrections-v1",
  "july-2026-audit-corrections-v2",
  "july-2026-audit-corrections-v3",
  "applicator-contamination-depoison-v1",
  "sync-row-name-registry-restore-v1",
  "brand-duplicate-purge-v1",
  "tunnel-pre-post-default-v1",
  "aug2026-import-fix-cheese-recipes-v1",
  "aug2026-import-fix-mixes-v1",
  "aug2026-import-fix-profiles-v1",
  "aug2026-import-fix-sauce-recipes-v1",
  "aug2026-cheese-recipe-lbs-v1",
  "aug2026-lowes-mix-stray-component-v1",
  "cheese-component-oz-strip-v1",
  "cheese-component-oz-strip-v2",
  "hannaford-tikka-masala-fix-v1",
  "profile-name-link-stub-purge-v1",
  "workbook-import-stub-purge-v1",
  "aug19-saved-spec-profile-repair-v1",
  "aug19-saved-spec-profile-repair-v2",
  "fresh-device-run-contamination-v1",
  "incident-resolved-workflow-reconciliation-v1",
  "source-library-reconciliation-2026-08-26-v1",
] as const);

const modules = [
  liveProfile, crbIngredient, markerHygiene, remainingMarkerHygiene,
  cheeseNormalization, remainingCheeseNormalization, mixDough, doughMerge,
  historicalProfiles, augustImports, remainingAugustImports, profileStub,
  aug19Profile, aug19ProfileV2, sourceReconciliation,
] as const;

function isDefinition(value: unknown): value is RepairDefinition<RepairTransaction> {
  return !!value && typeof value === "object" && "id" in value && "execute" in value &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { execute?: unknown }).execute === "function";
}

function focusedDefinitionsById(): Map<string, RepairDefinition<RepairTransaction>> {
  const byId = new Map<string, RepairDefinition<RepairTransaction>>();
  for (const module of modules) {
    for (const value of Object.values(module)) {
      if (!isDefinition(value)) continue;
      if (byId.has(value.id)) throw new Error(`Duplicate focused repair definition for ${value.id}`);
      byId.set(value.id, value);
    }
  }
  const released = new Set<string>(AUTOMATIC_DATA_HEAL_IDS);
  const extras = [...byId.keys()].filter((id) => !released.has(id));
  if (extras.length) throw new Error(`Unexpected focused repair definitions: ${extras.join(", ")}`);
  return byId;
}

/** Registration-only view used by startup and contract tests; has no DB effects. */
export function registeredAutomaticDataHeals(): RepairRegistry<RepairTransaction> {
  const byId = focusedDefinitionsById();
  const registry = new RepairRegistry<RepairTransaction>();
  let previous: string | undefined;
  for (const [index, id] of AUTOMATIC_DATA_HEAL_IDS.entries()) {
    const definition = byId.get(id);
    if (!definition) throw new Error(`Missing focused repair definition for ${id}`);
    // Released startup order is the dependency authority. Individual modules
    // remain focused on immutable repair behavior and may be imported by tests,
    // but only this catalog assembles the historical chain.
    registry.register({
      ...definition,
      dependencies: index === 0 || index === 2 || index === 3 ? [] : [previous!],
    });
    previous = id;
  }
  return registry;
}

export async function runDataHeals(): Promise<void> {
  await runAutomaticRepairs(registeredAutomaticDataHeals());
}

// Compatibility entry points retained for existing integration tests and
// operational callers. They still use the shared runner; no repair owns a
// transaction or marker.
async function runById(id: string): Promise<void> {
  const definition = registeredAutomaticDataHeals().list().find((repair) => repair.id === id);
  if (!definition) throw new Error(`Unknown automatic repair ${id}`);
  // Direct compatibility callers historically ran one repair in isolation.
  // Startup still uses the immutable predecessor chain above; only this
  // compatibility entry point clears dependencies before using the same
  // transaction/marker runner.
  await runRegisteredRepair({ ...definition, dependencies: [] });
}

export const runProfileNameLinkStubPurge = () => runById("profile-name-link-stub-purge-v1");
export const runWorkbookImportStubPurge = () => runById("workbook-import-stub-purge-v1");
export const runAug19SavedSpecProfileRepair = () => runById("aug19-saved-spec-profile-repair-v1");
export const runAug19SavedSpecProfileRepairV2 = () => runById("aug19-saved-spec-profile-repair-v2");
export const runSourceLibraryReconciliationHeal = () =>
  runById("source-library-reconciliation-2026-08-26-v1");