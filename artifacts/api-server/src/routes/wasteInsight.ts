import { WasteInsightBody } from "@workspace/api-zod";
import * as z from "zod";

// Cap how much production context the request can carry and how much the model
// can return, matching the other AI endpoint guards.
export const MAX_PLANNED_ITEMS = 1000;
export const MAX_FLAGGED_IN_PROMPT = 100;
export const MAX_SUGGESTION_CHARS = 1200;
export const MAX_NOTE_CHARS = 400;

export type WasteStatus = "expired" | "soon";

export type WasteFlaggedItem = {
  key: string;
  name: string;
  category: string;
  unit: string;
  status: WasteStatus;
  qtyAtRisk: number;
  earliestExpiration: string | null;
  daysUntilExpiry: number | null;
};

// Minimal shape of an inventory item the flagging logic needs. The real DB rows
// carry more, but keeping this narrow lets the pure function be unit-tested
// without a database.
export type FlaggableLot = {
  qtyRemaining: number;
  expirationDate: string | null;
};
export type FlaggableItem = {
  key: string;
  name: string;
  category: string;
  unit: string;
  lots: FlaggableLot[];
};

// Whole-day difference between an expiration date (YYYY-MM-DD) and `now`,
// measured in local calendar days. Negative once expired. Returns null when the
// date is missing or unparseable.
export function daysUntilExpiry(dateStr: string | null, now: Date): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

// Pure: from the current inventory, flag items that have stock in lots which are
// already expired or expiring within `soonDays`. Aggregates the at-risk quantity
// per item and surfaces the earliest at-risk expiration. Items with no remaining
// at-risk stock are skipped. Result is sorted most-urgent first (expired before
// expiring-soon, then by soonest expiry).
export function flagExpiringItems(
  items: ReadonlyArray<FlaggableItem>,
  soonDays: number,
  now: Date = new Date(),
): WasteFlaggedItem[] {
  const out: WasteFlaggedItem[] = [];
  for (const item of items) {
    let qtyAtRisk = 0;
    let earliestDays: number | null = null;
    let earliestDate: string | null = null;
    let anyExpired = false;
    for (const lot of item.lots ?? []) {
      if (!(lot.qtyRemaining > 0)) continue;
      const days = daysUntilExpiry(lot.expirationDate, now);
      if (days == null) continue;
      const isExpired = days < 0;
      const isSoon = days >= 0 && days <= soonDays;
      if (!isExpired && !isSoon) continue;
      qtyAtRisk += lot.qtyRemaining;
      if (isExpired) anyExpired = true;
      if (earliestDays == null || days < earliestDays) {
        earliestDays = days;
        earliestDate = lot.expirationDate;
      }
    }
    if (qtyAtRisk <= 0 || earliestDays == null) continue;
    out.push({
      key: item.key,
      name: item.name,
      category: item.category,
      unit: item.unit,
      status: anyExpired ? "expired" : "soon",
      qtyAtRisk,
      earliestExpiration: earliestDate,
      daysUntilExpiry: earliestDays,
    });
  }
  out.sort((a, b) => {
    const da = a.daysUntilExpiry ?? Number.POSITIVE_INFINITY;
    const dbb = b.daysUntilExpiry ?? Number.POSITIVE_INFINITY;
    return da - dbb;
  });
  return out;
}

export type WasteInsightInput = z.infer<typeof WasteInsightBody>;

export type WasteValidationResult =
  | { ok: true; data: WasteInsightInput }
  | { ok: false; status: number; error: string };

// Validate and bound-check the request body for POST /inventory/waste-insight.
export function validateWasteInsightBody(body: unknown): WasteValidationResult {
  const parsed = WasteInsightBody.safeParse(body ?? {});
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message };
  }
  const planned = parsed.data.plannedItems;
  if (planned && planned.length > MAX_PLANNED_ITEMS) {
    return {
      ok: false,
      status: 400,
      error: `Too many planned items (max ${MAX_PLANNED_ITEMS})`,
    };
  }
  return { ok: true, data: parsed.data };
}

