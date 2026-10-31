import { logger } from "../lib/logger";
import { legacyRepairUnavailable } from "./contract";
export { healNaturalPepInValues, healNaturalPepList } from "./pepNormalization";
export const AUTOMATIC_DATA_HEAL_IDS: readonly string[] = Object.freeze([]);
export const registeredAutomaticDataHeals = legacyRepairUnavailable;
// Fresh installs have no authority to claim or execute historical markers. This
// completes the startup stage without calling a DB or reporting an applied heal.
export async function runDataHeals(): Promise<void> {
  logger.info(
    { event: "legacy_repairs_not_applicable", buildProfile: "self-host-fresh" },
    "Historical production repairs are not available in this fresh installation",
  );
}
export const runProfileNameLinkStubPurge = legacyRepairUnavailable;
export const runWorkbookImportStubPurge = legacyRepairUnavailable;
export const runAug19SavedSpecProfileRepair = legacyRepairUnavailable;
export const runAug19SavedSpecProfileRepairV2 = legacyRepairUnavailable;
export const runSourceLibraryReconciliationHeal = legacyRepairUnavailable;
export const runSourceLibraryReconciliationHealV2 = legacyRepairUnavailable;
export const runSpecAliasContextHygieneRepair = legacyRepairUnavailable;
