// Evaluation-only copy of the retired second-pass reviewer logic.
// This module is used only by the isolated benchmark script, never by the app.

export type ReviewStatus = "ok" | "warn" | "reject";
export const REVIEW_STATUSES: readonly ReviewStatus[] = ["ok", "warn", "reject"];

export const MAX_REVIEW_REASON_LEN = 300;
export const MAX_REVIEW_ITEMS = 200;
export const MAX_REVIEW_ITEM_TEXT_LEN = 600;

export interface ReviewItem {
  id: string;
  text: string;
}

export interface ReviewVerdict {
  id: string;
  status: ReviewStatus;
  reason?: string;
}

export function normalizeReviewStatus(raw: unknown): ReviewStatus {
  const status = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (
    ["reject", "rejected", "wrong", "incorrect", "bad", "error", "remove", "drop", "no"].includes(
      status,
    )
  ) {
    return "reject";
  }
  if (
    ["warn", "warning", "caution", "risky", "risk", "review", "unsure", "maybe", "verify"].includes(
      status,
    )
  ) {
    return "warn";
  }
  return "ok";
}

export function normalizeReviewItems(items: ReadonlyArray<ReviewItem>): ReviewItem[] {
  const seen = new Set<string>();
  const output: ReviewItem[] = [];
  for (const item of items) {
    if (!item) continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const text =
      typeof item.text === "string" ? item.text.trim().slice(0, MAX_REVIEW_ITEM_TEXT_LEN) : "";
    if (!id || !text || seen.has(id)) continue;
    seen.add(id);
    output.push({ id, text });
    if (output.length >= MAX_REVIEW_ITEMS) break;
  }
  return output;
}

export function buildReviewPrompt(
  featureLabel: string,
  instructions: string,
  items: ReadonlyArray<ReviewItem>,
): { system: string; user: string } {
  const system =
    "You are a careful reviewer in a frozen-pizza factory app. Another AI helper " +
    `just produced suggestions for: ${featureLabel}. Your ONLY job is to act as a ` +
    "second set of eyes and flag suggestions that look risky, unsafe, or likely " +
    "wrong BEFORE a human applies them. Be conservative: mark something as a " +
    "problem only when you have a concrete reason. For each item return a status " +
    'of "ok" (looks fine), "warn" (plausible but double-check, give a reason), or ' +
    '"reject" (likely wrong/unsafe, give a reason). ' +
    (instructions ? `Specific things to watch for: ${instructions} ` : "") +
    "You are not editing anything; the human reviews your flags and decides.";

  const lines: string[] = [];
  lines.push("ITEMS TO REVIEW (each has an id you MUST echo back verbatim):");
  for (const item of normalizeReviewItems(items)) {
    lines.push(`  - id=${item.id}: ${item.text}`);
  }
  lines.push("");
  lines.push(
    "Return ONLY JSON of the exact shape: " +
      '{"verdicts":[{"id":string,"status":"ok"|"warn"|"reject","reason":string}]}. ' +
      "Include every id exactly once, copied verbatim. Use a short, specific " +
      '"reason" for any warn/reject; reason may be empty for ok.',
  );

  return { system, user: lines.join("\n") };
}

export function sanitizeReviewVerdicts(
  raw: unknown,
  knownIds: ReadonlyArray<string>,
): ReviewVerdict[] {
  const known = new Set(knownIds);
  const values =
    raw && typeof raw === "object" && Array.isArray((raw as { verdicts?: unknown }).verdicts)
      ? (raw as { verdicts: unknown[] }).verdicts
      : Array.isArray(raw)
        ? raw
        : [];

  const seen = new Set<string>();
  const output: ReviewVerdict[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const id =
      typeof (value as { id?: unknown }).id === "string"
        ? (value as { id: string }).id.trim()
        : "";
    if (!id || !known.has(id) || seen.has(id)) continue;
    const status = normalizeReviewStatus((value as { status?: unknown }).status);
    const reason =
      typeof (value as { reason?: unknown }).reason === "string"
        ? (value as { reason: string }).reason.trim().slice(0, MAX_REVIEW_REASON_LEN)
        : "";
    seen.add(id);
    output.push({ id, status, ...(reason ? { reason } : {}) });
    if (output.length >= MAX_REVIEW_ITEMS) break;
  }
  return output;
}

export function verdictsById(verdicts: ReadonlyArray<ReviewVerdict>): Map<string, ReviewVerdict> {
  const byId = new Map<string, ReviewVerdict>();
  for (const verdict of verdicts) byId.set(verdict.id, verdict);
  return byId;
}
