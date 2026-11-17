import { cheeseImportId } from "@workspace/cheese-import";
import type { CheeseRecipe } from "@workspace/cheese-recipes";

/**
 * This is a deliberately narrow, immutable approval bundle for the retained
 * 2026-08-26 cheese reconciliation. It is used only when the exact audited
 * workbook is uploaded; ordinary imports remain manager-reviewed as before.
 */
export const CHEESE_RECONCILIATION_2026_08_26 = {
  auditId: "CHEESE-RECONCILIATION-2026-08-26",
  workbookSha256: "21432dc3c0260f578d66989830458f51c19d2524ebf0453efcf7b761e78d9878",
  auditSha256: "2a316d7ee51e6822b1b583e5d5a3f89f4d4fb810cb8c0201f91e55fb1e942c55",
  comparisonSha256: "60acb840e373ec59c9d346e48a3b5a4ffd639bfabe8b61db7679b81cb2e69db9",
  snapshotSha256: "4bff312e8176dc5333a2a5982798ea9f9bb951bb50409bb9affbd89c3407e9b6",
  sourceManifestSha256: "c4241480ebf3ccda8a03ce3565fea78f68063f2531a9d20902619a8e3140cf8f",
} as const;

export type AuditedCheeseLink = {
  brand: string;
  sourceName: string;
  sourceId: string;
  targetId: string;
  targetName: string;
  sourceFormulaFingerprint: string;
};

export type AuditedCheeseApproval = {
  auditId: string;
  evidence: Omit<typeof CHEESE_RECONCILIATION_2026_08_26, "auditId" | "workbookSha256">;
  approvedLinks: AuditedCheeseLink[];
  held: { sourceId: string; sourceName: string; brand: string; reason: string };
};

