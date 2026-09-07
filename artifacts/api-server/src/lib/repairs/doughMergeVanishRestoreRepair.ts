import { and, eq, gte } from "drizzle-orm";
import { dailySyncTable, doughRecipesTable } from "@workspace/db";
import type { RepairDefinition, RepairTransaction } from "../repairRegistry";

export const DOUGH_MERGE_VANISH_RESTORE_REPAIR_ID = "dough-merge-vanish-restore-v1";
const DOUGH_MERGE_VANISH_FROM_DATE = "2026-07-18";

const LOST_LOWES_FRENCH_FRY_NAMES = new Set([
  "lowe's french fry recipe",
  "lowe's heavy french fry dough",
]);
const RESTORED_LOWES_FRENCH_FRY = {
  id: "dough:lowe-s-french-fry-dough-restored",
  name: "Lowe's French Fry Dough",
  notes: "",
  components: [
    { ingredient: "ADM WHEAT FLOUR", lbs: 200 },
    { ingredient: "WATER", lbs: 101.5 },
    { ingredient: "25029 FRENCH FRIES", lbs: 18 },
    { ingredient: "SUNFLOWER OIL", lbs: 12 },
    { ingredient: "HONEY", lbs: 9 },
    { ingredient: "FRESH COMPRESSED YEAST", lbs: 3 },
    { ingredient: "LION'S CHOICE SEASONING", lbs: 2 },
    { ingredient: "SALT", lbs: 1 },
  ],
  enabled: true,
  brand: "Lowe's",
  flavors: [] as string[],
  doughballWeightOz: 15,
  doughballsPerTray: 15,
  doughballVariants: [] as { label: string; weightOz?: number; perTray?: number }[],
};

export const doughMergeVanishRestoreRepair: RepairDefinition<RepairTransaction> = Object.freeze({
  id: DOUGH_MERGE_VANISH_RESTORE_REPAIR_ID,
  owner: "recipe-normalization",
  dependencies: Object.freeze(["dough-variant-suffix-dedupe-v1"]),
  eligibility: "Live dough pools without a Lowe's french-fry dough row; only current and future day run values referencing either released tombstoned name are repointed.",
  mode: "automatic",
  executionMode: "runner-transactional",
  resultOwnership: "runner-marker",
  managerAllowed: false,
  safety: Object.freeze({
    affectedScope: "The live Lowe's French Fry dough pool row and daily-sync rows dated 2026-07-18 or later that reference the two deleted names.",
    excludedScope: "Existing Lowe's french-fry dough rows, all other pool rows and run values, and historical daily-sync rows.",
    rollback: "The marker retains restoration and repoint counts; reversal requires a reviewed follow-up repair.",
    evidence: "Saved spec-sheet parse ids 140/176 and the two released tombstoned Lowe's French Fry names.",
  }),
  async execute(tx) {
    // 1) Restore the pool row (live scope) unless a Lowe's french-fry dough
    // already exists again — never mint a near-duplicate next to a re-import.
    const pool = await tx
      .select({ name: doughRecipesTable.name })
      .from(doughRecipesTable)
      .where(eq(doughRecipesTable.scope, "live"))
      .for("update");
    const existing = pool.find((r) => {
      const n = r.name.trim().toLowerCase();
      return n.includes("lowe") && n.includes("french fry");
    });
    // Run values are re-pointed at whatever row actually exists after this
    // heal: the pre-existing re-imported row if there is one, otherwise the
    // restored row — never a name with no pool row behind it.
    const repointTo = existing ? existing.name : RESTORED_LOWES_FRENCH_FRY.name;
    let restored = 0;
    if (!existing) {
      const inserted = await tx
        .insert(doughRecipesTable)
        .values({
          id: RESTORED_LOWES_FRENCH_FRY.id,
          scope: "live",
          name: RESTORED_LOWES_FRENCH_FRY.name,
          notes: RESTORED_LOWES_FRENCH_FRY.notes,
          components: RESTORED_LOWES_FRENCH_FRY.components,
          enabled: RESTORED_LOWES_FRENCH_FRY.enabled,
          brand: RESTORED_LOWES_FRENCH_FRY.brand,
          flavors: RESTORED_LOWES_FRENCH_FRY.flavors,
          doughballWeightOz: RESTORED_LOWES_FRENCH_FRY.doughballWeightOz,
          doughballsPerTray: RESTORED_LOWES_FRENCH_FRY.doughballsPerTray,
          doughballVariants: RESTORED_LOWES_FRENCH_FRY.doughballVariants,
          updatedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: doughRecipesTable.id });
      restored = inserted.length;
    }

    // 2) Re-point today-and-future day-state run values still referencing the
    // deleted names (the merged-away names stay tombstoned — references must
    // move to the restored name or the runs show a dough that no longer
    // exists). Past days are history and untouched.
    const days = await tx
      .select()
      .from(dailySyncTable)
      .where(gte(dailySyncTable.date, DOUGH_MERGE_VANISH_FROM_DATE))
      .for("update");
    let repointedDays = 0;
    for (const day of days) {
      const data = day.data as Record<string, unknown> | null;
      const runValues = data?.runValues as
        | Record<string, Record<string, unknown>>
        | undefined;
      if (!runValues || typeof runValues !== "object") continue;
      let changed = false;
      for (const vals of Object.values(runValues)) {
        if (!vals || typeof vals !== "object") continue;
        const dough = String(vals.doughRecipeName ?? "").trim();
        if (dough && LOST_LOWES_FRENCH_FRY_NAMES.has(dough.toLowerCase())) {
          vals.doughRecipeName = repointTo;
          changed = true;
        }
      }
      if (!changed) continue;
      await tx
        .update(dailySyncTable)
        .set({ data: { ...data }, updatedAt: new Date() })
        .where(
          and(
            eq(dailySyncTable.date, day.date),
            eq(dailySyncTable.scope, day.scope),
          ),
        );
      repointedDays++;
    }

    return { restored, repointTo, repointedDays };
  },
});