// Pure logic for the reviewer AI ("second set of eyes"). The reviewer is given
// the items a primary AI helper produced and returns a verdict per item so the
// review UI can flag risky/likely-wrong suggestions before staff apply them.
//
// Generic across every helper: each route turns its sanitized output into
// ReviewItems { id, text }, asks the reviewer, then attaches the verdicts back
// to its suggestions by id. Advisory only — a verdict never blocks anything.

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

// Map a loose model-supplied status word onto our small enum. Unknown/garbage
// fails OPEN to "ok" — the reviewer is advisory and must not over-flag on noise.
export function normalizeReviewStatus(raw: unknown): ReviewStatus {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (
    ["reject", "rejected", "wrong", "incorrect", "bad", "error", "remove", "drop", "no"].includes(s)
  ) {
    return "reject";
  }
  if (
    ["warn", "warning", "caution", "risky", "risk", "review", "unsure", "maybe", "verify"].includes(
      s,
    )
  ) {
    return "warn";
  }
  return "ok";
}

// Bound + clean the items before they go into the reviewer prompt. Drops blank
// ids/text, caps text length, dedupes by id, and caps the count.
export function normalizeReviewItems(items: ReadonlyArray<ReviewItem>): ReviewItem[] {
  const seen = new Set<string>();
  const out: ReviewItem[] = [];
  for (const it of items) {
    if (!it) continue;
    const id = typeof it.id === "string" ? it.id.trim() : "";
    const text =
      typeof it.text === "string" ? it.text.trim().slice(0, MAX_REVIEW_ITEM_TEXT_LEN) : "";
    if (!id || !text || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, text });
    if (out.length >= MAX_REVIEW_ITEMS) break;
  }
  return out;
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
  for (const it of normalizeReviewItems(items)) {
    lines.push(`  - id=${it.id}: ${it.text}`);
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

// The reviewer's JSON is untrusted: keep only verdicts whose id is a real item,
// normalize the status, trim/cap the reason, dedupe by id, and bound the count.
// Never throws — returns [] on any malformed shape.
export function sanitizeReviewVerdicts(
  raw: unknown,
  knownIds: ReadonlyArray<string>,
): ReviewVerdict[] {
  const known = new Set(knownIds);
  const arr =
    raw && typeof raw === "object" && Array.isArray((raw as { verdicts?: unknown }).verdicts)
      ? (raw as { verdicts: unknown[] }).verdicts
      : Array.isArray(raw)
        ? (raw as unknown[])
        : [];

  const seen = new Set<string>();
  const out: ReviewVerdict[] = [];
  for (const v of arr) {
    if (!v || typeof v !== "object") continue;
    const id =
      typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id.trim() : "";
    if (!id || !known.has(id) || seen.has(id)) continue;
    const status = normalizeReviewStatus((v as { status?: unknown }).status);
    const reason =
      typeof (v as { reason?: unknown }).reason === "string"
        ? (v as { reason: string }).reason.trim().slice(0, MAX_REVIEW_REASON_LEN)
        : "";
    seen.add(id);
    out.push({ id, status, ...(reason ? { reason } : {}) });
    if (out.length >= MAX_REVIEW_ITEMS) break;
  }
  return out;
}

// Convenience: index verdicts by id for attaching back to suggestions.
export function verdictsById(verdicts: ReadonlyArray<ReviewVerdict>): Map<string, ReviewVerdict> {
  const m = new Map<string, ReviewVerdict>();
  for (const v of verdicts) m.set(v.id, v);
  return m;
}