const rows = `
Basha's Original	Whole Mozzarella Cheese Mix	cheese:basha-s-original:whole-mozzarella-cheese-mix	Basha's Original Whole Mozzarella Cheese Mix
Basha's Ultra Thin	Five Cheese Spice Blend	cheese:basha-s-ultra-thin:five-cheese-spice-blend	Basha's Ultra Thin Five Cheese Spice Blend
Basha's Ultra Thin	Whole Mozzarella Cheese Mix	cheese:basha-s-ultra-thin:whole-mozzarella-cheese-mix	Basha's Ultra Thin Whole Mozzarella Cheese Mix
Corner Booth	Monterey Jack Cheese Mix	cheese:corner-booth:monterey-jack-cheese-mix	Corner Booth Monterey Jack Cheese Mix
Corner Booth	Corner BBQ Chicken Cheese Mix	cheese:corner-booth:corner-bbq-chicken-cheese-mix	Corner Booth BBQ Chicken Cheese Mix
Corner Booth	Whole Mozzarella Cheese Mix	cheese:corner-booth:whole-mozzarella-cheese-mix	Corner Booth Whole Mozzarella Cheese Mix
FSD 7"	Lucia's Americano Cheese Mix	cheese:fsd-7:lucia-s-americano-cheese-mix	FSD 7" Breakfast Cheese Mix
Four Hands	4Hands Seven Cheese Mix	cheese:four-hands:4hands-seven-cheese-mix	Four Hands Seven Cheese Mix
Four Hands	4Hands Pizella Cheese	cheese:four-hands:4hands-pizella-cheese	Four Hands Pizella Cheese
Four Hands	4Hands Chicken Bacon Club Cheese Mix	cheese:four-hands:4hands-chicken-bacon-club-cheese-mix	Four Hands Chicken Bacon Club Cheese Mix
Four Hands	Cheeseburger Cheese Mix	cheese:four-hands:cheeseburger-cheese-mix	Four Hands Cheeseburger Cheese Mix
Four Hands	4Hands Meat Cheese Mix	cheese:four-hands:4hands-meat-cheese-mix	Four Hands Meat Cheese Mix
Four Hands	4Hands Sugarfire Chicken Cheese Mix	cheese:four-hands:4hands-sugarfire-chicken-cheese-mix	Four Hands Sugarfire Chicken Cheese Mix
Four Hands	Gyro Cheese Mix	cheese:four-hands:gyro-cheese-mix	Four Hands Gyro Cheese Mix
Four Hands	Red Hot Cheese Mix	cheese:four-hands:red-hot-cheese-mix	Four Hands Red Hot Cheese Mix
Four Hands	Whole Mozzarella Cheese Mix	cheese:four-hands:whole-mozzarella-cheese-mix	Four Hands Whole Mozzarella Cheese Mix
Hannaford	Hannaford's Chicken Bacon Club Cheese Mix	cheese:hannaford:hannaford-s-chicken-bacon-club-cheese-mix	Hannaford Chicken Bacon Club Cheese Mix
Hannaford	Monterey Jack Cheese Mix	cheese:hannaford:monterey-jack-cheese-mix	Hannaford Monterey Jack Cheese Mix
Hannaford	4 Cheese with Sweet & Spicy Chili Sauce	cheese:spec:hannaford-s-spicy-4cheese-mix	Hannaford Spicy 4Cheese Mix
Hannaford	Lowes/Hannaford Five Cheese Mix	cheese:hannaford:lowes-hannaford-five-cheese-mix	Hannaford Five Cheese Mix
Hannaford	Five Cheese Spice Blend	cheese:hannaford:five-cheese-spice-blend	Hannaford Five Cheese Spice Blend
Hannaford	Skim Mozzarella Cheese Mix	cheese:hannaford:skim-mozzarella-cheese-mix	Hannaford Skim Mozzarella Cheese Mix
Hannaford	Spinach Goat Cheese Mix	cheese:hannaford:spinach-goat-cheese-mix	Hannaford Spinach Goat Cheese Mix
Lowe	Five Cheese Spice Blend	cheese:lowe:five-cheese-spice-blend	Lowe's Five Cheese Spice Blend
Lowe	Red Hot Cheese Mix	cheese:lowe:red-hot-cheese-mix	Lowe's Red Hot Cheese Mix
Lowe	Lowes/Hannaford Five Cheese Mix	cheese:lowe:lowes-hannaford-five-cheese-mix	Lowe's Five Cheese Mix
Lowe	Monterey Jack Cheese Mix	cheese:lowe:monterey-jack-cheese-mix	Lowe's Monterey Jack Cheese Mix
Lowe	Cheeseburger Cheese Mix	cheese:lowe:cheeseburger-cheese-mix	Lowe's Cheeseburger Cheese Mix
Lowe	Skim Mozzarella Cheese Mix	cheese:lowe:skim-mozzarella-cheese-mix	Lowe's Skim Mozzarella Cheese Mix
Lowe	Lucia's Caribbean Cheese Mix	cheese:lowe:lucia-s-caribbean-cheese-mix	Lowe's Caribbean Cheese Mix
Lowe's 7"	Five Cheese Spice Blend	cheese:lowe-s-7:five-cheese-spice-blend	Lowe's 7" Five Cheese Spice Blend
Lucia Improved	Lucia's Monterey Jack Cheese Mix	cheese:lucia-improved:lucia-s-monterey-jack-cheese-mix	Lucia's New & Improved Monterey Jack Cheese Mix
Lucia Improved	Lucia's 6 Cheese Mix	cheese:lucia-improved:lucia-s-6-cheese-mix	Lucia's New & Improved 6 Cheese Mix
Lucia Improved	Lucia's Standard Cheese Mix	cheese:lucia-improved:lucia-s-standard-cheese-mix	Lucia's New & Improved Standard Cheese Mix
Lucia Improved	Lucia's Pepperoni Cheese Mix	cheese:lucia-improved:lucia-s-pepperoni-cheese-mix	Lucia's New & Improved Pepperoni Cheese Mix
Lucia Improved	Lucia's Cheeseburger Cheese Mix	cheese:lucia-improved:lucia-s-cheeseburger-cheese-mix	Lucia's New & Improved Cheeseburger Cheese Mix
Lucia Craft	Lucia's Club Cheese Mix	cheese:lucia-craft:lucia-s-club-cheese-mix	Lucia's Craft Club Cheese Mix
Lucia Craft	Lucia's Spinach Cheese Mix	cheese:lucia-craft:lucia-s-spinach-cheese-mix	Lucia's Craft Spinach Cheese Mix
Lucia Craft	Red Hot Cheese Mix	cheese:spec:lucia-s-craft-red-hot-cheese-mix	Lucia's Craft Red Hot Cheese Mix
Lucia Craft	Lucia's Craft Cheese Mix	cheese:lucia-s-craft:lucia-s-craft-cheese-mix	Lucia's Crft Bratwurst Cheese Mix
Lucia Craft	Lucia's Cheeseburger Cheese Mix	cheese:lucia-craft:lucia-s-cheeseburger-cheese-mix	Lucia's Craft Cheeseburger Cheese Mix
Lucia Craft	Lucia's Caribbean Cheese Mix	cheese:lucia-craft:lucia-s-caribbean-cheese-mix	Lucia's Craft Caribbean Cheese Mix
Lucia Craft	Whole Mozzarella Cheese Mix	cheese:lucia-craft-new:whole-mozzarella-cheese-mix	Lucia's Craft Whole Mozzarella Cheese Mix
Lucia Morning Melts	Lucia's Americano Cheese Mix	cheese:lucia-morning-melts:lucia-s-americano-cheese-mix	Lucia's Morning Melts Americano Cheese Mix
Lucia Morning Melts	Lucia's Italiano Cheese Mix	cheese:lucia-morning-melts:lucia-s-italiano-cheese-mix	Lucia's Morning Melts Italiano Cheese Mix
Lucia Morning Melts	Lucia's Mexicano Cheese Mix	cheese:lucia-morning-melts:lucia-s-mexicano-cheese-mix	Lucia's Morning Melts Mexicano Cheese Mix
Lucia Morning Melts	Lucia's Parisian Cheese Mix	cheese:lucia-morning-melts:lucia-s-parisian-cheese-mix	Lucia's Morning Melts Parisian Cheese Mix
Lucia's Pinsa (Proof)	Whole Mozzarella Cheese Mix	cheese:lucia-s-pinsa-proof:whole-mozzarella-cheese-mix	Lucia's Pinsa Whole Mozzarella Cheese Mix
Mauro	Mozzarella Cheese Mix	cheese:mauro:mozzarella-cheese-mix	Mauro Mozzarella Cheese Mix
Mystic	Mozzarella Cheese Mix	cheese:mystic:mozzarella-cheese-mix	Mystic Mozzarella Cheese Mix
Medulla 12x16	Mozzarella Cheese Mix	cheese:medulla-12x16:mozzarella-cheese-mix	Medulla 12x16 Mozzarella Cheese Mix
Nob Hill Craft	Monterey Jack Cheese Mix	cheese:nob-hill-craft:monterey-jack-cheese-mix	Nob Hill Craft Monterey Jack Cheese Mix
Price Chopper	Monterey Jack Cheese Mix	cheese:price-chopper:monterey-jack-cheese-mix	Price Chopper Monterey Jack Cheese Mix
Price Chopper	Skim Mozzarella Cheese Mix	cheese:price-chopper:skim-mozzarella-cheese-mix	Price Chopper Skim Mozzarella Cheese Mix
SMD	Mozzarella Cheese Mix	cheese:smd:mozzarella-cheese-mix	SMD Mozzarella Cheese Mix
SMD	SMD Supreme Cheese Mix (same as Lowe's Grilled Veggie Cheese Mix)	cheese:spec:show-me-dough-smd-supreme-cheese-mix-same-as-lowe-s-grilled-veggie-cheese-mix	SMD Supreme Cheese Mix
Vita	Mozzarella Cheese Mix	cheese:vita:mozzarella-cheese-mix	Vita Mozzarella Cheese Mix
Vocelli's	Whole Mozzarella Cheese Mix	cheese:vocelli-s:whole-mozzarella-cheese-mix	Vocelli's Whole Mozzarella Cheese Mix
`.trim();

