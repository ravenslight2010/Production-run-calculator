import type { RepairDefinition } from "./repairRegistry";
import {
  REPAIR_FINGERPRINT_SOURCE_CONTRACTS,
  repairDefinitionFingerprint,
} from "./repairDefinitionFingerprint";

const HEADER = `/**
 * Reviewed fingerprints for released automatic repair definitions.
 *
 * A mismatch requires either a new versioned repair id or an explicit review
 * and update of this manifest. The source-library plan payload is intentionally
 * absent because its independent immutable digest is verified separately.
 *
 * Preview: pnpm --filter @workspace/api-server run repair-fingerprints
 * Rewrite after approval: pnpm --filter @workspace/api-server run repair-fingerprints:write
 */
export const RELEASED_AUTOMATIC_REPAIR_FINGERPRINTS: Readonly<Record<string, string>> = Object.freeze({
`;

export function releasedRepairFingerprints(
  repairs: readonly RepairDefinition[],
): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(repairs.map((repair) => [
    repair.id,
    repairDefinitionFingerprint(repair, REPAIR_FINGERPRINT_SOURCE_CONTRACTS[repair.id]),
  ])));
}

export function renderReleasedRepairFingerprintManifest(
  repairs: readonly RepairDefinition[],
): string {
  const fingerprints = releasedRepairFingerprints(repairs);
  const entries = repairs.map((repair) =>
    `  ${JSON.stringify(repair.id)}: ${JSON.stringify(fingerprints[repair.id])},`);
  return `${HEADER}${entries.join("\n")}\n});\n`;
}