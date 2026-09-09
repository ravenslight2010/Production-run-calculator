// Domain-owned job handlers. This module intentionally depends only on the
// generic lifecycle contract: importing it registers workloads but does not
// start a worker or change any synchronous compatibility route.
import { and, eq } from "drizzle-orm";
import {
  db,
  finalizedOperationalReportsTable,
  savedSpecSheetsTable,
} from "@workspace/db";
import {
  reconcileSpecProfiles,
  reconcileSpecWithRecipes,
  toReconcileProfiles,
  toReconcileRecipes,
} from "@workspace/spec-reconcile";
import type { ParsedSpecImport } from "@workspace/spec-import";
import { openai, pickModel } from "@workspace/integrations-openai-ai-server";
import { canonicalReportCsv, canonicalReportPrintHtml, canonicalReportSnapshotId, canonicalReportXlsx, type CanonicalReportExportFormat } from "./canonicalReportExport";
import { writeServerJobArtifact } from "./serverJobArtifactCache";
import { registerServerJob } from "./serverJobs";
import { compactOperationalIntentSnapshots } from "./mutationCompaction";
import type { Scope } from "./requestScope";
import { logger } from "./logger";
import { extractReviewedDocument, workbookTextAdapter } from "./reviewedDocumentExtraction";
import { groundPromptWithMemory } from "../routes/aiMemoryContext";
import {
  toCurrentReconcileProfiles,
  toCurrentReconcileRecipes,
  validateSpecReconcileBody,
} from "../routes/aiSpecReconcile";
import {
  buildParseSpecSheetPrompt,
  sanitizeParseSpecSheet,
  validateParseSpecSheetBody,
} from "../routes/aiParseSpecSheet";

registerServerJob("workbook-parse", {
  capability: "use-ai-tools",
  handler: async (context) => {
    const validation = validateParseSpecSheetBody(context.job.input);
    if (!validation.ok) throw new Error(validation.error);
    await context.reportProgress(5, "Grounding workbook parse");
    const { system, user } = buildParseSpecSheetPrompt(validation.data);
    const userPrompt = await groundPromptWithMemory(logger, user, {
      correctionDomains: ["brand", "flavor", "die", "ingredient", "recipe"],
    });
    if (await context.isCancellationRequested()) throw new Error("Cancelled");
    await context.reportProgress(25, "Parsing workbook");
    const extraction = await extractReviewedDocument<{ kind: "workbook-text"; workbookText: string }, ParsedSpecImport>({
      label: "job-workbook-parse", log: logger, adapter: workbookTextAdapter,
      source: { kind: "workbook-text", workbookText: validation.data.workbookText },
      prompt: { system, user: userPrompt },
      call: async ({ prompt }) => {
        // The Gemini adapter accepts cancellation/timeout request options and
        // fences its underlying provider promise when its SDK has no native
        // AbortSignal parameter.
        if (context.signal.aborted) throw new Error("Cancelled");
        const response = await openai.chat.completions.create({
          model: pickModel("full"), max_completion_tokens: 65536, response_format: { type: "json_object" },
          messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
        }, { signal: context.signal, timeoutMs: 90_000 });
        if (context.signal.aborted) throw new Error("Cancelled");
        return response.choices[0]?.message?.content ?? "";
      },
      sanitize: (raw) => sanitizeParseSpecSheet(raw, validation.data),
      empty: (): ParsedSpecImport => ({ profiles: [], recipes: [] }),
    });
    if (!extraction.ok) throw new Error(extraction.metadata.modelStatus === "rate-limited"
      ? "Workbook parsing is rate-limited; retry this review-only job later."
      : "Workbook parsing failed because the model response was unavailable or malformed.");
    if (await context.isCancellationRequested()) throw new Error("Cancelled");
    await context.reportProgress(95, "Parsed workbook is ready for review");
    return {
      profiles: extraction.data.profiles, recipes: extraction.data.recipes,
      reviewRequired: true, ...extraction.metadata,
      ...(extraction.data.note ? { note: extraction.data.note } : {}),
      ...(extraction.data.warnings?.length ? { warnings: extraction.data.warnings } : {}),
    };
  },
});

