import { createHash } from "node:crypto";
import type { RepairDefinition } from "./repairRegistry";
import { CRB_INGREDIENT_HEAL_CONTRACT } from "./crbIngredientHeal";
import { liveProfileRecipeLinkRepairContract } from "./repairs/liveProfileRecipeLinkRepair";
import { CRB_INGREDIENT_REPAIR_ID } from "./repairs/crbIngredientRepair";
import { LEGACY_REPAIR_SOURCE_CONTRACTS } from "./repairs/legacyRepairSourceContracts";
import {
  SOURCE_LIBRARY_RECONCILIATION_FROM_DATE,
  SOURCE_LIBRARY_RECONCILIATION_HEAL_ID,
  SOURCE_LIBRARY_RECONCILIATION_PLAN_SHA256,
  SOURCE_LIBRARY_RECONCILIATION_REPORT_SHA256,
  SOURCE_LIBRARY_RECONCILIATION_RERUN_HEAL_ID,
} from "./sourceLibraryReconciliationHeal";
import { speedAdjustmentBaselineRepairContract } from "./repairs/speedAdjustmentBaselineRepair";

export type RepairFingerprintSource = Readonly<Record<string, unknown>>;

/** Explicit immutable source contracts that are part of released repair definitions. */
export const REPAIR_FINGERPRINT_SOURCE_CONTRACTS:
Readonly<Record<string, RepairFingerprintSource>> = Object.freeze({
  ...LEGACY_REPAIR_SOURCE_CONTRACTS,
  [liveProfileRecipeLinkRepairContract.id]: liveProfileRecipeLinkRepairContract,
  [CRB_INGREDIENT_REPAIR_ID]: CRB_INGREDIENT_HEAL_CONTRACT,
  [SOURCE_LIBRARY_RECONCILIATION_RERUN_HEAL_ID]: Object.freeze({
    originalHealId: SOURCE_LIBRARY_RECONCILIATION_HEAL_ID,
    rerunHealId: SOURCE_LIBRARY_RECONCILIATION_RERUN_HEAL_ID,
    planSha256: SOURCE_LIBRARY_RECONCILIATION_PLAN_SHA256,
    reportSha256: SOURCE_LIBRARY_RECONCILIATION_REPORT_SHA256,
    fromDate: SOURCE_LIBRARY_RECONCILIATION_FROM_DATE,
  }),
  [speedAdjustmentBaselineRepairContract.id]: speedAdjustmentBaselineRepairContract,
});

type FingerprintedRepairDefinition = Omit<RepairDefinition, "execute" | "validateResult">;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Fingerprints reviewable release data only. Runtime callbacks are deliberately excluded. */
export function repairDefinitionFingerprint(
  definition: RepairDefinition,
  source?: RepairFingerprintSource,
): string {
  const {
    execute: _execute,
    validateResult: _validateResult,
    ...metadata
  } = definition;
  const payload: {
    definition: FingerprintedRepairDefinition;
    source?: RepairFingerprintSource;
  } = { definition: metadata };
  if (source) payload.source = source;
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}