// Shape the flagged stock + (optional) planned production into a compact prompt
// asking for a plain-language run-order suggestion to consume at-risk stock
// first. Never invents data; advisory only.
export function buildWastePrompt(
  flagged: ReadonlyArray<WasteFlaggedItem>,
  plannedItems: ReadonlyArray<{ key: string; name: string; unit: string; category: string }> = [],
): { system: string; user: string } {
  const system =
    "You are an inventory-waste advisor for a frozen-pizza production facility. " +
    "You are given the ingredients/packaging that are expired or expiring soon, and " +
    "(when available) the items the upcoming production plan would consume. Suggest a " +
    "concrete run-order strategy that consumes the at-risk stock first to minimize waste — " +
    "e.g. which products/runs to prioritize because they use the soon-to-expire items. " +
    "Be specific and quantitative when the data supports it, and keep it short and actionable. " +
    "NEVER invent data. If there is nothing meaningful to suggest, say so plainly. " +
    "This is advisory only — you do not change any schedule or inventory.";

  const lines: string[] = [];
  lines.push("AT-RISK STOCK (expired or expiring soon):");
  if (flagged.length === 0) {
    lines.push("(none)");
  } else {
    for (const f of flagged.slice(0, MAX_FLAGGED_IN_PROMPT)) {
      const when =
        f.daysUntilExpiry == null
          ? "no date"
          : f.daysUntilExpiry < 0
            ? `expired ${Math.abs(f.daysUntilExpiry)}d ago`
            : `expires in ${f.daysUntilExpiry}d`;
      lines.push(
        `- ${f.name} [${f.category}] — ${f.qtyAtRisk} ${f.unit} at risk, ${when}` +
          (f.earliestExpiration ? ` (${f.earliestExpiration})` : ""),
      );
    }
  }

  if (plannedItems.length > 0) {
    lines.push("");
    lines.push("ITEMS THE UPCOMING PLAN WOULD CONSUME:");
    for (const p of plannedItems.slice(0, MAX_FLAGGED_IN_PROMPT)) {
      lines.push(`- ${p.name} [${p.category}] (${p.unit})`);
    }
  }

  lines.push("");
  lines.push(
    "Return ONLY JSON of the exact shape: " +
      '{"suggestion":string,"note":string}. ' +
      'Put your plain-language run-order recommendation in "suggestion". ' +
      'If there is nothing useful to suggest, set "suggestion" to a brief honest line ' +
      'and put any caveat in "note". Otherwise leave "note" empty.',
  );

  return { system, user: lines.join("\n") };
}

function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

const SuggestionSchema = z.object({
  suggestion: z.coerce.string().optional(),
  note: z.coerce.string().optional(),
});

// The model returns JSON but isn't trustworthy. Parse leniently: prefer a
// well-formed {suggestion, note}; if parsing fails entirely, fall back to using
// the raw content as the suggestion so a stray formatting slip never drops a
// real reply.
export function sanitizeWasteSuggestion(content: string): {
  suggestion: string;
  note?: string;
} {
  const rawText = (content ?? "").trim();
  if (!rawText) return { suggestion: "" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { suggestion: clamp(rawText, MAX_SUGGESTION_CHARS) };
  }

  const result = SuggestionSchema.safeParse(parsed);
  if (!result.success) {
    return { suggestion: clamp(rawText, MAX_SUGGESTION_CHARS) };
  }
  const suggestion = clamp(result.data.suggestion ?? "", MAX_SUGGESTION_CHARS);
  const note = clamp(result.data.note ?? "", MAX_NOTE_CHARS);
  if (!suggestion && !note) return { suggestion: clamp(rawText, MAX_SUGGESTION_CHARS) };
  return note ? { suggestion, note } : { suggestion };
}