registerServerJob("workbook-reconcile", {
  capability: "manage-profiles",
  handler: async (context) => {
    const validation = validateSpecReconcileBody(context.job.input);
    if (!validation.ok) throw new Error(validation.error);
    await context.reportProgress(10, "Loading immutable spec-sheet snapshot");
    if (await context.isCancellationRequested()) throw new Error("Cancelled");
    const row = (await db.select().from(savedSpecSheetsTable).where(and(
      eq(savedSpecSheetsTable.scope, context.job.scope),
      eq(savedSpecSheetsTable.id, validation.data.specSheetId),
    )).limit(1))[0];
    if (!row) throw new Error("No saved spec sheet with that id in this scope");
    const data = (row.data ?? {}) as { recipes?: unknown; profiles?: unknown };
    await context.reportProgress(55, "Reconciling recipes deterministically");
    const discrepancies = reconcileSpecWithRecipes({
      specRecipes: toReconcileRecipes(data.recipes),
      currentRecipes: toCurrentReconcileRecipes(validation.data),
    });
    if (await context.isCancellationRequested()) throw new Error("Cancelled");
    const profileDiscrepancies = validation.data.currentProfiles === undefined ? [] : reconcileSpecProfiles({
      specProfiles: toReconcileProfiles(data.profiles),
      currentProfiles: toCurrentReconcileProfiles(validation.data),
    });
    await context.reportProgress(95, "Preparing review-only discrepancies");
    // This result is advisory only. No import write, merge, or profile update is
    // performed by a job; the existing reviewed confirmation path remains sole
    // authority for protected mutations.
    return { specSheetId: row.id, label: row.label, discrepancies, profileDiscrepancies, reviewRequired: true };
  },
});

registerServerJob("export-package", {
  capability: "review-incidents",
  handler: async (context) => {
    const input = context.job.input;
    if (!input || typeof input !== "object" || Array.isArray(input)
      || typeof (input as { finalizedReportId?: unknown }).finalizedReportId !== "string") {
      throw new Error("export-package requires finalizedReportId");
    }
    await context.reportProgress(20, "Resolving canonical finalized snapshot");
    const id = (input as { finalizedReportId: string }).finalizedReportId;
    const row = (await db.select().from(finalizedOperationalReportsTable).where(and(
      eq(finalizedOperationalReportsTable.id, id),
      eq(finalizedOperationalReportsTable.scope, context.job.scope),
    )).limit(1))[0];
    if (!row) throw new Error("Finalized report not found in this scope");
    if (await context.isCancellationRequested()) throw new Error("Cancelled");
    const format = (input as { format?: unknown }).format;
    if (format !== "csv" && format !== "xlsx" && format !== "print") throw new Error("export-package requires csv, xlsx, or print format");
    await context.reportProgress(45, "Generating canonical export");
    const snapshotId = canonicalReportSnapshotId({ id: row.id, contentHash: row.contentHash });
    const snapshot = { id: row.id, contentHash: row.contentHash, finalizedAt: row.finalizedAt, report: row.payload as import("@workspace/day-summary").OperationalReport };
    const bytes = format === "csv" ? Buffer.from(canonicalReportCsv(snapshot))
      : format === "print" ? Buffer.from(canonicalReportPrintHtml(snapshot))
        : Buffer.from(canonicalReportXlsx(snapshot));
    if (await context.isCancellationRequested()) throw new Error("Cancelled");
    const artifact = await writeServerJobArtifact(context.job.id, format as CanonicalReportExportFormat, bytes);
    await context.reportProgress(90, "Canonical artifact retained for download");
    return {
      canonicalSnapshotId: snapshotId,
      contentHash: row.contentHash,
      artifactSha256: artifact.sha256,
      artifactBytes: artifact.byteLength,
      downloadUrl: `/api/reports/operational/finalized/${encodeURIComponent(row.id)}/export?format=${format}&jobId=${encodeURIComponent(context.job.id)}`,
    };
  },
});

registerServerJob("mutation-compaction", {
  capability: "manage-staff",
  handler: async (context) => {
    await context.reportProgress(10, "Finding compactable mutation receipts");
    if (await context.isCancellationRequested()) throw new Error("Cancelled");
    const result = await compactOperationalIntentSnapshots(context.job.scope as Scope);
    await context.reportProgress(100, "Materialized mutation receipts compacted");
    return result;
  },
});
