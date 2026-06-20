// Shared AI corrections memory — mobile platform glue.
//
// One factory-wide pool of confirmed name corrections (domain-tagged
// fromText -> toText). Whenever a user confirms a name fix in ANY AI helper —
// an ingredient merge, an Excel brand/flavor match, a spec-sheet label — the
// mapping is recorded here (in addition to that helper's own learned-alias
// table). The server feeds the pool back into every name-resolving AI prompt so
// a correction learned once is honored everywhere.
//
// Best-effort and additive: saving a correction must never break the primary
// confirmation, so failures are swallowed. Mirrors the web glue in
// artifacts/run-calculator/src/aiCorrections.ts (replit.md parity).

import type { AiCorrection } from "@workspace/ai-memory";
import { getAuthToken } from "@workspace/api-client-react";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";

export type { AiCorrection };

export async function saveAiCorrections(corrections: AiCorrection[]): Promise<void> {
  if (corrections.length === 0) return;
  try {
    const base = getApiBaseUrl();
    if (!base) return;
    const clientId = await getOrCreateClientId();
    const token = await getAuthToken();
    await fetch(`${base}/api/ai-corrections`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": clientId,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ corrections }),
    });
  } catch {
    // Advisory memory — never let a save failure break the confirmation.
  }
}
