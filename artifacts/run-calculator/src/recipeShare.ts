// Print / share a single recipe card — web-only helper.
//
// Formats one recipe (cheese blend, mix, or sauce/frontline) into clean plain
// text for the Web Share API (clipboard fallback) and into a minimal printable
// HTML page opened in a new window. No state, no network.

export type ShareableRecipeRow = { ingredient: string; amount: number };

export type ShareableRecipe = {
  /** Card heading, e.g. "Applicator 1 — Cheese Blend". */
  title: string;
  /** Selected recipe name, when the card has one. */
  name?: string;
  /** Per-row unit label, e.g. "lbs/batch" or "oz/pizza". */
  unit: string;
  rows: ShareableRecipeRow[];
};

function fmtAmount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

export function recipeHeading(r: ShareableRecipe): string {
  const name = (r.name ?? "").trim();
  return name ? `${name} — ${r.title}` : r.title;
}

function cleanRows(r: ShareableRecipe): ShareableRecipeRow[] {
  return r.rows.filter((row) => (row.ingredient ?? "").trim());
}

export function recipeShareText(r: ShareableRecipe): string {
  const rows = cleanRows(r);
  const lines = rows.map(
    (row) => `- ${row.ingredient.trim()}: ${fmtAmount(row.amount)} ${r.unit}`,
  );
  const total = rows.reduce(
    (s, row) => s + (Number.isFinite(row.amount) ? row.amount : 0),
    0,
  );
  return [
    recipeHeading(r),
    "",
    ...(lines.length ? lines : ["(no ingredients yet)"]),
    "",
    `Total: ${fmtAmount(total)} ${r.unit}`,
  ].join("\n");
}

/**
 * Share via the Web Share API when available, otherwise copy the text to the
 * clipboard. Returns what happened so the caller can show a small note.
 */
export async function shareRecipe(
  r: ShareableRecipe,
): Promise<"shared" | "copied" | "failed"> {
  const text = recipeShareText(r);
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: recipeHeading(r), text });
      return "shared";
    } catch (e) {
      // User closed the share sheet — not an error, and don't fall through to
      // silently overwrite their clipboard.
      if (e instanceof DOMException && e.name === "AbortError") return "shared";
      // Otherwise fall through to the clipboard fallback.
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Open a small print-friendly window with the recipe and trigger the print
 * dialog. Returns false when the pop-up was blocked so the caller can tell the
 * user. All recipe content is HTML-escaped.
 */
export function printRecipe(r: ShareableRecipe): boolean {
  const w = window.open("", "_blank", "width=480,height=640");
  if (!w) return false;
  const rows = cleanRows(r);
  const total = rows.reduce(
    (s, row) => s + (Number.isFinite(row.amount) ? row.amount : 0),
    0,
  );
  const rowsHtml = rows.length
    ? rows
        .map(
          (row) =>
            `<tr><td>${escapeHtml(row.ingredient.trim())}</td><td class="num">${escapeHtml(fmtAmount(row.amount))} ${escapeHtml(r.unit)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="2" class="empty">No ingredients yet</td></tr>`;
  const heading = escapeHtml(recipeHeading(r));
  w.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${heading}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.sub { font-size: 12px; color: #555; margin: 0 0 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ddd; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.empty { color: #777; font-style: italic; }
  tfoot td { font-weight: 600; border-top: 2px solid #999; border-bottom: none; }
</style>
</head>
<body>
<h1>${heading}</h1>
<p class="sub">Printed ${escapeHtml(new Date().toLocaleString())}</p>
<table>
  <thead><tr><th>Ingredient</th><th class="num">Amount</th></tr></thead>
  <tbody>${rowsHtml}</tbody>
  <tfoot><tr><td>Total</td><td class="num">${escapeHtml(fmtAmount(total))} ${escapeHtml(r.unit)}</td></tr></tfoot>
</table>
</body>
</html>`);
  w.document.close();
  w.focus();
  w.print();
  return true;
}
