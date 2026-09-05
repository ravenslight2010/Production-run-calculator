import { gunzipSync } from "node:zlib";
import {
  SOURCE_LIBRARY_RECONCILIATION_PLAN_GZIP_BASE64,
  SOURCE_LIBRARY_RECONCILIATION_PLAN_SHA256,
} from "./sourceLibraryReconciliationPlan.generated";

export const SOURCE_LIBRARY_RECONCILIATION_REPORT =
  "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json";
export type ReconciliationTable = "dough_recipes" | "sauce_recipes" | "cheese_recipes" | "mixes";
export type ReconciliationProposal = {
  classification: "automatic";
  action: "replace-components-from-approved-source" | "link-source-identity";
  table: ReconciliationTable;
  before: { id: string; name: string };
  after: Record<string, unknown>;
};
export type SourceLibraryReconciliationPlan = {
  replacements: ReconciliationProposal[];
  links: ReconciliationProposal[];
  allZeroStubs: Array<{ table: "cheese_recipes"; id: string; name: string; canonicalId: string; canonicalName: string }>;
};
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Reject every report field outside the reviewed automatic action boundary. */
export function parseSourceLibraryReconciliationPlan(value: unknown): SourceLibraryReconciliationPlan {
  if (!isRecord(value)) throw new Error("Invalid source-library reconciliation report");
  const validTables = new Set<ReconciliationTable>(["dough_recipes", "sauce_recipes", "cheese_recipes", "mixes"]);
  const generated = Array.isArray(value.replacements) && Array.isArray(value.links);
  const raw = generated ? [
    ...(value.replacements as unknown[]).map((p) => ({ ...(p as Record<string, unknown>), classification: "automatic", action: "replace-components-from-approved-source" })),
    ...(value.links as unknown[]).map((p) => ({ ...(p as Record<string, unknown>), classification: "automatic", action: "link-source-identity" })),
  ] : value.proposals;
  const proposals = (Array.isArray(raw) ? raw : []).filter((p): p is Record<string, unknown> => isRecord(p) && p.classification === "automatic").map((proposal) => {
    if (
      (proposal.action !== "replace-components-from-approved-source" && proposal.action !== "link-source-identity") ||
      typeof proposal.table !== "string" || !validTables.has(proposal.table as ReconciliationTable) ||
      !isRecord(proposal.before) || typeof proposal.before.id !== "string" || typeof proposal.before.name !== "string" ||
      !isRecord(proposal.after)
    ) throw new Error("Invalid automatic source-library reconciliation proposal");
    if (proposal.action === "link-source-identity" && typeof proposal.after.sourceName !== "string") throw new Error("Invalid source-library identity-link proposal");
    if (proposal.action === "replace-components-from-approved-source" && !Array.isArray(proposal.after.components)) throw new Error("Invalid source-library replacement proposal");
    return proposal as ReconciliationProposal;
  });
  const stubs = generated ? value.allZeroStubs : isRecord(value.findings) ? value.findings.allZeroStubs : undefined;
  if (!Array.isArray(stubs)) throw new Error("Invalid source-library stub list");
  const allZeroStubs = stubs.map((stub) => {
    if (!isRecord(stub) || stub.table !== "cheese_recipes" || typeof stub.id !== "string" || typeof stub.name !== "string" || typeof stub.canonicalId !== "string" || typeof stub.canonicalName !== "string") {
      throw new Error("Invalid source-library zero stub");
    }
    return { table: "cheese_recipes" as const, id: stub.id, name: stub.name, canonicalId: stub.canonicalId, canonicalName: stub.canonicalName };
  });
  if (allZeroStubs.length !== 3) throw new Error("Unexpected source-library zero stub count");
  const replacements = proposals.filter((proposal) => proposal.action === "replace-components-from-approved-source");
  const links = proposals.filter((proposal) => proposal.action === "link-source-identity");
  if (replacements.length !== 46 || links.length !== 22) throw new Error("Unexpected source-library automatic proposal count");
  return { replacements, links, allZeroStubs };
}
export function loadSourceLibraryReconciliationPlan(): SourceLibraryReconciliationPlan {
  return SOURCE_LIBRARY_RECONCILIATION_PLAN;
}
export { SOURCE_LIBRARY_RECONCILIATION_PLAN_SHA256 };
export const SOURCE_LIBRARY_RECONCILIATION_PLAN = parseSourceLibraryReconciliationPlan(
  JSON.parse(gunzipSync(Buffer.from(SOURCE_LIBRARY_RECONCILIATION_PLAN_GZIP_BASE64, "base64")).toString("utf8")),
);