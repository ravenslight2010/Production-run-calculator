import {
  listImportGoldRetention,
  recordImportGoldDeletionVerification,
  type ImportGoldRetentionResponse,
} from "@workspace/api-client-react";

// No source-bound approval picker exists yet. Configuration flags or metadata
// records alone must not expose the old, unbound capture checkbox.
export const REAL_SOURCE_CAPTURE_UI_AVAILABLE = false;

export type ImportGoldConfig = {
  enabled: boolean;
  cleanupEnabled: boolean;
  localConfigured: boolean;
  localAvailable: boolean;
  localScoringSwitchAvailable: boolean;
  localScoringEnabled: boolean;
  syntheticFixtureAvailable: boolean;
  geminiConfigured: boolean;
  retention: string;
  persistsAcrossFactoryPurge: boolean;
};

export type ImportGoldSyntheticReview = {
  fixtureVersion: string;
  importType: string;
  sourceLabel: string;
  input: Record<string, unknown>;
  expectedResult: Record<string, unknown>;
  applyEffect: string;
};

export type ImportGoldScore = {
  id: number;
  provider: string;
  status: string;
  accuracy: number | null;
  comparedFields: number;
  equalFields: number;
  errorCode: string | null;
  fieldDiffs: Array<{ field: string; expected: unknown; predicted: unknown }>;
  createdAt: string;
};

export type ImportGoldCase = {
  id: number;
  importType: string;
  sourceLabel: string;
  excluded: boolean;
  createdAt: string;
  scores: ImportGoldScore[];
};

export type ImportGoldCleanupCase = {
  id: number;
  importType: string;
  createdAt: string;
};

export type ImportGoldRetentionRecord = ImportGoldRetentionResponse["records"][number];

export type ImportGoldScoreBatchResult = {
  scoredCount: number;
  errorCount: number;
};

async function goldFetch(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `Import Gold request failed (${response.status})`);
  }
  return response;
}

export async function fetchImportGoldConfig(): Promise<ImportGoldConfig> {
  return await (await goldFetch("/api/import-gold/config")).json() as ImportGoldConfig;
}

