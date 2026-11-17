// Drifted customer (brand) tags on server recipe pools — pure helpers for the
// one-time "brand-drift-rename-v1" heal (db-free so they can be unit tested).
//
// A production audit found several pool rows whose stored `brand` spells the
// customer differently than the saved product profiles do, so those recipes
// don't group under the customer in Manage Lists and brand-scoped import
// linking can miss them. The heal applies the existing customer-rename
// semantics: rewrite the drifted tags to the canonical profile spelling AND
// learn context-free `kind:"brand"` spec-import aliases (with chain re-point)
// so re-importing the old workbooks lands on the canonical customer instead of
// resurrecting the drifted spelling. Tags are never blanked or deleted —
// emptying a cheese recipe's flavors list would flip it to the "All Varieties"
// catch-all.

/** Audited drifted spelling → canonical customer name (from brand profiles). */
export const BRAND_DRIFT_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ["Basha's Ultra Thin", "Basha's Ultra Thin Crust"],
  ["Lucia's Morning Melts", "Lucia's Morning Melts 7in"],
  ['FSD 7"', "FSD 7in"],
  ["Aldo", "Aldo's"],
];

const driftMap = new Map<string, string>(
  BRAND_DRIFT_RENAMES.map(([from, to]) => [from.trim().toLowerCase(), to]),
);

/**
 * Canonical customer name for a stored brand tag, or null when the tag is not
 * one of the audited drifted spellings (exact case-insensitive match on the
 * trimmed tag — prefixes like "Basha's Ultra Thin Crust" itself never match).
 */
export function brandDriftTargetFor(brand: string): string | null {
  const key = brand.trim().toLowerCase();
  if (!key) return null;
  const target = driftMap.get(key);
  if (!target) return null;
  // Already the canonical spelling (identical including case): nothing to do.
  if (brand.trim() === target) return null;
  return target;
}

export type AliasLike = {
  kind: string;
  externalName: string;
  canonicalName: string;
  context: string | null;
};

export type AliasRepoint<T extends AliasLike> =
  | { action: "update"; row: T; set: Partial<AliasLike> }
  | { action: "delete"; row: T };

/**
 * Chain re-point for existing spec-import aliases after a brand rename
 * (mirrors the web `buildBrandRenameAliases` semantics, expressed as row
 * mutations for the heal):
 * - brand aliases whose CANONICAL is the drifted name re-point to the target
 *   (deleted instead when that would self-alias);
 * - flavor aliases whose CONTEXT (canonical brand) is the drifted name are
 *   re-contexted to the target so they still fire after the brand
 *   canonicalizes first on the next import.
 * Pure; returns only the rows that need changing.
 */
export function planBrandAliasRepoints<T extends AliasLike>(
  aliases: ReadonlyArray<T>,
  from: string,
  to: string,
): AliasRepoint<T>[] {
  const fromLc = from.trim().toLowerCase();
  const toTrim = to.trim();
  const toLc = toTrim.toLowerCase();
  if (!fromLc || !toLc || fromLc === toLc) return [];
  const out: AliasRepoint<T>[] = [];
  for (const a of aliases) {
    if (a.kind === "brand") {
      if ((a.canonicalName ?? "").trim().toLowerCase() !== fromLc) continue;
      const extLc = (a.externalName ?? "").trim().toLowerCase();
      if (!extLc || extLc === toLc) {
        // Re-pointing would restate the same name — drop the row instead.
        out.push({ action: "delete", row: a });
      } else {
        out.push({ action: "update", row: a, set: { canonicalName: toTrim, context: null } });
      }
      continue;
    }
    if (a.kind === "flavor") {
      if ((a.context ?? "").trim().toLowerCase() !== fromLc) continue;
      out.push({ action: "update", row: a, set: { context: toTrim } });
    }
  }
  return out;
}
