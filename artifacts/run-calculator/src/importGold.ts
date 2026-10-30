export type ImportGoldConfig = {
  enabled: boolean;
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