function formulaFingerprint(recipe: Pick<CheeseRecipe, "components">): string {
  const components = (recipe.components ?? [])
    .filter((component) => Number(component.lbs) > 0)
    .map((component) => `${component.ingredient.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ")}:${Number(component.lbs)}`)
    .sort()
    .join("|");
  let hash = 0x811c9dc5;
  for (let i = 0; i < components.length; i++) {
    hash ^= components.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const retainedTargetFormulaFingerprints = `
cheese:basha-s-original:whole-mozzarella-cheese-mix	2c0fc55b
cheese:basha-s-ultra-thin:five-cheese-spice-blend	bb8c2465
cheese:basha-s-ultra-thin:whole-mozzarella-cheese-mix	2c0fc55b
cheese:corner-booth:monterey-jack-cheese-mix	00b54f94
cheese:corner-booth:corner-bbq-chicken-cheese-mix	695db428
cheese:corner-booth:whole-mozzarella-cheese-mix	a8344b3a
cheese:fsd-7:lucia-s-americano-cheese-mix	a48a24eb
cheese:four-hands:4hands-seven-cheese-mix	e20aaf8e
cheese:four-hands:4hands-pizella-cheese	2d2f6860
cheese:four-hands:4hands-chicken-bacon-club-cheese-mix	3bfb19ff
cheese:four-hands:cheeseburger-cheese-mix	a303ab13
cheese:four-hands:4hands-meat-cheese-mix	05832a73
cheese:four-hands:4hands-sugarfire-chicken-cheese-mix	b44773b9
cheese:four-hands:gyro-cheese-mix	6c4d7d64
cheese:four-hands:red-hot-cheese-mix	9ec90194
cheese:four-hands:whole-mozzarella-cheese-mix	a8344b3a
cheese:hannaford:hannaford-s-chicken-bacon-club-cheese-mix	d9a9d267
cheese:hannaford:monterey-jack-cheese-mix	00b54f94
cheese:spec:hannaford-s-spicy-4cheese-mix	180a8a2c
cheese:hannaford:lowes-hannaford-five-cheese-mix	56c42ecb
cheese:hannaford:five-cheese-spice-blend	bb8c2465
cheese:hannaford:skim-mozzarella-cheese-mix	bfee89e9
cheese:hannaford:spinach-goat-cheese-mix	f7e1ceb1
cheese:lowe:five-cheese-spice-blend	bb8c2465
cheese:lowe:red-hot-cheese-mix	9ec90194
cheese:lowe:lowes-hannaford-five-cheese-mix	56c42ecb
cheese:lowe:monterey-jack-cheese-mix	00b54f94
cheese:lowe:cheeseburger-cheese-mix	a303ab13
cheese:lowe:skim-mozzarella-cheese-mix	bfee89e9
cheese:lowe:lucia-s-caribbean-cheese-mix	abb92e2d
cheese:lowe-s-7:five-cheese-spice-blend	bb8c2465
cheese:lucia-improved:lucia-s-monterey-jack-cheese-mix	01b55127
cheese:lucia-improved:lucia-s-6-cheese-mix	5102734a
cheese:lucia-improved:lucia-s-standard-cheese-mix	07a50f96
cheese:lucia-improved:lucia-s-pepperoni-cheese-mix	274f3bfa
cheese:lucia-improved:lucia-s-cheeseburger-cheese-mix	a303ab13
cheese:lucia-craft:lucia-s-club-cheese-mix	a75b9402
cheese:lucia-craft:lucia-s-spinach-cheese-mix	076ee8b4
cheese:spec:lucia-s-craft-red-hot-cheese-mix	9ec90194
cheese:lucia-s-craft:lucia-s-craft-cheese-mix	50e6709c
cheese:lucia-craft:lucia-s-cheeseburger-cheese-mix	a303ab13
cheese:lucia-craft:lucia-s-caribbean-cheese-mix	abb92e2d
cheese:lucia-craft-new:whole-mozzarella-cheese-mix	a8344b3a
cheese:lucia-morning-melts:lucia-s-americano-cheese-mix	a48a24eb
cheese:lucia-morning-melts:lucia-s-italiano-cheese-mix	13318f14
cheese:lucia-morning-melts:lucia-s-mexicano-cheese-mix	f286ed7c
cheese:lucia-morning-melts:lucia-s-parisian-cheese-mix	9016fb84
cheese:lucia-s-pinsa-proof:whole-mozzarella-cheese-mix	a8344b3a
cheese:mauro:mozzarella-cheese-mix	2c0fc55b
cheese:mystic:mozzarella-cheese-mix	a8344b3a
cheese:medulla-12x16:mozzarella-cheese-mix	58ae0f74
cheese:nob-hill-craft:monterey-jack-cheese-mix	ffb54e01
cheese:price-chopper:monterey-jack-cheese-mix	00b54f94
cheese:price-chopper:skim-mozzarella-cheese-mix	bfee89e9
cheese:smd:mozzarella-cheese-mix	2c0fc55b
cheese:spec:show-me-dough-smd-supreme-cheese-mix-same-as-lowe-s-grilled-veggie-cheese-mix	11aa3ee2
cheese:vita:mozzarella-cheese-mix	817984d5
cheese:vocelli-s:whole-mozzarella-cheese-mix	a8344b3a
`.trim();

const retainedTargetFormulaById = new Map(
  retainedTargetFormulaFingerprints.split("\n").map((row) => row.split("\t") as [string, string]),
);

export const auditedCheeseLinks: AuditedCheeseLink[] = rows.split("\n").map((row) => {
  const [brand, sourceName, targetId, targetName] = row.split("\t");
  return {
    brand,
    sourceName,
    sourceId: cheeseImportId(brand, sourceName),
    targetId,
    targetName,
    sourceFormulaFingerprint: "",
  };
});

const held = {
  brand: "Price Chopper",
  sourceName: "Hannaford's Chicken Bacon Club Cheese Mix",
  sourceId: cheeseImportId("Price Chopper", "Hannaford's Chicken Bacon Club Cheese Mix"),
  reason: "Held: source formula is 16 + 16 Part Skim; the live candidate is 20 + 20 Skim.",
};

export function auditedCheeseApprovalFor(
  workbookHashes: ReadonlyArray<string>,
  recipes: ReadonlyArray<CheeseRecipe>,
  existing: ReadonlyArray<CheeseRecipe>,
): AuditedCheeseApproval | null {
  if (workbookHashes.length !== 1 || workbookHashes[0] !== CHEESE_RECONCILIATION_2026_08_26.workbookSha256) return null;
  const sourceIds = new Set(recipes.map((recipe) => recipe.id));
  const targetsById = new Map(existing.map((recipe) => [recipe.id, recipe]));
  const missingSource = auditedCheeseLinks.find((link) => !sourceIds.has(link.sourceId));
  const missingTarget = auditedCheeseLinks.find((link) => !targetsById.has(link.targetId));
  const changedTarget = auditedCheeseLinks.find((link) => {
    const target = targetsById.get(link.targetId);
    return !target || formulaFingerprint(target) !== retainedTargetFormulaById.get(link.targetId);
  });
  if (missingSource || missingTarget || changedTarget || !sourceIds.has(held.sourceId)) return null;
  return {
    auditId: CHEESE_RECONCILIATION_2026_08_26.auditId,
    evidence: {
      auditSha256: CHEESE_RECONCILIATION_2026_08_26.auditSha256,
      comparisonSha256: CHEESE_RECONCILIATION_2026_08_26.comparisonSha256,
      snapshotSha256: CHEESE_RECONCILIATION_2026_08_26.snapshotSha256,
      sourceManifestSha256: CHEESE_RECONCILIATION_2026_08_26.sourceManifestSha256,
    },
    approvedLinks: auditedCheeseLinks.map((link) => ({
      ...link,
      sourceFormulaFingerprint: formulaFingerprint(recipes.find((recipe) => recipe.id === link.sourceId)!),
    })),
    held,
  };
}

export function isAuditedCheeseWorkbook(workbookHashes: ReadonlyArray<string>): boolean {
  return workbookHashes.length === 1 && workbookHashes[0] === CHEESE_RECONCILIATION_2026_08_26.workbookSha256;
}

/** The approved bundle is all-or-nothing: it never authorizes a partial or expanded write. */
export function matchesAuditedCheeseCommit(
  approval: AuditedCheeseApproval,
  recipes: ReadonlyArray<CheeseRecipe>,
  removals: ReadonlyArray<string>,
): boolean {
  const expected = new Set(approval.approvedLinks.map((link) => link.targetId));
  const received = new Set(recipes.map((recipe) => recipe.id));
  return removals.length === 0
    && received.size === expected.size
    && [...expected].every((id) => received.has(id))
    && recipes.every((recipe) =>
      formulaFingerprint(recipe) === approval.approvedLinks.find((link) => link.targetId === recipe.id)?.sourceFormulaFingerprint,
    );
}