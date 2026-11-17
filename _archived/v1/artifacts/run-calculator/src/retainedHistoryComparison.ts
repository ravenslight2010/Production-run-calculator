import { stableRecordJson } from "./sharedRecordMigration";

export type HistoryComparisonOutcome = "identical" | "different" | "unmatched" | "ambiguous" | "unavailable";
type ObjectValue = Record<string, unknown>;
type RunDetails = { run: ObjectValue; values: ObjectValue };
type SelectedHistory = { date: string; runs: Map<string, RunDetails> };

function object(value: unknown): ObjectValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ObjectValue : undefined;
}

function selectedHistory(value: unknown): SelectedHistory | HistoryComparisonOutcome {
  const record = object(value);
  const date = record?.date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "unavailable";
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) return "unavailable";
  const snapshot = object(record?.snapshot);
  const dayState = object(snapshot?.dayState);
  const metadata = record?.runs ?? dayState?.runs;
  const values = object(record?.runValues ?? snapshot?.runValues);
  if (!Array.isArray(metadata) || !metadata.length || metadata.length > 100 || !values) return "unavailable";
  const runs = new Map<string, RunDetails>();
  for (const candidate of metadata) {
    const run = object(candidate);
    const id = run?.id;
    if (typeof id !== "string" || !id || id.length > 256) return "unavailable";
    if (record?.runId !== undefined && id !== record.runId) continue;
    if (runs.has(id)) return "ambiguous";
    const runValues = Object.hasOwn(values, id) ? object(values[id]) : undefined;
    if (!runValues) return "unavailable";
    runs.set(id, { run: run!, values: runValues });
  }
  return runs.size ? { date, runs } : "unavailable";
}

/** Exact date/run identity only; matching never establishes ownership. */
export function compareRetainedHistory(value: unknown, canonicalRows: unknown[]): HistoryComparisonOutcome {
  try {
    const selected = selectedHistory(value);
    if (typeof selected === "string") return selected;
    if (canonicalRows.length > 1_000) return "unavailable";
    if (canonicalRows.some((value) => {
      const row = object(value);
      return row?.date !== selected.date || typeof row.runId !== "string" || !row.runId || !object(row.snapshot);
    })) return "unavailable";
    let different = false;
    let missing = false;
    for (const [runId, local] of selected.runs) {
      const matches = canonicalRows.map(object).filter((row) =>
        row?.date === selected.date && row.runId === runId);
      if (matches.length > 1) return "ambiguous";
      if (!matches.length) { missing = true; continue; }
      const snapshot = object(matches[0]?.snapshot);
      const metadata = object(snapshot?.dayState)?.runs;
      const values = object(snapshot?.runValues);
      if (!Array.isArray(metadata) || !values) return "unavailable";
      const runs = metadata.map(object).filter((run) => run?.id === runId);
      if (runs.length > 1) return "ambiguous";
      const runValues = Object.hasOwn(values, runId) ? object(values[runId]) : undefined;
      if (!runs[0] || !runValues) return "unavailable";
      if (stableRecordJson(local) !== stableRecordJson({ run: runs[0], values: runValues })) different = true;
    }
    return missing ? "unmatched" : different ? "different" : "identical";
  } catch {
    return "unavailable";
  }
}

async function readComparisonPage(response: Response): Promise<ObjectValue | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 2_000_000) { await reader.cancel(); return; }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return object(JSON.parse(text));
  } finally {
    reader.releaseLock();
  }
}

/** Bounded, authenticated GETs only. Incomplete pagination is never a match. */
export async function fetchRetainedHistoryComparison(
  value: unknown,
  signal: AbortSignal,
  stillCurrent: () => boolean,
): Promise<HistoryComparisonOutcome> {
  try {
    const selected = selectedHistory(value);
    if (typeof selected === "string") return selected;
    const rows: unknown[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      if (signal.aborted || !stillCurrent()) return "unavailable";
      const params = new URLSearchParams({ from: selected.date, to: selected.date, limit: "100" });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/completed-history?${params}`, { cache: "no-store", signal });
      if (!response.ok || signal.aborted || !stillCurrent()) return "unavailable";
      const body = await readComparisonPage(response);
      if (!Array.isArray(body?.history) || body.history.length > 100 ||
        body.history.some((row) => object(row)?.date !== selected.date)) return "unavailable";
      rows.push(...body.history);
      if (body.nextCursor === undefined) return compareRetainedHistory(value, rows);
      if (typeof body.nextCursor !== "string" || !body.nextCursor || body.nextCursor.length > 1_000 ||
        cursors.has(body.nextCursor)) return "unavailable";
      cursor = body.nextCursor;
      cursors.add(cursor);
    }
    return "unavailable";
  } catch {
    return "unavailable";
  }
}
