// Shared AI corrections memory — web platform glue.
//
// One factory-wide pool of confirmed name corrections (domain-tagged
// fromText -> toText). Whenever a user confirms a name fix in ANY AI helper —
// an ingredient merge, an Excel brand/flavor match, a spec-sheet label — the
// mapping is recorded here (in addition to that helper's own learned-alias
// table). The server feeds the pool back into every name-resolving AI prompt so
// a correction learned once is honored everywhere.
//
// Best-effort and additive: saving a correction must never break the primary
// confirmation, so failures are swallowed. Mirrors the mobile glue in
// artifacts/run-calculator-mobile/context/aiCorrections.ts (replit.md parity).

import type {
  AiCorrection,
  AiMemoryHealthReport,
  SafeCorrectionRepair,
} from "@workspace/ai-memory";
import { inventoryClientId } from "./inventoryShared";

export type { AiCorrection };

// Server response shape includes `id` for deletion.
export interface AiCorrectionWithId extends AiCorrection {
  id: number;
}

export interface AiMemoryHealthApplyResult {
  before: AiMemoryHealthReport;
  after: AiMemoryHealthReport;
  applied: SafeCorrectionRepair[];
  summary: { deleted: number; retargeted: number };
}

export async function fetchAiCorrections(): Promise<AiCorrectionWithId[]> {
  const res = await fetch("/api/ai-corrections", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`Failed to fetch corrections: ${res.status}`);
  const data = await res.json();
  return (data.corrections ?? []) as AiCorrectionWithId[];
}

export async function deleteAiCorrection(id: number): Promise<AiCorrectionWithId[]> {
  const res = await fetch(`/api/ai-corrections/${id}`, {
    method: "DELETE",
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`Failed to delete correction: ${res.status}`);
  const data = await res.json();
  return (data.corrections ?? []) as AiCorrectionWithId[];
}

export async function fetchAiMemoryHealth(): Promise<AiMemoryHealthReport> {
  const res = await fetch("/api/ai-memory/health-check", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`Failed to check AI memory health: ${res.status}`);
  const data = (await res.json()) as { report: AiMemoryHealthReport };
  return data.report;
}

export async function applyAiMemorySafeFixes(): Promise<AiMemoryHealthApplyResult> {
  const res = await fetch("/api/ai-memory/health-check/apply", {
    method: "POST",
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`Failed to apply AI memory fixes: ${res.status}`);
  return (await res.json()) as AiMemoryHealthApplyResult;
}

export async function saveAiCorrections(corrections: AiCorrection[]): Promise<void> {
  if (corrections.length === 0) return;
  try {
    await fetch("/api/ai-corrections", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": inventoryClientId(),
      },
      body: JSON.stringify({ corrections }),
    });
  } catch {
    // Advisory memory — never let a save failure break the confirmation.
  }
}
