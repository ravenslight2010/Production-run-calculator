// Pure (db-free) logic for the bogus-merge-alias purge heal, split out so it
// can be unit-tested without a database.
//
// Audited 2026-07-19 in production `merge_aliases`: a handful of cheese-tab
// merge memories carry truncated garbage canonical names — "Ald", "Basha",
// "Pinsa" — almost certainly partially-typed merge targets, plus one
// bidirectional pair ("SMD Pepperoni Cheese Mix" ↔ "SMD Pep Cheese Mix")
// left over from the merge that the smd-pep-cheese-mix-restore heal already
// dealt with. None of these canonical names exist as pool rows, so they do no
// visible damage today, but they bias future AI merge suggestions and any
// code trusting merge memory. All rows are category "cheese" with no brand.

export type PurgeableMergeAlias = {
  externalName: string;
  canonicalName: string;
};

// Lower-cased [externalName, canonicalName] pairs audited as bogus. Matched
// case-insensitively, exactly how merge aliases are applied (mergeAliasKey
// lower-cases). The SMD pair is directional: only the row pointing at the
// dead "SMD Pep Cheese Mix" name is poison — the reverse mapping points at
// the real surviving pool row and stays.
export const BOGUS_CHEESE_MERGE_ALIAS_PAIRS: ReadonlyArray<
  readonly [external: string, canonical: string]
> = [
  ["aldo's cheese mix", "ald"],
  ["aldo's standard cheese mix", "ald"],
  ["basha's ultra thin pepperoni cheese mix", "basha"],
  ["basha's ultra thin pepperoni cheese mix 2", "basha"],
  ["lucia's pinsa pesto cheese mix", "pinsa"],
  ["lucia's pinsa spinach mushroom pesto cheese mix", "pinsa"],
  ["smd pepperoni cheese mix", "smd pep cheese mix"],
];

function norm(name: string): string {
  return name.trim().toLowerCase();
}

// True when the alias row matches one of the audited poison pairs AND its
// canonical name still has no backing pool row (case-insensitive) — if a
// manager has since created a recipe with that exact name, the alias has
// become meaningful again and must survive.
export function isBogusMergeAlias(
  alias: PurgeableMergeAlias,
  poolNames: ReadonlySet<string>,
): boolean {
  const ext = norm(alias.externalName);
  const canon = norm(alias.canonicalName);
  if (poolNames.has(canon)) return false;
  return BOGUS_CHEESE_MERGE_ALIAS_PAIRS.some(
    ([e, c]) => e === ext && c === canon,
  );
}

// Builds the case-insensitive pool-name set expected by isBogusMergeAlias.
export function toPoolNameSet(names: ReadonlyArray<string>): Set<string> {
  return new Set(names.map(norm));
}
