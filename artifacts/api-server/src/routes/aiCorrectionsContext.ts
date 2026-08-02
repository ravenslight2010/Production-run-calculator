import { desc, eq } from "drizzle-orm";
import { db, aiCorrectionsTable } from "@workspace/db";
import { currentScope } from "../lib/requestScope";
import {
  buildCorrectionsBlock,
  dropConflictingCorrections,
  filterCorrectionsByDomain,
  normalizeCorrections,
  type AiCorrection,
} from "@workspace/ai-memory";

// Read side of the shared, factory-wide corrections memory. Loads the confirmed
// "read fromText as toText" mappings (domain-tagged) so every name-resolving AI
// prompt can be told about fixes staff already made elsewhere. FAIL-SAFE: any DB
// error yields an empty list and the prompt is built without the memory block —
// the helper still works, it just doesn't get the extra hints.

type ContextLogger = {
  error: (obj: unknown, msg?: string) => void;
};

export async function loadCorrections(log: ContextLogger): Promise<AiCorrection[]> {
  try {
    const rows = await db
      .select()
      .from(aiCorrectionsTable)
      .where(eq(aiCorrectionsTable.scope, currentScope()))
      .orderBy(desc(aiCorrectionsTable.updatedAt));
    return dropConflictingCorrections(
      normalizeCorrections(
        rows.map((r) => ({ domain: r.domain, fromText: r.fromText, toText: r.toText })),
      ),
    );
  } catch (err) {
    log.error({ err }, "failed to load ai corrections for prompt");
    return [];
  }
}

// Append the domain-relevant corrections block to a built user prompt. When
// `domains` is given only that subset is included; omitting `domains` (or
// passing an empty array) includes all corrections — used by general-purpose
// AI features that need the full name-equivalence picture. When no corrections
// apply, the prompt is returned unchanged.
export function appendCorrectionsBlock(
  userPrompt: string,
  corrections: AiCorrection[],
  domains?: string[],
): string {
  const relevant =
    domains && domains.length > 0
      ? filterCorrectionsByDomain(corrections, domains)
      : corrections;
  const block = buildCorrectionsBlock(relevant);
  return block ? `${userPrompt}\n\n${block}` : userPrompt;
}