export async function setImportGoldLocalScoringEnabled(enabled: boolean): Promise<void> {
  await goldFetch("/api/import-gold/local-scoring", {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export async function fetchImportGoldSyntheticReview(): Promise<ImportGoldSyntheticReview> {
  return await (await goldFetch("/api/import-gold/synthetic-review")).json() as ImportGoldSyntheticReview;
}

export async function applyImportGoldSyntheticReview(fixtureVersion: string): Promise<{ caseId: number; created: boolean }> {
  return await (await goldFetch("/api/import-gold/synthetic-apply", {
    method: "POST",
    body: JSON.stringify({ fixtureVersion, reviewed: true }),
  })).json() as { caseId: number; created: boolean };
}

export async function fetchImportGoldCases(): Promise<ImportGoldCase[]> {
  const body = await (await goldFetch("/api/import-gold/cases?limit=50")).json() as { cases?: ImportGoldCase[] };
  return Array.isArray(body.cases) ? body.cases : [];
}

export async function fetchImportGoldCleanupCases(): Promise<ImportGoldCleanupCase[]> {
  return (await fetchImportGoldCleanupPage()).cases;
}

export async function fetchImportGoldCleanupPage(cursor?: string): Promise<{
  cases: ImportGoldCleanupCase[];
  nextCursor: string | null;
}> {
  const body = await (await goldFetch(`/api/import-gold/cleanup-cases${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`)).json() as unknown;
  if (!body || typeof body !== "object" || !Array.isArray((body as { cases?: unknown }).cases)) {
    throw new Error("The cleanup inventory returned an unreadable response. Refresh the lab before retrying.");
  }
  const cases = (body as { cases: unknown[] }).cases;
  if (!cases.every((item) => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Record<string, unknown>;
    return Number.isSafeInteger(candidate.id) && Number(candidate.id) > 0 &&
      ["spec", "premix", "cheese"].includes(String(candidate.importType)) &&
      typeof candidate.createdAt === "string" && Number.isFinite(Date.parse(candidate.createdAt)) &&
      Object.keys(candidate).sort().join(",") === "createdAt,id,importType";
  })) {
    throw new Error("The cleanup inventory returned invalid case metadata. Refresh the lab before retrying.");
  }
  const nextCursor = (body as { nextCursor?: unknown }).nextCursor;
  if (nextCursor !== null && nextCursor !== undefined && (
    typeof nextCursor !== "string" || nextCursor.length === 0 || nextCursor.length > 512
  )) throw new Error("The cleanup inventory returned an invalid next page. Return to the newest cases and retry.");
  // Older serving builds have one page and no cursor. Never invent a next page.
  return { cases: cases as ImportGoldCleanupCase[], nextCursor: nextCursor as string | null | undefined ?? null };
}

export async function deleteImportGoldCleanupCase(id: number): Promise<void> {
  await goldFetch(`/api/import-gold/cleanup-cases/${id}`, { method: "DELETE" });
}

export async function fetchImportGoldRetention(
  offset = 0,
  status?: ImportGoldRetentionRecord["status"],
  revision?: string,
): Promise<ImportGoldRetentionResponse> {
  const page = await listImportGoldRetention({
    limit: 100, offset, ...(status ? { status } : {}), ...(revision ? { revision } : {}),
  });
  if (typeof page.revision !== "string" || !/^[a-f0-9]{64}$/.test(page.revision) ||
      (revision !== undefined && page.revision !== revision)) {
    throw new Error("The retention register changed or returned an unreadable revision. Refresh to retry.");
  }
  return page;
}

export async function fetchImportGoldRetentionReminderCounts(): Promise<{
  dueSoonCount: number;
  overdueCount: number;
}> {
  let offset = 0;
  let dueSoonCount = 0;
  let overdueCount = 0;
  let revision: string | undefined;
  let restarts = 0;

  while (true) {
    let page: ImportGoldRetentionResponse;
    try {
      page = await fetchImportGoldRetention(offset, undefined, revision);
    } catch (error) {
      if (revision && error && typeof error === "object" &&
          "status" in error && error.status === 409 && restarts < 2) {
        offset = 0;
        dueSoonCount = 0;
        overdueCount = 0;
        revision = undefined;
        restarts += 1;
        continue;
      }
      throw error;
    }
    revision = page.revision;
    let reachedPastReminderWindow = false;

    for (const record of page.records) {
      // The API orders unverified records by deadline, followed by verified
      // records. Once a non-reminder status marks the end of the deadline
      // window, later pages cannot contain due-soon or overdue reminders.
      if (record.status === "within_limit" || record.status === "verified") {
        reachedPastReminderWindow = true;
        break;
      }
      if (record.status === "due_soon") dueSoonCount += 1;
      if (record.status === "overdue") overdueCount += 1;
    }

    if (reachedPastReminderWindow || page.nextOffset === null) {
      return { dueSoonCount, overdueCount };
    }
    offset = page.nextOffset;
  }
}

export async function recordImportGoldCaseDeletionVerified(caseId: number): Promise<void> {
  await recordImportGoldDeletionVerification(caseId);
}

export async function setImportGoldExcluded(id: number, excluded: boolean): Promise<void> {
  await goldFetch(`/api/import-gold/cases/${id}/exclusion`, {
    method: "PATCH",
    body: JSON.stringify({ excluded }),
  });
}

export async function deleteImportGoldCase(id: number): Promise<void> {
  await goldFetch(`/api/import-gold/cases/${id}`, { method: "DELETE" });
}

export async function scoreImportGold(provider: "local" | "gemini", caseIds?: number[]): Promise<ImportGoldScoreBatchResult> {
  const response = await goldFetch("/api/import-gold/score", {
    method: "POST",
    body: JSON.stringify({ provider, ...(caseIds ? { caseIds } : {}) }),
  });
  const body = await response.json() as Partial<ImportGoldScoreBatchResult> | null;
  if (
    !body || !Number.isInteger(body.scoredCount) || Number(body.scoredCount) < 0 ||
    !Number.isInteger(body.errorCount) || Number(body.errorCount) < 0
  ) {
    throw new Error("The evaluator returned an unreadable score result. Refresh the lab before retrying.");
  }
  return { scoredCount: Number(body.scoredCount), errorCount: Number(body.errorCount) };
}

export async function downloadImportGoldJsonl(): Promise<void> {
  const response = await goldFetch("/api/import-gold/export.jsonl");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "import-gold-cases.jsonl";
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Strip workbook coordinates and file metadata before the user opts in to capture. */
export function makeImportGoldInput(value: unknown): Record<string, unknown> {
  const omittedKeys = new Set([
    "sourceLocations", "sourceBy", "sourceNames", "sourceText", "sourceEvidence",
    "sourcePreviewCells", "fileName", "filename", "originalFilename", "sheetName",
    "row", "column", "cell", "path",
  ]);
  const strip = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(strip);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item as Record<string, unknown>)
      .filter(([key]) => !omittedKeys.has(key))
      .map(([key, child]) => [key, strip(child)]));
  };
  const cleaned = strip(value);
  if (!cleaned || typeof cleaned !== "object" || Array.isArray(cleaned)) {
    throw new Error("The reviewed import input could not be prepared for evaluation capture.");
  }
  if (new TextEncoder().encode(JSON.stringify(cleaned)).byteLength > 100 * 1024) {
    throw new Error("This reviewed input is too large to save as an evaluation case.");
  }
  return cleaned as Record<string, unknown>;
}
