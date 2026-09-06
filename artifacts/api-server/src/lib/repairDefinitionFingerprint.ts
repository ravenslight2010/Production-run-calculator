import { createHash } from "node:crypto";
import type { RepairDefinition } from "./repairRegistry";

export type RepairFingerprintSource = Readonly<Record<string, unknown>>;

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