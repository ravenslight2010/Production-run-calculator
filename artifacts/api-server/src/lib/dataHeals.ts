import { and, eq, gte, sql } from "drizzle-orm";
import {
  db,
  dataHealsTable,
  dailySyncTable,
  specImportAliasesTable,
  aiCorrectionsTable,
  importAliasesTable,
  cheeseRecipesTable,
  mergeAliasesTable,
  mixesTable,
  doughRecipesTable,
  sauceRecipesTable,
  brandProfilesTable,
  savedSpecSheetsTable,
} from "@workspace/db";
import { logger } from "./logger";
import {
  sanitizeSpecAliases,
  isGenericSlotTypeName,
  cleanSpecNamedRecipeName,
  specImportNamedRecipeNamesEqual,
  stripPurchasedCrustDie,
  type SpecImportAlias as SpecAliasEntry,
} from "@workspace/spec-import";
import {
  normalizeDoughballVariants,
  collapseDoughballVariantSuffixDuplicates,
} from "@workspace/named-recipes";
import {
  backfillCheeseSharePcts,
  stripInconsistentCheeseOz,
  normalizeCheeseRecipe,
} from "@workspace/cheese-recipes";
import {
  POISONED_CHEESE_ALIAS_PAIRS,
  POISONED_FLAVOR_PAIR,
  POISONED_FLAVOR_BRAND_CONTEXT,
  healCheesePicksInPayload,
} from "./cheesePickHeal";
import {
  BOGUS_CHEESE_MERGE_ALIAS_PAIRS,
  isBogusMergeAlias,
  toPoolNameSet,
} from "./mergeAliasPurge";
import {
  findFanTarget,
  healFanPoisonedValues,
  type DoughPoolRow,
} from "./brandFanHeal";
import {
  BRAND_DRIFT_RENAMES,
  brandDriftTargetFor,
  planBrandAliasRepoints,
} from "./brandDriftHeal";
import {
  healSeaSaltComponents,
  SEA_SALT_DOUGH_TARGETS,
  SEA_SALT_SAUCE_TARGETS,
  SEA_SALT_MIX_TARGETS,
} from "./seaSaltHeal";

// One-time data heals, applied at boot (best-effort, after listen — like
// seedRoles). Each heal claims its marker row in data_heals FIRST, inside the
// same transaction as its changes: if the insert conflicts the heal already ran
// (or is running on a concurrent instance) and is skipped, so a heal executes
// exactly once per database — dev heals on the next restart, production heals
// on the first boot after publishing.

const CHEESE_POISON_HEAL_ID = "cheese-import-poison-cleanup-v1";

// Heal only today-and-future day rows: past days are history (what actually
// ran) and must not be rewritten. Date literal, not "today at runtime", so the
// heal is deterministic: it targets the schedule as it stood when the fix
// shipped (2026-07-11).
const HEAL_FROM_DATE = "2026-07-11";

async function runCheesePoisonCleanup(): Promise<void> {
  await db.transaction(async (tx) => {
    // Claim the marker. Conflict = already applied (possibly by a concurrent
    // instance whose transaction will/did commit) — skip everything.
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: CHEESE_POISON_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    // 1) Delete the poisoned learned matches (all scopes — sandbox copies of
    // the same poison must not survive either). Matched case-insensitively,
    // exactly how the aliases are applied.
    let deletedRows = 0;
    for (const [external, canonical] of POISONED_CHEESE_ALIAS_PAIRS) {
      const a = await tx
        .delete(specImportAliasesTable)
        .where(
          and(
            eq(specImportAliasesTable.kind, "appType"),
            eq(sql`lower(${specImportAliasesTable.externalName})`, external),
            eq(sql`lower(${specImportAliasesTable.canonicalName})`, canonical),
          ),
        )
        .returning({ id: specImportAliasesTable.id });
      const b = await tx
        .delete(aiCorrectionsTable)
        .where(
          and(
            eq(aiCorrectionsTable.domain, "item"),
            eq(sql`lower(${aiCorrectionsTable.fromText})`, external),
            eq(sql`lower(${aiCorrectionsTable.toText})`, canonical),
          ),
        )
        .returning({ id: aiCorrectionsTable.id });
      deletedRows += a.length + b.length;
    }

    // The brand-crossing flavor match (Lucia's Craft "BBQ Chicken" → "RED HOT
    // CHICKEN") lives in the Excel-import alias table + the shared corrections
    // pool.
    const [flavorFrom, flavorTo] = POISONED_FLAVOR_PAIR;
    const c = await tx
      .delete(importAliasesTable)
      .where(
        and(
          eq(importAliasesTable.type, "flavor"),
          eq(sql`lower(${importAliasesTable.externalName})`, flavorFrom),
          eq(sql`lower(${importAliasesTable.canonicalName})`, flavorTo),
          // Scope to the audited brand context — the same external/canonical
          // pair under a different brand would be a different (possibly
          // legitimate) mapping and must survive.
          eq(sql`lower(coalesce(${importAliasesTable.brandContext}, ''))`, POISONED_FLAVOR_BRAND_CONTEXT),
        ),
      )
      .returning({ id: importAliasesTable.id });
    const d = await tx
      .delete(aiCorrectionsTable)
      .where(
        and(
          eq(aiCorrectionsTable.domain, "flavor"),
          eq(sql`lower(${aiCorrectionsTable.fromText})`, flavorFrom),
          eq(sql`lower(${aiCorrectionsTable.toText})`, flavorTo),
        ),
      )
      .returning({ id: aiCorrectionsTable.id });
    deletedRows += c.length + d.length;

    // 2) Clear the poisoned cheese picks from today-and-future day-state rows
    // (all scopes). FOR UPDATE so a concurrent sync PUT on the same row waits
    // for the heal to commit rather than interleaving.
    const rows = await tx
      .select({ date: dailySyncTable.date, scope: dailySyncTable.scope, data: dailySyncTable.data })
      .from(dailySyncTable)
      .where(gte(dailySyncTable.date, HEAL_FROM_DATE))
      .for("update");

    let healedRows = 0;
    let clearedPicks = 0;
    const now = Date.now();
    for (const row of rows) {
      const result = healCheesePicksInPayload(row.data, now);
      if (!result.changed) continue;
      await tx
        .update(dailySyncTable)
        .set({ data: result.data, updatedAt: new Date() })
        .where(and(eq(dailySyncTable.date, row.date), eq(dailySyncTable.scope, row.scope)));
      healedRows += 1;
      clearedPicks += result.clearedPicks;
    }

    logger.info(
      { heal: CHEESE_POISON_HEAL_ID, deletedRows, healedRows, clearedPicks },
      "Data heal applied",
    );
  });
}

// ── Spec-import alias hygiene purge ──────────────────────────────────────────
// The learned spec-import alias pool accumulated poison before the runtime
// sanitize filter existed: appType aliases with a generic slot-type name
// ("Mix"/"cheese") on either side, digit-mismatched brand/flavor/appType/
// pepType aliases (a 7" name aliased to a plain one collapses Lowe's vs
// Lowe's 7"), and cyclic/chained pairs where one name is both an alias source
// and a target. sanitizeSpecAliases now filters these on EVERY read, so the
// app no longer applies them — this heal removes the rows themselves so
// exports, future logic, and manual inspection stop seeing them. Runs per
// scope (sandbox copies of the poison must not survive either).

const SPEC_ALIAS_HYGIENE_HEAL_ID = "spec-alias-hygiene-purge-v1";

async function runSpecAliasHygienePurge(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: SPEC_ALIAS_HYGIENE_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    const rows = await tx.select().from(specImportAliasesTable).for("update");

    // Group by scope: conflict (cyclic/chained) detection must only look at
    // aliases that are actually applied together.
    const byScope = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byScope.get(row.scope);
      if (list) list.push(row);
      else byScope.set(row.scope, [row]);
    }

    const dropIds: number[] = [];
    for (const scopeRows of byScope.values()) {
      const entries: SpecAliasEntry[] = scopeRows.map((r) => ({
        kind: r.kind as SpecAliasEntry["kind"],
        externalName: r.externalName,
        canonicalName: r.canonicalName,
        context: r.context,
      }));
      const kept = sanitizeSpecAliases(entries);
      const keptSet = new Set(kept);
      for (let i = 0; i < scopeRows.length; i++) {
        // sanitizeSpecAliases preserves entry object identity for survivors.
        if (!keptSet.has(entries[i])) dropIds.push(scopeRows[i].id);
      }
    }

    let deletedRows = 0;
    for (const id of dropIds) {
      const a = await tx
        .delete(specImportAliasesTable)
        .where(eq(specImportAliasesTable.id, id))
        .returning({ id: specImportAliasesTable.id });
      deletedRows += a.length;
    }

    logger.info(
      { heal: SPEC_ALIAS_HYGIENE_HEAL_ID, scanned: rows.length, deletedRows },
      "Data heal applied",
    );
  });
}

// ── Generic "Mix" poison purge (v2) ─────────────────────────────────────────
// After the v1 hygiene purge ran, NEW poison accumulated: the review dialog's
// link suggestions were built from the RAW alias list (unsanitized), so
// learned rows like `appType: "<real blend name>" → "Mix"` were still applied
// AND re-learned on every import. During imports on 2026-07-14 those rows
// renamed several distinct blends to the literal name "Mix", the parse merged
// the same-named recipes, and the commit created one garbage mix record named
// "Mix" carrying every blend's ingredients. The client/server code paths are
// fixed (suggestions sanitized, learn + save paths reject generic names);
// this heal removes the damage that already landed:
//   1. re-runs the alias sanitize purge (drops the new generic rows),
//   2. purges generic-name pairs from the shared corrections pool,
//   3. deletes mix records whose NAME is a generic slot-type name ("Mix"),
//   4. deletes obviously-junk mix drafts (empty brand AND zero components —
//      artifacts of failed early imports that clutter every picker).

const GENERIC_MIX_POISON_HEAL_ID = "generic-mix-poison-purge-v2";

async function runGenericMixPoisonPurge(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: GENERIC_MIX_POISON_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    // 1) Re-run the alias sanitize purge (same logic as v1, fresh marker).
    const rows = await tx.select().from(specImportAliasesTable).for("update");
    const byScope = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byScope.get(row.scope);
      if (list) list.push(row);
      else byScope.set(row.scope, [row]);
    }
    const dropIds: number[] = [];
    for (const scopeRows of byScope.values()) {
      const entries: SpecAliasEntry[] = scopeRows.map((r) => ({
        kind: r.kind as SpecAliasEntry["kind"],
        externalName: r.externalName,
        canonicalName: r.canonicalName,
        context: r.context,
      }));
      const kept = new Set(sanitizeSpecAliases(entries));
      for (let i = 0; i < scopeRows.length; i++) {
        if (!kept.has(entries[i])) dropIds.push(scopeRows[i].id);
      }
    }
    let deletedAliases = 0;
    for (const id of dropIds) {
      const a = await tx
        .delete(specImportAliasesTable)
        .where(eq(specImportAliasesTable.id, id))
        .returning({ id: specImportAliasesTable.id });
      deletedAliases += a.length;
    }

    // 2) Purge generic-name pairs from the shared corrections pool ("item"
    // domain — where appType learnings are mirrored). Either side generic.
    const corrections = await tx
      .select({ id: aiCorrectionsTable.id, fromText: aiCorrectionsTable.fromText, toText: aiCorrectionsTable.toText })
      .from(aiCorrectionsTable)
      .where(eq(aiCorrectionsTable.domain, "item"));
    let deletedCorrections = 0;
    for (const c of corrections) {
      if (!isGenericSlotTypeName(c.fromText) && !isGenericSlotTypeName(c.toText)) continue;
      const a = await tx
        .delete(aiCorrectionsTable)
        .where(eq(aiCorrectionsTable.id, c.id))
        .returning({ id: aiCorrectionsTable.id });
      deletedCorrections += a.length;
    }

    // 3+4) Delete garbage mix records: generic-named ones (the merged "Mix"
    // record) and empty junk drafts (no brand AND no components). Everything
    // references mixes by NAME, so removing a garbage record simply empties
    // the applicator card for a fresh pick / clean re-import.
    const mixes = await tx.select().from(mixesTable).for("update");
    let deletedMixes = 0;
    for (const m of mixes) {
      const genericName = isGenericSlotTypeName(m.name);
      const emptyJunk = (m.brand ?? "").trim() === "" && (m.components ?? []).length === 0;
      if (!genericName && !emptyJunk) continue;
      const a = await tx
        .delete(mixesTable)
        .where(and(eq(mixesTable.id, m.id), eq(mixesTable.scope, m.scope)))
        .returning({ id: mixesTable.id });
      deletedMixes += a.length;
    }

    logger.info(
      { heal: GENERIC_MIX_POISON_HEAL_ID, deletedAliases, deletedCorrections, deletedMixes },
      "Data heal applied",
    );
  });
}

// ── Cheese-named mix crossover purge ────────────────────────────────────────
// Past imports misrouted cheese blends into the Mixes pool (e.g. "Lowe's Red
// Hot Cheese Mix" landed as a premix row duplicating the cheese_recipes row).
// Because the mix-routing heuristic used to honor pool membership over the
// name, that junk row flipped every future import/auto-fill of the blend to
// "Mix". The heuristic is fixed (a name mentioning "cheese" never routes to
// mix); this heal removes the crossover rows that already landed: any mixes
// row whose name mentions "cheese" AND has a same-named (ci, per scope)
// cheese_recipes row. Mixes are referenced by NAME, so deleting simply lets
// the applicator card resolve to the cheese recipe instead.

const CHEESE_MIX_CROSSOVER_HEAL_ID = "cheese-named-mix-crossover-purge-v1";

async function runCheeseMixCrossoverPurge(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: CHEESE_MIX_CROSSOVER_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    const cheeseRows = await tx
      .select({ scope: cheeseRecipesTable.scope, name: cheeseRecipesTable.name })
      .from(cheeseRecipesTable);
    const cheeseKeys = new Set(
      cheeseRows.map((r) => `${r.scope}\u0000${r.name.trim().toLowerCase()}`),
    );

    const mixes = await tx.select().from(mixesTable).for("update");
    let deletedMixes = 0;
    for (const m of mixes) {
      const nameLower = (m.name ?? "").trim().toLowerCase();
      if (!/cheese/.test(nameLower)) continue;
      if (!cheeseKeys.has(`${m.scope}\u0000${nameLower}`)) continue;
      const a = await tx
        .delete(mixesTable)
        .where(and(eq(mixesTable.id, m.id), eq(mixesTable.scope, m.scope)))
        .returning({ id: mixesTable.id });
      deletedMixes += a.length;
    }

    logger.info(
      { heal: CHEESE_MIX_CROSSOVER_HEAL_ID, scanned: mixes.length, deletedMixes },
      "Data heal applied",
    );
  });
}

// ── Cheese-recipe exact-name duplicate purge ────────────────────────────────
// The cheese pool accumulated rows with the EXACT same name (per scope):
// multi-file imports and racing devices deduped against a stale pool snapshot,
// and the POST route accepted any new id without a name check. The route now
// rejects new-id duplicates; this heal removes the rows that already exist.
// Everything links to cheese recipes by NAME (never id), so deleting the
// losers is safe — pickers and applicator cards resolve to the survivor.
// Keeper rank per (scope, trimmed ci name): a row with curated per-batch lbs
// beats one without, then more components beats fewer, then oldest wins.

const CHEESE_DUP_HEAL_ID = "cheese-recipe-name-dedupe-v1";

async function runCheeseDuplicateNamePurge(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: CHEESE_DUP_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    const rows = await tx.select().from(cheeseRecipesTable).for("update");

    type Row = (typeof rows)[number];
    const groups = new Map<string, Row[]>();
    for (const row of rows) {
      const key = `${row.scope}\u0000${row.name.trim().toLowerCase()}`;
      const list = groups.get(key);
      if (list) list.push(row);
      else groups.set(key, [row]);
    }

    const rank = (r: Row): [number, number, number] => {
      const components = r.components ?? [];
      const hasLbs = components.some((c) => (c.lbs ?? 0) > 0) ? 1 : 0;
      return [hasLbs, components.length, -r.createdAt.getTime()];
    };

    const dropRows: Row[] = [];
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const sorted = [...list].sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        for (let i = 0; i < ra.length; i++) {
          if (ra[i] !== rb[i]) return rb[i] - ra[i];
        }
        return a.id.localeCompare(b.id);
      });
      for (const loser of sorted.slice(1)) dropRows.push(loser);
    }

    let deletedRows = 0;
    for (const loser of dropRows) {
      // Delete by (id, scope) — the upsert key allows the SAME id to exist in
      // two scopes, and only the row in the loser's own scope is a duplicate.
      const a = await tx
        .delete(cheeseRecipesTable)
        .where(
          and(
            eq(cheeseRecipesTable.id, loser.id),
            eq(cheeseRecipesTable.scope, loser.scope),
          ),
        )
        .returning({ id: cheeseRecipesTable.id });
      deletedRows += a.length;
    }

    logger.info(
      { heal: CHEESE_DUP_HEAL_ID, scanned: rows.length, deletedRows },
      "Data heal applied",
    );
  });
}

// ── Cheese blend share backfill ─────────────────────────────────────────────
// Cheese blends moved to a RATIO model: each component carries `sharePct`
// (its percent of the blend), and a flavor's per-ingredient oz/pizza is the
// flavor's cheese applicator target oz × the share. This heal additively fills
// sharePct on existing components (derived from ozPerPizza proportions, else
// lbs proportions — see cheeseComponentShares in @workspace/cheese-recipes).
// Existing sharePct values, lbs, and ozPerPizza are never changed, so the heal
// is purely additive and safe to run on any pool state.

const CHEESE_SHARE_BACKFILL_HEAL_ID = "cheese-share-backfill-v1";

async function runCheeseShareBackfill(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: CHEESE_SHARE_BACKFILL_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    const rows = await tx.select().from(cheeseRecipesTable).for("update");
    let updatedRows = 0;
    for (const row of rows) {
      const recipe = normalizeCheeseRecipe(row);
      if (!recipe) continue;
      const [changed] = backfillCheeseSharePcts([recipe]);
      if (!changed) continue;
      await tx
        .update(cheeseRecipesTable)
        .set({ components: changed.components, updatedAt: new Date() })
        .where(
          and(
            eq(cheeseRecipesTable.id, row.id),
            eq(cheeseRecipesTable.scope, row.scope),
          ),
        );
      updatedRows++;
    }

    logger.info(
      { heal: CHEESE_SHARE_BACKFILL_HEAL_ID, scanned: rows.length, updatedRows },
      "Data heal applied",
    );
  });
}

// ── Cheese poisoned-oz strip ────────────────────────────────────────────────
// Spec imports recorded per-pizza oz values on cheese blend components that
// (a) no longer cover the whole blend (a manager later added an ingredient
// with lbs only — e.g. Cellulose on Aldo's Cheese Mix) or (b) contradict the
// trusted deterministic cheese-workbook lbs by ~10x (Parmesan/Oregano rows).
// Share math now falls back to lbs on partial coverage, but the stored oz
// values are still poison: removing the lbs-only row would flip shares back
// onto the bad oz. This heal drops ALL ozPerPizza values from any recipe
// whose oz set is partial-coverage or wildly inconsistent with its lbs
// proportions (see stripInconsistentCheeseOz in @workspace/cheese-recipes).
// lbs and sharePct are never touched.

const CHEESE_OZ_DEPOISON_HEAL_ID = "cheese-oz-depoison-v1";

async function runCheeseOzDepoison(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: CHEESE_OZ_DEPOISON_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    const rows = await tx.select().from(cheeseRecipesTable).for("update");
    let updatedRows = 0;
    for (const row of rows) {
      const recipe = normalizeCheeseRecipe(row);
      if (!recipe) continue;
      const [changed] = stripInconsistentCheeseOz([recipe]);
      if (!changed) continue;
      await tx
        .update(cheeseRecipesTable)
        .set({ components: changed.components, updatedAt: new Date() })
        .where(
          and(
            eq(cheeseRecipesTable.id, row.id),
            eq(cheeseRecipesTable.scope, row.scope),
          ),
        );
      updatedRows++;
    }

    logger.info(
      { heal: CHEESE_OZ_DEPOISON_HEAL_ID, scanned: rows.length, updatedRows },
      "Data heal applied",
    );
  });
}

// ── Dough/sauce recipe name cleanup ─────────────────────────────────────────
// Past spec imports created dough/sauce pool entries with spec-sheet packaging
// noise baked into the name: "(made in house)" provenance qualifiers and
// "Parbake crust (X - … Dies)" wrapping. The import pipeline now strips these
// (cleanSpecNamedRecipeName); this heal renames the pool entries that already
// landed, re-points every reference (brand_profiles doughRecipeName /
// frontlineRecipeName + today-and-future daily_sync runValues), and records
// import aliases so a re-import of the raw sheet name still links. Renames
// that would collide with an existing same-scope name are skipped (the link
// pass will snap future imports onto the survivor instead).

const NAMED_RECIPE_NAME_CLEANUP_HEAL_ID = "named-recipe-name-cleanup-v1";
// Only rewrite today-and-future day rows; past days are history.
const NAME_CLEANUP_FROM_DATE = "2026-07-15";

async function runNamedRecipeNameCleanup(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: NAMED_RECIPE_NAME_CLEANUP_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    // scope → kind → oldNameLower → newName
    const renames = new Map<string, { dough: Map<string, string>; sauce: Map<string, string> }>();
    const scopeRenames = (scope: string) => {
      let r = renames.get(scope);
      if (!r) {
        r = { dough: new Map(), sauce: new Map() };
        renames.set(scope, r);
      }
      return r;
    };

    let renamedRows = 0;
    for (const kind of ["dough", "sauce"] as const) {
      const table = kind === "dough" ? doughRecipesTable : sauceRecipesTable;
      const rows = await tx.select().from(table).for("update");
      // Existing-name sets per scope for collision checks (kept up to date as
      // renames land so two rows can't both rename onto the same clean name).
      const namesByScope = new Map<string, Set<string>>();
      for (const row of rows) {
        let set = namesByScope.get(row.scope);
        if (!set) {
          set = new Set();
          namesByScope.set(row.scope, set);
        }
        set.add(row.name.trim().toLowerCase());
      }
      for (const row of rows) {
        const oldName = row.name.trim();
        const newName = cleanSpecNamedRecipeName(kind, oldName);
        if (!newName || newName === oldName) continue;
        const set = namesByScope.get(row.scope)!;
        // Collision with a DIFFERENT existing row (ci): skip the rename.
        if (
          newName.toLowerCase() !== oldName.toLowerCase() &&
          set.has(newName.toLowerCase())
        ) {
          continue;
        }
        await tx
          .update(table)
          .set({ name: newName, updatedAt: new Date() })
          .where(and(eq(table.id, row.id), eq(table.scope, row.scope)));
        set.delete(oldName.toLowerCase());
        set.add(newName.toLowerCase());
        scopeRenames(row.scope)[kind].set(oldName.toLowerCase(), newName);
        renamedRows++;

        // Remember the raw sheet name as a learned alias so a future import
        // of the uncleaned label still snaps to the renamed pool entry (the
        // "recipeName" kind, context = the recipe kind — the same namespace
        // the review's "use existing" picks write to).
        await tx.insert(specImportAliasesTable).values({
          scope: row.scope,
          kind: "recipeName",
          externalName: oldName,
          canonicalName: newName,
          context: kind,
        });
      }
    }

    // Re-point brand profiles (values.doughRecipeName / frontlineRecipeName).
    let repointedProfiles = 0;
    if (renamedRows > 0) {
      const profiles = await tx.select().from(brandProfilesTable).for("update");
      for (const p of profiles) {
        const r = renames.get(p.scope);
        if (!r) continue;
        const values = { ...(p.values ?? {}) } as Record<string, unknown>;
        let changed = false;
        const dough = String(values.doughRecipeName ?? "").trim();
        const dTo = dough ? r.dough.get(dough.toLowerCase()) : undefined;
        if (dTo && dTo !== dough) {
          values.doughRecipeName = dTo;
          changed = true;
        }
        const sauce = String(values.frontlineRecipeName ?? "").trim();
        const sTo = sauce ? r.sauce.get(sauce.toLowerCase()) : undefined;
        if (sTo && sTo !== sauce) {
          values.frontlineRecipeName = sTo;
          changed = true;
        }
        if (!changed) continue;
        // Advance the client LWW stamp so devices holding the old name can't
        // clobber the rename back with a stale re-publish.
        const stamp = Math.max((p.updatedAtMs ?? 0) + 1, Date.now());
        await tx
          .update(brandProfilesTable)
          .set({ values, updatedAtMs: stamp })
          .where(
            and(
              eq(brandProfilesTable.key, p.key),
              eq(brandProfilesTable.scope, p.scope),
            ),
          );
        repointedProfiles++;
      }
    }

    // Re-point today-and-future day-state run values (runValues[runId]
    // .doughRecipeName / .frontlineRecipeName) so open runs keep their link.
    let repointedDays = 0;
    if (renamedRows > 0) {
      const days = await tx
        .select()
        .from(dailySyncTable)
        .where(gte(dailySyncTable.date, NAME_CLEANUP_FROM_DATE))
        .for("update");
      for (const day of days) {
        const r = renames.get(day.scope);
        if (!r) continue;
        const data = day.data as Record<string, unknown> | null;
        const runValues = data?.runValues as
          | Record<string, Record<string, unknown>>
          | undefined;
        if (!runValues || typeof runValues !== "object") continue;
        let changed = false;
        for (const vals of Object.values(runValues)) {
          if (!vals || typeof vals !== "object") continue;
          const dough = String(vals.doughRecipeName ?? "").trim();
          const dTo = dough ? r.dough.get(dough.toLowerCase()) : undefined;
          if (dTo && dTo !== dough) {
            vals.doughRecipeName = dTo;
            changed = true;
          }
          const sauce = String(vals.frontlineRecipeName ?? "").trim();
          const sTo = sauce ? r.sauce.get(sauce.toLowerCase()) : undefined;
          if (sTo && sTo !== sauce) {
            vals.frontlineRecipeName = sTo;
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
    }

    logger.info(
      {
        heal: NAMED_RECIPE_NAME_CLEANUP_HEAL_ID,
        renamedRows,
        repointedProfiles,
        repointedDays,
      },
      "Data heal applied",
    );
  });
}

// ── Dough batch yield de-poison ─────────────────────────────────────────────
// Dough mixing sheets carry many same-named family variant rows (one per
// customer); before the import learned to treat name-relinked ties as
// blank-fill-only, the LAST variant row's doughBatchYield clobbered every
// profile linked to that dough family (e.g. all CRB Dough profiles stored the
// Lowe's 7 Inch 898 yield). The stored yield is a FALLBACK only — the run form
// derives the true yield from the dough rows' total lbs ÷ doughball weight and
// auto-zeroes the field when both are present. This heal applies that same
// rule to stored profiles: when a profile has real dough rows (lbs > 0) and a
// doughball weight (> 0), zero its stored doughBatchYield so every surface
// derives instead of showing the poisoned number.

const DOUGH_YIELD_DEPOISON_HEAL_ID = "dough-batch-yield-depoison-v1";

function doughRowsHaveLbs(rows: unknown): boolean {
  if (!Array.isArray(rows)) return false;
  return rows.some(
    (r) =>
      r &&
      typeof r === "object" &&
      Number((r as Record<string, unknown>).lbs ?? 0) > 0,
  );
}

async function runDoughYieldDepoison(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: DOUGH_YIELD_DEPOISON_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    const profiles = await tx.select().from(brandProfilesTable).for("update");
    let updated = 0;
    for (const p of profiles) {
      const values = { ...(p.values ?? {}) } as Record<string, unknown>;
      const yieldVal = Number(values.doughBatchYield ?? 0);
      if (!(yieldVal > 0)) continue;
      if (!(Number(values.targetDoughballWeight ?? 0) > 0)) continue;
      if (!doughRowsHaveLbs(values.doughRecipe)) continue;
      values.doughBatchYield = 0;
      // Advance the client LWW stamp so a device still holding the poisoned
      // yield can't re-publish it over the heal with a stale stamp.
      const stamp = Math.max((p.updatedAtMs ?? 0) + 1, Date.now());
      await tx
        .update(brandProfilesTable)
        .set({ values, updatedAtMs: stamp })
        .where(
          and(
            eq(brandProfilesTable.key, p.key),
            eq(brandProfilesTable.scope, p.scope),
          ),
        );
      updated++;
    }

    logger.info(
      { heal: DOUGH_YIELD_DEPOISON_HEAL_ID, scanned: profiles.length, updated },
      "Data heal applied",
    );
  });
}

// ── Heal 9: de-poison recipe-level doughball weights on family-dough profiles ──
// A dough FAMILY recipe (e.g. "CRB Dough") carries per-customer variants; its
// recipe-level doughball weight/per-tray belong to no particular customer.
// Before pool hydration became variant-aware, a spec import that carried only
// the dough NAME blank-backfilled the recipe-level numbers into profiles
// (e.g. 13 oz onto profiles whose real variant is 7.6 oz). Poison signature:
// the stored value equals the recipe-level number, the recipe has MULTIPLE
// variants, and NO variant carries that value. Heal = clear it (blank), so
// the form / Auto-Fill re-fills the correct variant instead of us guessing.

const DOUGH_FAMILY_WEIGHT_DEPOISON_HEAL_ID = "dough-family-weight-depoison-v1";

async function runDoughFamilyWeightDepoison(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: DOUGH_FAMILY_WEIGHT_DEPOISON_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    const doughs = await tx.select().from(doughRecipesTable);
    // Family recipes only: multiple variants → recipe-level numbers ambiguous.
    const families = doughs
      .map((d) => ({
        scope: d.scope,
        name: d.name,
        weightOz: Number(d.doughballWeightOz ?? 0),
        perTray: Number(d.doughballsPerTray ?? 0),
        variants: normalizeDoughballVariants(d.doughballVariants),
      }))
      .filter((d) => d.variants.length > 1);
    if (families.length === 0) {
      logger.info(
        { heal: DOUGH_FAMILY_WEIGHT_DEPOISON_HEAL_ID, updated: 0 },
        "Data heal applied (no family dough recipes)",
      );
      return;
    }

    const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
    const profiles = await tx.select().from(brandProfilesTable).for("update");
    let updated = 0;
    for (const p of profiles) {
      const values = { ...(p.values ?? {}) } as Record<string, unknown>;
      const dName = String(values.doughRecipeName ?? "").trim();
      if (!dName) continue;
      const fam = families.find(
        (d) =>
          d.scope === p.scope &&
          specImportNamedRecipeNamesEqual(d.name, dName),
      );
      if (!fam) continue;
      let changed = false;
      const wt = Number(values.targetDoughballWeight ?? 0);
      if (
        wt > 0 &&
        near(wt, fam.weightOz) &&
        !fam.variants.some((v) => near(Number(v.weightOz ?? 0), wt))
      ) {
        values.targetDoughballWeight = 0;
        changed = true;
      }
      const pt = Number(values.doughballsPerTray ?? 0);
      if (
        pt > 0 &&
        pt === fam.perTray &&
        !fam.variants.some((v) => Number(v.perTray ?? 0) === pt)
      ) {
        values.doughballsPerTray = 0;
        changed = true;
      }
      if (!changed) continue;
      // Advance the client LWW stamp so a device still holding the poisoned
      // number can't re-publish it over the heal with a stale stamp.
      const stamp = Math.max((p.updatedAtMs ?? 0) + 1, Date.now());
      await tx
        .update(brandProfilesTable)
        .set({ values, updatedAtMs: stamp })
        .where(
          and(
            eq(brandProfilesTable.key, p.key),
            eq(brandProfilesTable.scope, p.scope),
          ),
        );
      updated++;
    }

    logger.info(
      { heal: DOUGH_FAMILY_WEIGHT_DEPOISON_HEAL_ID, scanned: profiles.length, updated },
      "Data heal applied",
    );
  });
}

// ── SMD Pep Cheese Mix lost-data restore ────────────────────────────────────
// Merging "SMD Pepperoni Cheese Mix" into "SMD Pep Cheese Mix" (a spec-import
// stub with all-zero lbs) deleted the real batch data from the pool: the
// recipe-name merge flow re-pointed names and deleted the source recipe
// without ever copying its data. The merge path now backfills before deleting
// (backfill*FromMergedSources); this heal restores the known lost values onto
// the surviving "SMD Pep Cheese Mix" — ONLY if its component lbs are still all
// zero (a manager may have re-entered them since). Rows are matched loosely by
// ingredient name; the survivor's own row naming (e.g. "Diced Pepperoni") is
// kept. Cellulose 0.3 lbs is appended if the recipe has no cellulose row, and
// cellulose "0.83" / shredder "#1" are set only when blank.

const SMD_PEP_CHEESE_RESTORE_HEAL_ID = "smd-pep-cheese-mix-restore-v1";

// Loose row matching: a row whose loose ingredient key contains the pattern.
function looseKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const SMD_LOST_ROWS: Array<{ match: (key: string) => boolean; lbs: number }> = [
  { match: (k) => k.includes("mozz"), lbs: 20 },
  { match: (k) => k.includes("provolone"), lbs: 8 },
  { match: (k) => k.includes("pepperoni"), lbs: 8 },
  { match: (k) => k.includes("romano"), lbs: 2.5 },
];

async function runSmdPepCheeseRestore(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: SMD_PEP_CHEESE_RESTORE_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    const rows = await tx.select().from(cheeseRecipesTable).for("update");
    let updatedRows = 0;
    for (const row of rows) {
      if (row.name.trim().toLowerCase() !== "smd pep cheese mix") continue;
      const recipe = normalizeCheeseRecipe(row);
      if (!recipe) continue;
      // Only heal a recipe still carrying the damage: every component's lbs 0.
      if (recipe.components.some((c) => c.lbs > 0)) continue;

      let changed = false;
      const components = recipe.components.map((c) => ({ ...c }));
      const claimedIdx = new Set<number>();
      for (const lost of SMD_LOST_ROWS) {
        const idx = components.findIndex(
          (c, i) => !claimedIdx.has(i) && lost.match(looseKey(c.ingredient)),
        );
        if (idx === -1) continue;
        claimedIdx.add(idx);
        if (!(components[idx].lbs > 0)) {
          components[idx].lbs = lost.lbs;
          changed = true;
        }
      }
      if (!components.some((c) => looseKey(c.ingredient).includes("cellulose"))) {
        components.push({ ingredient: "Cellulose", lbs: 0.3 });
        changed = true;
      }
      const cellulose = recipe.cellulose.trim() ? recipe.cellulose : "0.83";
      const shredderSetting = recipe.shredderSetting.trim()
        ? recipe.shredderSetting
        : "#1";
      if (cellulose !== recipe.cellulose || shredderSetting !== recipe.shredderSetting) {
        changed = true;
      }
      if (!changed) continue;
      await tx
        .update(cheeseRecipesTable)
        .set({ components, cellulose, shredderSetting, updatedAt: new Date() })
        .where(
          and(
            eq(cheeseRecipesTable.id, row.id),
            eq(cheeseRecipesTable.scope, row.scope),
          ),
        );
      updatedRows++;
    }

    logger.info(
      { heal: SMD_PEP_CHEESE_RESTORE_HEAL_ID, scanned: rows.length, updatedRows },
      "Data heal applied",
    );
  });
}

// ── Bogus truncated merge memories (2026-07-19) ─────────────────────────────
// A handful of cheese-tab merge_aliases rows carry truncated garbage canonical
// names ("Ald", "Basha", "Pinsa" — partially-typed merge targets) plus the
// stale half of a bidirectional SMD pair pointing at the dead "SMD Pep Cheese
// Mix" name. No pool rows carry those names (audited 2026-07-19), but they can
// bias future AI merge suggestions and any code trusting merge memory. Delete
// them in every scope (a sandbox re-copy of the same poison must not survive),
// but ONLY while the canonical name still has no backing cheese pool row in
// the row's scope — if a manager has since created a recipe with that exact
// name, the alias is meaningful again and stays. Also delete any mirrored
// ai_corrections rows for the same pairs (none existed at audit time, but the
// corrections pool is written best-effort alongside merges).

const BOGUS_MERGE_ALIAS_HEAL_ID = "bogus-merge-alias-purge-v1";

async function runBogusMergeAliasPurge(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: BOGUS_MERGE_ALIAS_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    // Cheese pool names per scope, for the "canonical still dead" guard.
    const pool = await tx
      .select({ scope: cheeseRecipesTable.scope, name: cheeseRecipesTable.name })
      .from(cheeseRecipesTable);
    const poolByScope = new Map<string, Set<string>>();
    for (const row of pool) {
      let set = poolByScope.get(row.scope);
      if (!set) {
        set = new Set<string>();
        poolByScope.set(row.scope, set);
      }
      toPoolNameSet([row.name]).forEach((n) => set!.add(n));
    }

    const aliases = await tx
      .select()
      .from(mergeAliasesTable)
      .where(eq(mergeAliasesTable.category, "cheese"))
      .for("update");
    let deletedAliases = 0;
    for (const row of aliases) {
      const poolNames = poolByScope.get(row.scope) ?? new Set<string>();
      if (!isBogusMergeAlias(row, poolNames)) continue;
      await tx
        .delete(mergeAliasesTable)
        .where(eq(mergeAliasesTable.id, row.id));
      deletedAliases++;
    }

    // Mirrored corrections: the same external→canonical pairs, any domain —
    // these exact pairs cannot be legitimate mappings.
    let deletedCorrections = 0;
    for (const [external, canonical] of BOGUS_CHEESE_MERGE_ALIAS_PAIRS) {
      const del = await tx
        .delete(aiCorrectionsTable)
        .where(
          and(
            eq(sql`lower(trim(${aiCorrectionsTable.fromText}))`, external),
            eq(sql`lower(trim(${aiCorrectionsTable.toText}))`, canonical),
          ),
        )
        .returning({ id: aiCorrectionsTable.id });
      deletedCorrections += del.length;
    }

    logger.info(
      {
        heal: BOGUS_MERGE_ALIAS_HEAL_ID,
        scanned: aliases.length,
        deletedAliases,
        deletedCorrections,
      },
      "Data heal applied",
    );
  });
}

// ── Sea Salt is not Salt (2026-07-18) ────────────────────────────────────────
// A 2026-07-16 import confirm learned "SEA SALT" → "SALT" factory-wide
// (spec_import_aliases kind doughIngredient + mirrored ai_corrections domain
// ingredient). They are DIFFERENT ingredients. This heal:
//   1. deletes the learned alias + correction rows (matched by normalized
//      name pair across ALL ingredient kinds and ALL scopes — ids differ per
//      environment, and sandbox copies must not survive either);
//   2. renames poisoned pool rows back to "Sea Salt" where the SOURCE sheet
//      says Sea Salt and the stored amount matches the sheet (or is a stub 0)
//      — see seaSaltHeal.ts for the grounding rules.
// Re-learning is permanently blocked by the modifier-drop (token-subset)
// guard now enforced in sanitizeSpecAliases, applyNameMatches, and both
// server POST routes — that guard IS the never-learn set for this pair.

const SEA_SALT_HEAL_ID = "sea-salt-alias-undo-v1";

const INGREDIENT_ALIAS_KINDS_SQL = ["cheeseIngredient", "doughIngredient", "sauceIngredient"];

async function runSeaSaltAliasUndo(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: SEA_SALT_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    // 1) Kill the learned rules (match by normalized pair, not raw id).
    let deletedRows = 0;
    for (const kind of INGREDIENT_ALIAS_KINDS_SQL) {
      const a = await tx
        .delete(specImportAliasesTable)
        .where(
          and(
            eq(specImportAliasesTable.kind, kind),
            eq(sql`lower(trim(${specImportAliasesTable.externalName}))`, "sea salt"),
            eq(sql`lower(trim(${specImportAliasesTable.canonicalName}))`, "salt"),
          ),
        )
        .returning({ id: specImportAliasesTable.id });
      deletedRows += a.length;
    }
    const b = await tx
      .delete(aiCorrectionsTable)
      .where(
        and(
          eq(aiCorrectionsTable.domain, "ingredient"),
          eq(sql`lower(trim(${aiCorrectionsTable.fromText}))`, "sea salt"),
          eq(sql`lower(trim(${aiCorrectionsTable.toText}))`, "salt"),
        ),
      )
      .returning({ id: aiCorrectionsTable.id });
    deletedRows += b.length;

    // 2) Rename poisoned pool rows back to "Sea Salt" (all scopes; sandbox
    // copies carry the same poison). Component shapes: dough/sauce rows are
    // { ingredient, lbs }, mix rows are { ingredient, perPizza }.
    let renamedRecipes = 0;

    const doughRows = await tx.select().from(doughRecipesTable).for("update");
    for (const row of doughRows) {
      const comps = Array.isArray(row.components)
        ? row.components
        : [];
      const healed = healSeaSaltComponents(row.name, comps, SEA_SALT_DOUGH_TARGETS, (c) =>
        typeof c.lbs === "number" ? c.lbs : 0,
      );
      if (!healed) continue;
      await tx
        .update(doughRecipesTable)
        .set({ components: healed, updatedAt: new Date() })
        .where(and(eq(doughRecipesTable.id, row.id), eq(doughRecipesTable.scope, row.scope)));
      renamedRecipes++;
    }

    const sauceRows = await tx.select().from(sauceRecipesTable).for("update");
    for (const row of sauceRows) {
      const comps = Array.isArray(row.components)
        ? row.components
        : [];
      const healed = healSeaSaltComponents(row.name, comps, SEA_SALT_SAUCE_TARGETS, (c) =>
        typeof c.lbs === "number" ? c.lbs : 0,
      );
      if (!healed) continue;
      await tx
        .update(sauceRecipesTable)
        .set({ components: healed, updatedAt: new Date() })
        .where(and(eq(sauceRecipesTable.id, row.id), eq(sauceRecipesTable.scope, row.scope)));
      renamedRecipes++;
    }

    const mixRows = await tx.select().from(mixesTable).for("update");
    for (const row of mixRows) {
      const comps = Array.isArray(row.components)
        ? row.components
        : [];
      const healed = healSeaSaltComponents(row.name, comps, SEA_SALT_MIX_TARGETS, (c) =>
        typeof c.perPizza === "number" ? c.perPizza : 0,
      );
      if (!healed) continue;
      await tx
        .update(mixesTable)
        .set({ components: healed, updatedAt: new Date() })
        .where(and(eq(mixesTable.id, row.id), eq(mixesTable.scope, row.scope)));
      renamedRecipes++;
    }

    logger.info(
      { heal: SEA_SALT_HEAL_ID, deletedRows, renamedRecipes },
      "Data heal applied",
    );
  });
}

// ── Duplicate mix name purge ────────────────────────────────────────────────
// Two spec/premix imports minted the SAME mix under two different ids (the
// first record's id derived from an earlier name, e.g. "Red Fajita Mix",
// which was later renamed to the full name a second import also created).
// The Merge screen is name-keyed, so two same-named pool rows look like one
// name and can never be merged away — the duplicate is stuck in Manage Lists.
// Keep the row with real data (per-batch/per-pizza amounts, more components,
// newest), delete the hollow one. Mirrors runCheeseDuplicateNamePurge.

const MIX_DUP_HEAL_ID = "mix-duplicate-name-purge-v1";

type MixDupRow = {
  id: string;
  scope: string;
  name: string;
  brand: string;
  flavor: string;
  batchSize: number;
  components: { ingredient: string; perPizza?: number }[] | null;
  createdAt: Date;
};

/**
 * Pure selection logic for the mix duplicate purge: group rows by
 * scope + case-insensitive (name, brand, flavor), keep the best row per
 * group (real amounts > has batch size > more components > newest), and
 * return the losers to delete. Exported for unit tests.
 */
export function pickMixDuplicateLosers<R extends MixDupRow>(rows: R[]): R[] {
  const groups = new Map<string, R[]>();
  for (const row of rows) {
    const key = [
      row.scope,
      row.name.trim().toLowerCase(),
      row.brand.trim().toLowerCase(),
      row.flavor.trim().toLowerCase(),
    ].join("\u0000");
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const rank = (r: R): [number, number, number, number] => {
    const components = r.components ?? [];
    const hasAmounts = components.some(
      (c) =>
        (c.perPizza ?? 0) > 0 ||
        ((c as { perBatchLbs?: number }).perBatchLbs ?? 0) > 0,
    )
      ? 1
      : 0;
    const hasBatch = r.batchSize > 0 ? 1 : 0;
    // Sort is descending on each term, so the raw timestamp prefers NEWEST.
    return [hasAmounts, hasBatch, components.length, r.createdAt.getTime()];
  };

  const losers: R[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      for (let i = 0; i < ra.length; i++) {
        if (ra[i] !== rb[i]) return rb[i] - ra[i];
      }
      return a.id.localeCompare(b.id);
    });
    for (const loser of sorted.slice(1)) losers.push(loser);
  }
  return losers;
}

async function runMixDuplicateNamePurge(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: MIX_DUP_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    const rows = await tx.select().from(mixesTable).for("update");
    const dropRows = pickMixDuplicateLosers(rows);

    let deletedRows = 0;
    for (const loser of dropRows) {
      // Delete by (id, scope) — the upsert key allows the SAME id in two
      // scopes, and only the row in the loser's own scope is a duplicate.
      const a = await tx
        .delete(mixesTable)
        .where(
          and(eq(mixesTable.id, loser.id), eq(mixesTable.scope, loser.scope)),
        )
        .returning({ id: mixesTable.id });
      deletedRows += a.length;
    }

    logger.info(
      { heal: MIX_DUP_HEAL_ID, scanned: rows.length, deletedRows },
      "Data heal applied",
    );
  });
}

// ── Purchased-crust die de-poison ───────────────────────────────────────────
// Spec imports of purchased pre-made crust products (Bonici/Pedone parbake &
// pinsa crusts) minted a bogus dieType on the brand profiles: either the whole
// crust description ("Pedone Crust 7\"x12\" Oval" — with no dough name at all)
// or a size lifted from the crust name ("Pinsa 12\" Crust …" → die "12\"").
// Purchased crusts are never pressed, so they have NO die. Apply the same
// deterministic rule the importer now enforces (stripPurchasedCrustDie in
// @workspace/spec-import) to stored profile values: a crust-named dieType
// moves into an empty doughRecipeName and is cleared; a profile whose dough
// name is a purchased-crust name gets its dieType cleared. In-house names all
// carry "Dough"/"Recipe"/"Dies", so their dies are untouched.

const PURCHASED_CRUST_DIE_HEAL_ID = "purchased-crust-die-heal-v1";

async function runPurchasedCrustDieDepoison(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: PURCHASED_CRUST_DIE_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    const profiles = await tx.select().from(brandProfilesTable).for("update");
    let updated = 0;
    for (const p of profiles) {
      const values = { ...(p.values ?? {}) } as Record<string, unknown>;
      const before = {
        dieType: String(values.dieType ?? "").trim() || undefined,
        doughName: String(values.doughRecipeName ?? "").trim() || undefined,
      };
      const after = stripPurchasedCrustDie(before);
      if (after === before) continue;
      if (after.dieType !== before.dieType) values.dieType = "";
      if (after.doughName !== before.doughName) {
        values.doughRecipeName = after.doughName ?? "";
      }
      // Advance the client LWW stamp so a device still holding the poisoned
      // die can't re-publish it over the heal with a stale stamp.
      const stamp = Math.max((p.updatedAtMs ?? 0) + 1, Date.now());
      await tx
        .update(brandProfilesTable)
        .set({ values, updatedAtMs: stamp })
        .where(
          and(
            eq(brandProfilesTable.key, p.key),
            eq(brandProfilesTable.scope, p.scope),
          ),
        );
      updated++;
    }

    logger.info(
      { heal: PURCHASED_CRUST_DIE_HEAL_ID, scanned: profiles.length, updated },
      "Data heal applied",
    );
  });
}

// ── Doughball variant suffix-duplicate collapse ─────────────────────────────
// Variant merging used to key on the EXACT (ci) label, so a later import that
// phrased a variant label with the family dough name tacked on ("Corner Booth
// CRB Dough") appended a NEW variant next to the existing "Corner Booth"
// instead of updating it. The merge paths now fold suffix-equivalent labels
// (see doughballVariantLabelKey in @workspace/named-recipes); this heal
// collapses the duplicates that already landed: per dough recipe (all scopes),
// entries whose labels are suffix-equivalent fold onto one entry keeping the
// base (shorter) label, later set values winning (identical in the observed
// production data). Entries whose numbers contradict are never folded, so no
// legitimate variant is lost.

const DOUGH_VARIANT_SUFFIX_DEDUPE_HEAL_ID = "dough-variant-suffix-dedupe-v1";

async function runDoughVariantSuffixDedupe(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: DOUGH_VARIANT_SUFFIX_DEDUPE_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    const rows = await tx.select().from(doughRecipesTable).for("update");
    let updatedRows = 0;
    let removedVariants = 0;
    for (const row of rows) {
      const before = normalizeDoughballVariants(row.doughballVariants);
      const collapsed = collapseDoughballVariantSuffixDuplicates(
        before,
        row.name,
      );
      if (!collapsed) continue;
      await tx
        .update(doughRecipesTable)
        .set({ doughballVariants: collapsed, updatedAt: new Date() })
        .where(
          and(
            eq(doughRecipesTable.id, row.id),
            eq(doughRecipesTable.scope, row.scope),
          ),
        );
      updatedRows++;
      removedVariants += before.length - collapsed.length;
    }

    logger.info(
      {
        heal: DOUGH_VARIANT_SUFFIX_DEDUPE_HEAL_ID,
        scanned: rows.length,
        updatedRows,
        removedVariants,
      },
      "Data heal applied",
    );
  });
}

// ── Vanished dough-merge restore (Lowe's French Fry) ────────────────────────
// Merging recipe names in Manage Lists deleted every SOURCE pool row even when
// the picked TARGET name had no pool row of its own — nothing survived, so the
// merged dough vanished from the factory-wide pool. On 2026-07-18 this
// destroyed "LOWE'S FRENCH FRY RECIPE" (an empty spec-import stub) and
// "LOWE'S HEAVY FRENCH FRY DOUGH" (the real recipe). The client now renames a
// source to the target instead of orphan-deleting; this heal restores the lost
// recipe from its saved import parse (saved_spec_sheets id 140/176 — the
// deterministic source of the deleted row's data) under the fresh,
// untombstoned name "Lowe's French Fry Dough", and re-points today-and-future
// day-state run values that still reference the deleted names. Guarded: the
// insert is skipped if any Lowe's french-fry dough row already exists (e.g.
// the user re-imported before this shipped).

const DOUGH_MERGE_VANISH_HEAL_ID = "dough-merge-vanish-restore-v1";
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

async function runDoughMergeVanishRestore(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: DOUGH_MERGE_VANISH_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

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

    logger.info(
      { heal: DOUGH_MERGE_VANISH_HEAL_ID, restored, repointTo, repointedDays },
      "Data heal applied",
    );
  });
}

// ── Cross-linked saved spec parse purge (Basha's ↔ Lowe's/Hannaford) ────────
// Before spec-import v15, the snap-to-existing passes silently renamed
// imported recipes onto merely SIMILAR pool names. Prod evidence: the Jul 16
// Basha's Ultra Thin saved parse stored its 5-cheese blend as
// "Lowe's/Hannaford 5Cheese Mix" (recipe name AND profile applicator types) —
// a different customer's recipe. Re-imports of a byte-identical file reuse
// saved parses, and the saved-sheet reconcile panel cross-references them
// against current recipes, so the poisoned snapshot keeps resurrecting the
// mislink even after the code fix. Delete any Basha's-sourced saved parse
// that embeds the cross-linked name (all scopes — sandbox copies carry the
// same poison). The corrected Jul 19 parse names the recipe properly and is
// untouched. The parse-version bump (v15) already prevents hash-reuse of
// other stale parses.

const CROSSLINK_PARSE_HEAL_ID = "basha-hannaford-crosslink-parse-purge-v1";

async function runCrosslinkedSavedParsePurge(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: CROSSLINK_PARSE_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    const deleted = await tx
      .delete(savedSpecSheetsTable)
      .where(
        and(
          sql`lower(coalesce(${savedSpecSheetsTable.sourceKey}, '')) like ${"basha%"}`,
          sql`${savedSpecSheetsTable.data}::text ilike ${"%lowe's/hannaford%"}`,
        ),
      )
      .returning({ id: savedSpecSheetsTable.id });

    logger.info(
      { heal: CROSSLINK_PARSE_HEAL_ID, deletedRows: deleted.length },
      "Data heal applied",
    );
  });
}

// ── Aldo's cheese-mix tolerance-column oz depoison ──────────────────────────
// The Aldo's spec grid lists the SAME cheese mix on two applicator stations;
// the second station's row reads "name | 2.9 | 0.2 | 0.1" where 2.9 is the
// station weight (the sheet's TARGET WEIGHT sums confirm it) and 0.2/0.1 are
// trailing check/tolerance columns. The AI parse took 0.2 as the second
// station's ozPerPizza, and applySpecImport wrote it into every Aldo's
// profile (prod evidence: app3OzPerPizza=0.2 with app3CheeseRecipeName
// "Aldo's Standard Cheese Mix"). The prompt now pins the weight to the first
// numeric cell after the name (SPEC_PARSE_VERSION 16), but the poison is
// already stored in profiles, the saved parse (which Auto-Fill reads
// directly), and possibly today's day-state. Heal rule, deliberately narrow:
// a 0.2-oz applicator whose type/recipe name is "Aldo's Standard Cheese Mix"
// (ci) while a SAME-profile applicator of the same name carries >= 2 oz takes
// that sibling's weight (2.9, or 3.65 on the plain CHEESE flavor — the sheet
// repeats the station weight on both rows). Genuine small second stations of
// DIFFERENT mixes (Nob Hill 0.75, Hannaford 0.85) are untouched by both the
// name and the 0.2 equality guard.

const ALDO_CHEESE_OZ_HEAL_ID = "aldo-cheese-tolerance-oz-v1";
const ALDO_CHEESE_MIX_NAME = "aldo's standard cheese mix";
const ALDO_OZ_HEAL_FROM_DATE = "2026-07-19";

function isAldoCheeseMixName(name: unknown): boolean {
  return (
    typeof name === "string" && name.trim().toLowerCase() === ALDO_CHEESE_MIX_NAME
  );
}

/**
 * Fix poisoned 0.2-oz Aldo's cheese-mix slots on a flat run/profile values
 * object (app1..app4 field style). Returns true when anything changed.
 */
export function healAldoCheeseOzInValues(
  values: Record<string, unknown>,
): boolean {
  const slots = [1, 2, 3, 4] as const;
  let donor = 0;
  for (const n of slots) {
    if (
      isAldoCheeseMixName(values[`app${n}CheeseRecipeName`]) &&
      typeof values[`app${n}OzPerPizza`] === "number" &&
      (values[`app${n}OzPerPizza`] as number) >= 2
    ) {
      donor = Math.max(donor, values[`app${n}OzPerPizza`] as number);
    }
  }
  if (donor <= 0) return false;
  let changed = false;
  for (const n of slots) {
    if (
      isAldoCheeseMixName(values[`app${n}CheeseRecipeName`]) &&
      values[`app${n}OzPerPizza`] === 0.2
    ) {
      values[`app${n}OzPerPizza`] = donor;
      changed = true;
    }
  }
  return changed;
}

async function runAldoCheeseOzDepoison(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: ALDO_CHEESE_OZ_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    // 1) Saved spec parses (Auto-Fill reads these directly; hash reuse is
    //    already fenced off by the SPEC_PARSE_VERSION bump).
    let healedSheets = 0;
    const sheets = await tx
      .select()
      .from(savedSpecSheetsTable)
      .where(
        sql`${savedSpecSheetsTable.data}::text ilike ${"%aldo's standard cheese mix%"}`,
      )
      .for("update");
    for (const sheet of sheets) {
      const data = sheet.data as {
        profiles?: Array<{
          applicators?: Array<{ type?: unknown; ozPerPizza?: unknown }>;
        }>;
      } | null;
      if (!data?.profiles) continue;
      let changed = false;
      for (const profile of data.profiles) {
        const apps = profile?.applicators;
        if (!Array.isArray(apps)) continue;
        let donor = 0;
        for (const a of apps) {
          if (
            isAldoCheeseMixName(a?.type) &&
            typeof a?.ozPerPizza === "number" &&
            a.ozPerPizza >= 2
          ) {
            donor = Math.max(donor, a.ozPerPizza);
          }
        }
        if (donor <= 0) continue;
        for (const a of apps) {
          if (isAldoCheeseMixName(a?.type) && a?.ozPerPizza === 0.2) {
            a.ozPerPizza = donor;
            changed = true;
          }
        }
      }
      if (!changed) continue;
      await tx
        .update(savedSpecSheetsTable)
        .set({ data })
        .where(eq(savedSpecSheetsTable.id, sheet.id));
      healedSheets++;
    }

    // 2) Brand profiles (LWW stamp advanced so stale devices can't re-publish
    //    the poisoned value).
    let healedProfiles = 0;
    const profiles = await tx.select().from(brandProfilesTable).for("update");
    for (const p of profiles) {
      const values = { ...(p.values ?? {}) } as Record<string, unknown>;
      if (!healAldoCheeseOzInValues(values)) continue;
      const stamp = Math.max((p.updatedAtMs ?? 0) + 1, Date.now());
      await tx
        .update(brandProfilesTable)
        .set({ values, updatedAtMs: stamp })
        .where(
          and(
            eq(brandProfilesTable.key, p.key),
            eq(brandProfilesTable.scope, p.scope),
          ),
        );
      healedProfiles++;
    }

    // 3) Today-and-future day-state run values (past days are history).
    let healedDays = 0;
    const days = await tx
      .select()
      .from(dailySyncTable)
      .where(gte(dailySyncTable.date, ALDO_OZ_HEAL_FROM_DATE))
      .for("update");
    for (const day of days) {
      const data = day.data as Record<string, unknown> | null;
      const runValues = data?.runValues as
        | Record<string, Record<string, unknown>>
        | undefined;
      if (!runValues || typeof runValues !== "object") continue;
      let changed = false;
      for (const vals of Object.values(runValues)) {
        if (!vals || typeof vals !== "object") continue;
        if (healAldoCheeseOzInValues(vals)) {
          // Advance the per-field-set LWW stamp monotonically so peers
          // holding the poisoned value can't merge it back.
          const prev = Number(vals.valuesUpdatedAtMs ?? 0);
          vals.valuesUpdatedAtMs = Math.max(prev + 1, Date.now());
          changed = true;
        }
      }
      if (!changed) continue;
      await tx
        .update(dailySyncTable)
        .set({ data })
        .where(
          and(
            eq(dailySyncTable.date, day.date),
            eq(dailySyncTable.scope, day.scope),
          ),
        );
      healedDays++;
    }

    logger.info(
      {
        heal: ALDO_CHEESE_OZ_HEAL_ID,
        healedSheets,
        healedProfiles,
        healedDays,
      },
      "Data heal applied",
    );
  });
}

// ── Bobo cross-family alias undo (2026-07-19) ───────────────────────────────
// A spec re-import review pick learned the context-free alias
// `appType: "Bobo Breakfast Mix" → "Bobo's Breakfast Cheese Mix"` (+ the
// mirrored shared-corrections row). Those are DIFFERENT products: the sheet's
// "Bobo Breakfast Mix" applicator is the egg/bacon premix, while "Bobo's
// Breakfast Cheese Mix" is the mozzarella/cheddar blend on the other stations.
// Every later import auto-applied the rename, so the saved spec parse baked
// the cheese blend's name into the premix station and Auto-Fill kept nagging
// the (correct) profile with a false Type + Recipe mismatch. This heal:
//   1. re-runs the alias sanitize purge — the new cross-family guard in
//      sanitizeSpecAliases now drops this row (and any other appType alias
//      that adds/removes "cheese" between a mix-family and cheese-family
//      name), all scopes;
//   2. deletes the mirrored shared-corrections rows for the exact pair (any
//      domain — this exact pair can never be a legitimate mapping);
//   3. restores the sheet's verbatim applicator name in saved spec parses:
//      an applicator whose type is (ci) "Bobo's Breakfast Cheese Mix" can
//      ONLY be alias poison — the full pool name never appears as a raw
//      applicator label in any source workbook (corpus-verified; the raw
//      labels are "Bobo Breakfast Cheese" / "Bobo Breakfast Mix").
// Re-learning is permanently blocked by the cross-family guard now enforced
// in sanitizeSpecAliases, the applySpecMatches learn loop, and the server
// POST backstop.

const BOBO_CROSS_FAMILY_HEAL_ID = "bobo-cross-family-alias-undo-v1";
const BOBO_POISONED_CANONICAL = "bobo's breakfast cheese mix";
const BOBO_VERBATIM_EXTERNAL = "Bobo Breakfast Mix";

/**
 * Restore the verbatim sheet name on poisoned applicator entries of one saved
 * spec parse. Returns true when anything changed. Exported for unit tests.
 */
export function healBoboApplicatorsInParse(data: {
  profiles?: Array<{ applicators?: Array<{ type?: unknown }> }>;
}): boolean {
  let changed = false;
  for (const profile of data?.profiles ?? []) {
    const apps = profile?.applicators;
    if (!Array.isArray(apps)) continue;
    for (const a of apps) {
      if (
        typeof a?.type === "string" &&
        a.type.trim().toLowerCase() === BOBO_POISONED_CANONICAL
      ) {
        a.type = BOBO_VERBATIM_EXTERNAL;
        changed = true;
      }
    }
  }
  return changed;
}

async function runBoboCrossFamilyAliasUndo(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: BOBO_CROSS_FAMILY_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    // 1) Re-run the alias sanitize purge (per scope — conflict detection must
    // only look at aliases applied together); the new cross-family guard
    // drops the poisoned row plus any sibling cross-family appType aliases.
    const rows = await tx.select().from(specImportAliasesTable).for("update");
    const byScope = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byScope.get(row.scope);
      if (list) list.push(row);
      else byScope.set(row.scope, [row]);
    }
    const dropIds: number[] = [];
    for (const scopeRows of byScope.values()) {
      const entries: SpecAliasEntry[] = scopeRows.map((r) => ({
        kind: r.kind as SpecAliasEntry["kind"],
        externalName: r.externalName,
        canonicalName: r.canonicalName,
        context: r.context,
      }));
      const kept = new Set(sanitizeSpecAliases(entries));
      for (let i = 0; i < scopeRows.length; i++) {
        if (!kept.has(entries[i])) dropIds.push(scopeRows[i].id);
      }
    }
    let deletedAliases = 0;
    for (const id of dropIds) {
      const a = await tx
        .delete(specImportAliasesTable)
        .where(eq(specImportAliasesTable.id, id))
        .returning({ id: specImportAliasesTable.id });
      deletedAliases += a.length;
    }

    // 2) Mirrored shared-corrections rows for the exact pair (any domain).
    const corrections = await tx
      .delete(aiCorrectionsTable)
      .where(
        and(
          eq(sql`lower(trim(${aiCorrectionsTable.fromText}))`, "bobo breakfast mix"),
          eq(sql`lower(trim(${aiCorrectionsTable.toText}))`, BOBO_POISONED_CANONICAL),
        ),
      )
      .returning({ id: aiCorrectionsTable.id });

    // 3) Saved spec parses (all scopes — Auto-Fill reads these directly).
    let healedSheets = 0;
    const sheets = await tx
      .select()
      .from(savedSpecSheetsTable)
      .where(
        sql`${savedSpecSheetsTable.data}::text ilike ${"%bobo's breakfast cheese mix%"}`,
      )
      .for("update");
    for (const sheet of sheets) {
      const data = sheet.data as Parameters<typeof healBoboApplicatorsInParse>[0] | null;
      if (!data || !healBoboApplicatorsInParse(data)) continue;
      await tx
        .update(savedSpecSheetsTable)
        .set({ data })
        .where(eq(savedSpecSheetsTable.id, sheet.id));
      healedSheets++;
    }

    logger.info(
      {
        heal: BOBO_CROSS_FAMILY_HEAL_ID,
        scannedAliases: rows.length,
        deletedAliases,
        deletedCorrections: corrections.length,
        healedSheets,
      },
      "Data heal applied",
    );
  });
}

// ── Lowe's bare-"NATURAL" pep-type depoison (2026-07-20) ────────────────────
// The Lowe's 11" spec workbook writes its stick rows as
// "Pepperoni Stick - NATURAL (Hormel - 24878)"; the AI parse reduced the pep
// `type` to the bare qualifier ("Natural"/"NATURAL", and one list entry kept
// the vendor code: "NATURAL (Hormel - 24878)"). The prompt now pins pep-type
// naming (full product name, vendor parens stripped, never a bare qualifier)
// and SPEC_PARSE_VERSION 17 fences off stale parses, but the poison is stored
// in the Lowe's brand profiles, the saved parses, and synced pep-type name
// lists. Canonical target is "Pepperoni Stick - NATURAL" — the name the web
// app already uses in PEP_TYPE_RENAMES (clients also rename on read now, so
// stale local lists self-heal instead of re-pushing the bare names).

const NATURAL_PEP_HEAL_ID = "lowes-natural-pep-name-v1";
const NATURAL_PEP_CANONICAL = "Pepperoni Stick - NATURAL";
const NATURAL_PEP_HEAL_FROM_DATE = "2026-07-20";
const NATURAL_PEP_RE = /^natural(\s*\(.*\))?$/i;
const PEP_TYPE_FIELDS = ["pep1Type", "pep2Type", "pep1TypeB", "pep2TypeB"] as const;

function isBareNaturalPepName(name: unknown): boolean {
  return typeof name === "string" && NATURAL_PEP_RE.test(name.trim());
}

/**
 * Fix bare-"NATURAL" pep type fields on a flat run/profile values object.
 * Returns true when anything changed. Exported for unit tests.
 */
export function healNaturalPepInValues(
  values: Record<string, unknown>,
): boolean {
  let changed = false;
  for (const k of PEP_TYPE_FIELDS) {
    if (isBareNaturalPepName(values[k])) {
      values[k] = NATURAL_PEP_CANONICAL;
      changed = true;
    }
  }
  return changed;
}

/**
 * Rename bare-"NATURAL" entries in a pep-type name list, deduping (ci) the
 * result. Returns the healed list, or null when nothing changed. Exported
 * for unit tests.
 */
export function healNaturalPepList(list: unknown): string[] | null {
  if (!Array.isArray(list)) return null;
  let changed = false;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== "string") continue;
    const renamed = isBareNaturalPepName(item) ? NATURAL_PEP_CANONICAL : item;
    if (renamed !== item) changed = true;
    const lk = renamed.toLowerCase();
    if (seen.has(lk)) {
      changed = true;
      continue;
    }
    seen.add(lk);
    out.push(renamed);
  }
  return changed ? out : null;
}

async function runNaturalPepNameDepoison(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: NATURAL_PEP_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    // 1) Saved spec parses (Auto-Fill reads these directly; hash reuse is
    //    already fenced off by the SPEC_PARSE_VERSION bump).
    let healedSheets = 0;
    const sheets = await tx
      .select()
      .from(savedSpecSheetsTable)
      .where(sql`${savedSpecSheetsTable.data}::text ~* ${'"natural'}`)
      .for("update");
    for (const sheet of sheets) {
      const data = sheet.data as {
        profiles?: Array<{ pepperonis?: Array<{ type?: unknown }> }>;
      } | null;
      if (!data?.profiles) continue;
      let changed = false;
      for (const profile of data.profiles) {
        const peps = profile?.pepperonis;
        if (!Array.isArray(peps)) continue;
        for (const p of peps) {
          if (isBareNaturalPepName(p?.type)) {
            p.type = NATURAL_PEP_CANONICAL;
            changed = true;
          }
        }
      }
      if (!changed) continue;
      await tx
        .update(savedSpecSheetsTable)
        .set({ data })
        .where(eq(savedSpecSheetsTable.id, sheet.id));
      healedSheets++;
    }

    // 2) Brand profiles (LWW stamp advanced so stale devices can't re-publish
    //    the poisoned value).
    let healedProfiles = 0;
    const profiles = await tx.select().from(brandProfilesTable).for("update");
    for (const p of profiles) {
      const values = { ...(p.values ?? {}) } as Record<string, unknown>;
      if (!healNaturalPepInValues(values)) continue;
      const stamp = Math.max((p.updatedAtMs ?? 0) + 1, Date.now());
      await tx
        .update(brandProfilesTable)
        .set({ values, updatedAtMs: stamp })
        .where(
          and(
            eq(brandProfilesTable.key, p.key),
            eq(brandProfilesTable.scope, p.scope),
          ),
        );
      healedProfiles++;
    }

    // 3) Today-and-future day-state: pep-type name lists + run values (past
    //    days are history). Clients also rename these names on read, so a
    //    stale device's push re-heals instead of resurrecting.
    let healedDays = 0;
    const days = await tx
      .select()
      .from(dailySyncTable)
      .where(gte(dailySyncTable.date, NATURAL_PEP_HEAL_FROM_DATE))
      .for("update");
    for (const day of days) {
      const data = day.data as Record<string, unknown> | null;
      if (!data || typeof data !== "object") continue;
      let changed = false;
      const healedList = healNaturalPepList(data.pepTypes);
      if (healedList) {
        data.pepTypes = healedList;
        changed = true;
      }
      const runValues = data.runValues as
        | Record<string, Record<string, unknown>>
        | undefined;
      if (runValues && typeof runValues === "object") {
        for (const vals of Object.values(runValues)) {
          if (!vals || typeof vals !== "object") continue;
          if (healNaturalPepInValues(vals)) {
            const prev = Number(vals.valuesUpdatedAtMs ?? 0);
            vals.valuesUpdatedAtMs = Math.max(prev + 1, Date.now());
            changed = true;
          }
        }
      }
      if (!changed) continue;
      await tx
        .update(dailySyncTable)
        .set({ data })
        .where(
          and(
            eq(dailySyncTable.date, day.date),
            eq(dailySyncTable.scope, day.scope),
          ),
        );
      healedDays++;
    }

    logger.info(
      {
        heal: NATURAL_PEP_HEAL_ID,
        healedSheets,
        healedProfiles,
        healedDays,
      },
      "Data heal applied",
    );
  });
}

// ── Brand-fan dough cross-contamination heal ────────────────────────────────
// Before the "brand-fan linked-name narrowing" fix, re-importing a
// brand-anchored dough procedure fanned that dough's name/rows/weight onto
// EVERY profile of the brand (Jul 19-20, 2026): Malted Barley 13.8 landed on
// all Hannaford / Lucia's Craft / Nob Hill Craft flavors, Lowe's French Fry 15
// on most Lowe's flavors, and Lowe's Supreme even picked up Mauro's purchased
// "Pedone Crust". Scheduled day-state runs (Jul 23/24/27) carry a sibling
// poison: correct dough names but the family pool's ROOT weight (CRB 5.7 /
// Malted Barley 7.8) instead of the brand's variant weight. Expected values
// are audited against the Jul 19 saved spec parses + the dough procedures'
// doughball charts (AUDIT-REPORT-2026-07-21.md); every write is guarded on
// the CURRENT value matching a known poison, so corrected or
// manager-overridden profiles (and the clean dev snapshot) are untouched.

const BRAND_FAN_HEAL_ID = "brand-fan-dough-depoison-v1";

// Day-state: heal only the audited scheduled days and later — past days are
// history. Date literal so the heal is deterministic (fix shipped 2026-07-21;
// earliest poisoned scheduled day is 2026-07-23).
const BRAND_FAN_HEAL_FROM_DATE = "2026-07-23";

async function runBrandFanDoughDepoison(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: BRAND_FAN_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    // Live dough pool → canonical recipe rows for renamed profiles.
    const doughs = await tx.select().from(doughRecipesTable);
    const poolByScope = new Map<string, DoughPoolRow[]>();
    for (const d of doughs) {
      const comps = Array.isArray(d.components)
        ? (d.components as { ingredient?: unknown; lbs?: unknown }[])
            .filter((c) => c && typeof c === "object")
            .map((c) => ({
              ingredient: String(c.ingredient ?? ""),
              lbs: Number(c.lbs ?? 0),
            }))
        : [];
      const list = poolByScope.get(d.scope) ?? [];
      list.push({ name: d.name, components: comps });
      poolByScope.set(d.scope, list);
    }

    // 1) Brand profiles: key is `${brand}__${flavor}` lowercased.
    const profiles = await tx.select().from(brandProfilesTable).for("update");
    let healedProfiles = 0;
    for (const p of profiles) {
      const sep = p.key.indexOf("__");
      if (sep < 0) continue;
      const target = findFanTarget(p.key.slice(0, sep), p.key.slice(sep + 2));
      if (!target) continue;
      const values = (p.values ?? {}) as Record<string, unknown>;
      const healed = healFanPoisonedValues(
        values,
        target,
        poolByScope.get(p.scope) ?? [],
      );
      if (!healed) continue;
      // Advance the client LWW stamp so a device still holding the poisoned
      // values can't re-publish them over the heal with a stale stamp.
      const stamp = Math.max((p.updatedAtMs ?? 0) + 1, Date.now());
      await tx
        .update(brandProfilesTable)
        .set({ values: healed, updatedAtMs: stamp })
        .where(
          and(
            eq(brandProfilesTable.key, p.key),
            eq(brandProfilesTable.scope, p.scope),
          ),
        );
      healedProfiles++;
    }

    // 2) Scheduled day-state runs: match by dayState.runs brand+flavor → the
    // runValues entry under the run id; stamp monotonically so the heal wins
    // the additive sync merge.
    const days = await tx
      .select()
      .from(dailySyncTable)
      .where(gte(dailySyncTable.date, BRAND_FAN_HEAL_FROM_DATE))
      .for("update");
    let healedDays = 0;
    let healedRuns = 0;
    for (const day of days) {
      const data = (day.data ?? {}) as Record<string, unknown>;
      const dayState = data.dayState as Record<string, unknown> | undefined;
      const runs = Array.isArray(dayState?.runs)
        ? (dayState.runs as Record<string, unknown>[])
        : [];
      const runValues = data.runValues as
        | Record<string, Record<string, unknown>>
        | undefined;
      if (!runValues || typeof runValues !== "object") continue;
      let changed = false;
      for (const run of runs) {
        if (!run || typeof run !== "object") continue;
        const target = findFanTarget(
          String(run.brand ?? ""),
          String(run.flavor ?? ""),
        );
        if (!target) continue;
        const id = String(run.id ?? "");
        const vals = runValues[id];
        if (!vals || typeof vals !== "object") continue;
        const healed = healFanPoisonedValues(
          vals,
          target,
          poolByScope.get(day.scope) ?? [],
        );
        if (!healed) continue;
        const prev = Number(vals.valuesUpdatedAtMs ?? 0);
        healed.valuesUpdatedAtMs = Math.max(prev + 1, Date.now());
        runValues[id] = healed;
        changed = true;
        healedRuns++;
      }
      if (!changed) continue;
      await tx
        .update(dailySyncTable)
        .set({ data: { ...data } })
        .where(
          and(
            eq(dailySyncTable.date, day.date),
            eq(dailySyncTable.scope, day.scope),
          ),
        );
      healedDays++;
    }

    logger.info(
      { heal: BRAND_FAN_HEAL_ID, healedProfiles, healedDays, healedRuns },
      "Data heal applied",
    );
  });
}

// ── Drifted customer-name alignment ─────────────────────────────────────────
// A production audit found pool rows whose brand tag spells the customer
// differently than the saved product profiles ("Basha's Ultra Thin" vs
// "Basha's Ultra Thin Crust", 'FSD 7"' vs "FSD 7in", ...), so those recipes
// don't group under the customer in Manage Lists and brand-scoped import
// linking can miss them. This heal applies the existing customer-rename flow
// as data: rewrite the drifted tags to the canonical spelling across all four
// server pools (every scope — sandbox copies of the drift must not survive),
// then learn the context-free brand spec-import aliases (with chain re-point)
// so re-importing the source workbooks resolves onto the canonical customer
// instead of resurrecting the drifted spelling.

const BRAND_DRIFT_HEAL_ID = "brand-drift-rename-v1";

async function runBrandDriftRename(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: BRAND_DRIFT_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    // 1) Rewrite drifted brand tags in place (same rows keep their ids, like
    // the pool managers' rename repoint helpers). Collect every scope seen so
    // alias learning covers each populated scope.
    const scopes = new Set<string>(["live"]);
    let renamedRows = 0;
    const pools = [
      cheeseRecipesTable,
      mixesTable,
      doughRecipesTable,
      sauceRecipesTable,
    ] as const;
    for (const table of pools) {
      const rows = await tx
        .select({ id: table.id, scope: table.scope, brand: table.brand })
        .from(table)
        .for("update");
      for (const row of rows) {
        scopes.add(row.scope);
        const target = brandDriftTargetFor(row.brand ?? "");
        if (!target) continue;
        await tx
          .update(table)
          .set({ brand: target, updatedAt: new Date() })
          .where(and(eq(table.id, row.id), eq(table.scope, row.scope)));
        renamedRows++;
      }
    }

    // 2) Chain re-point existing spec-import aliases (all scopes): brand
    // aliases that resolved onto a drifted spelling now resolve onto the
    // canonical name; flavor aliases contexted to a drifted brand are
    // re-contexted so they still fire after the brand canonicalizes first.
    const aliasRows = await tx.select().from(specImportAliasesTable).for("update");
    let repointedAliases = 0;
    for (const [from, to] of BRAND_DRIFT_RENAMES) {
      for (const plan of planBrandAliasRepoints(aliasRows, from, to)) {
        if (plan.action === "delete") {
          await tx
            .delete(specImportAliasesTable)
            .where(eq(specImportAliasesTable.id, plan.row.id));
        } else {
          await tx
            .update(specImportAliasesTable)
            .set({ ...plan.set, updatedAt: new Date() })
            .where(eq(specImportAliasesTable.id, plan.row.id));
        }
        repointedAliases++;
      }
    }

    // 3) Learn the direct drifted→canonical brand aliases per scope (manual
    // upsert on the alias identity key kind+externalName+context — the table
    // has no unique constraint; the route dedupes the same way).
    let learnedAliases = 0;
    for (const scope of scopes) {
      for (const [from, to] of BRAND_DRIFT_RENAMES) {
        const existing = aliasRows.filter(
          (a) =>
            a.scope === scope &&
            a.kind === "brand" &&
            a.externalName.trim().toLowerCase() === from.trim().toLowerCase() &&
            (a.context ?? null) === null,
        );
        if (existing.length > 0) {
          for (const row of existing) {
            if (row.canonicalName === to) continue;
            await tx
              .update(specImportAliasesTable)
              .set({ canonicalName: to, updatedAt: new Date() })
              .where(eq(specImportAliasesTable.id, row.id));
            learnedAliases++;
          }
        } else {
          await tx.insert(specImportAliasesTable).values({
            scope,
            kind: "brand",
            externalName: from,
            canonicalName: to,
            context: null,
          });
          learnedAliases++;
        }
      }
    }

    logger.info(
      {
        heal: BRAND_DRIFT_HEAL_ID,
        renamedRows,
        repointedAliases,
        learnedAliases,
      },
      "Data heal applied",
    );
  });
}

// ── Heal: Populate customers arrays on CRB Dough Lucia's Craft variants ─────
// Before this heal, CRB Dough doughball variants had no customers arrays —
// Background: after spec import, Lucia's Craft BBQ Chicken received the wrong
// doughball weight because no customers arrays were populated on CRB Dough
// variants, so matchDoughballVariant's customers-based priority never fired.
//
// v1 attempted to fix this but used wrong source data: it put BBQ Chicken and
// Sweet Chili Garden into the 13.8 oz "CRB Thick" variant, but the actual
// CRB Dough Mixing Procedure (Rev. 39, 07/21/2026) shows those flavors use
// the "CRB Ultra Thin" variant (7.8 oz, labeled "Basha's Ultra Thin" in DB).
// v1 heal ID is claimed in the DB — the function no longer exists but the ID
// is kept here for traceability.
const CRB_LUCIA_CUSTOMERS_HEAL_ID = "crb-dough-lucia-variant-customers-v1";

// v2: corrected assignments sourced directly from the CRB Dough Mixing
// Procedure (Rev. 39, 07/21/2026) and Lucia's Craft Spec Sheet (Rev. 03,
// 07/23/2026):
//   "Lucia's Craft CRB Ultra Thin: Sweet Chili Garden, Backyard BBQ Chicken"
//     → 7.8 oz doughball, maps to the "Basha's Ultra Thin" label in the DB
//   "Lucia's Craft CRB Heavy Plus: Four Cheese Meltdown"
//     → 12 oz doughball, maps to "Lucia's Craft CRB Heavy Plus" label
//   "Lucia's Craft CRB Thick" (13.8 oz) — NO Lucia's Craft flavors listed
//
// v1 damaged: added all four flavors to the 13.8 oz Thick variant. v2 undoes
// that and places each flavor on the correct variant.
const CRB_LUCIA_CUSTOMERS_V2_HEAL_ID = "crb-dough-lucia-variant-customers-v2";

// Lucia's Craft flavors that use the CRB Ultra Thin variant (7.8 oz doughball).
const LUCIA_CRAFT_CRB_ULTRA_THIN_FLAVORS = [
  "Backyard BBQ Chicken",
  "Sweet Chili Garden",
];

async function runCrbLuciaVariantCustomersV2(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: CRB_LUCIA_CUSTOMERS_V2_HEAL_ID })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    const doughs = await tx.select().from(doughRecipesTable).for("update");
    const crbRows = doughs.filter((d) =>
      specImportNamedRecipeNamesEqual(d.name, "CRB Dough"),
    );
    if (crbRows.length === 0) {
      logger.info({ heal: CRB_LUCIA_CUSTOMERS_V2_HEAL_ID }, "No CRB Dough found — skipped");
      return;
    }

    let updated = 0;
    for (const row of crbRows) {
      const variants = normalizeDoughballVariants(row.doughballVariants);
      let changed = false;
      const next = variants.map((v) => {
        // "Basha's Ultra Thin" variant (~7.8 oz): used by Lucia's Craft BBQ
        // Chicken and Sweet Chili Garden (the "CRB Ultra Thin" variant per the
        // mixing procedure). Add these two specific flavors.
        if (
          Math.abs(Number(v.weightOz ?? 0) - 7.8) < 0.15 &&
          /basha|ultra[\s_-]*thin/i.test(v.label)
        ) {
          const withoutLucia = (v.customers ?? []).filter(
            (c) => c.brand.trim().toLowerCase() !== "lucia's craft",
          );
          const additions = LUCIA_CRAFT_CRB_ULTRA_THIN_FLAVORS.filter(
            (fl) =>
              !withoutLucia.some(
                (c) =>
                  c.brand.trim().toLowerCase() === "lucia's craft" &&
                  c.flavor.trim().toLowerCase() === fl.trim().toLowerCase(),
              ),
          ).map((fl) => ({ brand: "Lucia's Craft", flavor: fl }));
          if (
            additions.length === 0 &&
            withoutLucia.length === (v.customers ?? []).length
          ) {
            return v;
          }
          changed = true;
          return { ...v, customers: [...withoutLucia, ...additions] };
        }
        // "Lucia's Craft CRB Heavy Plus" variant (~12 oz): used only by Four
        // Cheese Meltdown (specific entry, not a catch-all). Replace any v1
        // catch-all with the correct specific flavor.
        if (
          Math.abs(Number(v.weightOz ?? 0) - 12) < 0.15 &&
          /lucia/i.test(v.label) &&
          /heavy/i.test(v.label)
        ) {
          const withoutLucia = (v.customers ?? []).filter(
            (c) => c.brand.trim().toLowerCase() !== "lucia's craft",
          );
          const alreadyCorrect = withoutLucia.some(
            (c) =>
              c.brand.trim().toLowerCase() === "lucia's craft" &&
              c.flavor.trim().toLowerCase() === "four cheese meltdown",
          );
          if (alreadyCorrect && withoutLucia.length === (v.customers ?? []).length) {
            return v;
          }
          changed = true;
          return {
            ...v,
            customers: [
              ...withoutLucia,
              { brand: "Lucia's Craft", flavor: "Four Cheese Meltdown" },
            ],
          };
        }
        // "Lucia's Craft CRB Thick" variant (~13.8 oz): NO Lucia's Craft flavor
        // uses this variant per the mixing procedure. Remove all Lucia's Craft
        // entries that v1 wrongly added here.
        if (
          Math.abs(Number(v.weightOz ?? 0) - 13.8) < 0.15 &&
          /lucia/i.test(v.label) &&
          /thick/i.test(v.label)
        ) {
          const filtered = (v.customers ?? []).filter(
            (c) => c.brand.trim().toLowerCase() !== "lucia's craft",
          );
          if (filtered.length === (v.customers ?? []).length) return v;
          changed = true;
          return { ...v, customers: filtered };
        }
        return v;
      });
      if (!changed) continue;
      await tx
        .update(doughRecipesTable)
        .set({ doughballVariants: next })
        .where(
          and(
            eq(doughRecipesTable.id, row.id),
            eq(doughRecipesTable.scope, row.scope),
          ),
        );
      updated++;
    }

    logger.info({ heal: CRB_LUCIA_CUSTOMERS_V2_HEAL_ID, updated }, "Data heal applied");
  });
}

// ── July 2026 import corrections ─────────────────────────────────────────────
// Eleven profiles came in with wrong weights or missing sauces from the first
// bulk spec-sheet upload. Two alias bugs also need cleaning:
//   • "Masa recipe → Masa recipe natural" mapped to a non-existent pool entry.
//   • "Naan recipe" was stored as a doughRecipeName but pool entry is "Naan Dough".
// A "Naan recipe → Naan Dough" recipeName alias is added so future re-imports
// auto-link without needing another manual patch.
const JULY_2026_PROFILE_CORRECTIONS_V1 = "july-2026-profile-corrections-v1";

async function runJuly2026ProfileCorrections(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: JULY_2026_PROFILE_CORRECTIONS_V1 })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    const profiles = await tx.select().from(brandProfilesTable).for("update");
    let healedProfiles = 0;

    for (const p of profiles) {
      const values = { ...(p.values as Record<string, unknown>) };
      let changed = false;
      const brand = p.brand.toLowerCase();
      const flavor = p.flavor.toLowerCase();

      // 11" Hannaford / Chicken Tikka Masala — dough name was "Naan recipe"
      // (not in pool); pool entry is "Naan Dough".
      if (brand === '11" hannaford' && flavor === "chicken tikka masala") {
        if (String(values.doughRecipeName ?? "").trim() === "Naan recipe") {
          values.doughRecipeName = "Naan Dough";
          changed = true;
        }
      }

      // Brand / mr07ch24 — import picked up the 12" variant weight (14.2 oz)
      // instead of the 7" variant (6.2 oz).
      if (brand === "brand" && flavor === "mr07ch24") {
        if (Math.abs(Number(values.targetDoughballWeight ?? 0) - 14.2) < 0.05) {
          values.targetDoughballWeight = 6.2;
          changed = true;
        }
      }

      // Basha's Ultra Thin Crust (all flavors) — all four flavors got the 7"
      // doughball weight (5.7 oz) instead of the thin 11" weight (7.8 oz).
      if (brand === "basha's ultra thin crust") {
        if (Math.abs(Number(values.targetDoughballWeight ?? 0) - 5.7) < 0.05) {
          values.targetDoughballWeight = 7.8;
          changed = true;
        }
      }

      // Lowe's / Spinach & Mushroom — weight 5.7 → 13 (CRB "Lowe's CRB Heavier"
      // variant), sauce was blank.
      if (brand === "lowe's" && flavor === "spinach & mushroom") {
        if (Math.abs(Number(values.targetDoughballWeight ?? 0) - 5.7) < 0.05) {
          values.targetDoughballWeight = 13;
          changed = true;
        }
        if (!String(values.frontlineRecipeName ?? "").trim()) {
          values.frontlineRecipeName = "Lucia Pizza Sauce";
          changed = true;
        }
      }

      // Nob Hill Craft Pizzas / Caribbean — weight 5.7 → 12.1 (CRB "Nob Hill
      // Craft Heavy Plus" variant), sauce was blank.
      if (brand === "nob hill craft pizzas" && flavor === "caribbean") {
        if (Math.abs(Number(values.targetDoughballWeight ?? 0) - 5.7) < 0.05) {
          values.targetDoughballWeight = 12.1;
          changed = true;
        }
        if (!String(values.frontlineRecipeName ?? "").trim()) {
          values.frontlineRecipeName = "Sweet n Sour Sauce";
          changed = true;
        }
      }

      // Lowe's / Bacon Cheeseburger — sauce was blank.
      if (brand === "lowe's" && flavor === "bacon cheeseburger") {
        if (!String(values.frontlineRecipeName ?? "").trim()) {
          values.frontlineRecipeName = "Cheeseburger Sauce";
          changed = true;
        }
      }

      // Lowe's / Caribbean — sauce was blank.
      if (brand === "lowe's" && flavor === "caribbean") {
        if (!String(values.frontlineRecipeName ?? "").trim()) {
          values.frontlineRecipeName = "Sweet n Sour Sauce";
          changed = true;
        }
      }

      // Lowe's / Red Hot Chicken — sauce was blank.
      if (brand === "lowe's" && flavor === "red hot chicken") {
        if (!String(values.frontlineRecipeName ?? "").trim()) {
          values.frontlineRecipeName = "Four Hands Red Hot Recipe";
          changed = true;
        }
      }

      // Hannaford / Four Cheese with Sweet & Spicy Chili Sauce — weight 5.7 → 12.
      if (
        brand === "hannaford" &&
        flavor === "four cheese with sweet & spicy chili sauce"
      ) {
        if (Math.abs(Number(values.targetDoughballWeight ?? 0) - 5.7) < 0.05) {
          values.targetDoughballWeight = 12;
          changed = true;
        }
      }

      // Lucia's Craft / House Dlux — weight 5.7 → 12.
      if (brand === "lucia's craft" && flavor === "house dlux") {
        if (Math.abs(Number(values.targetDoughballWeight ?? 0) - 5.7) < 0.05) {
          values.targetDoughballWeight = 12;
          changed = true;
        }
      }

      if (!changed) continue;
      const stamp = Math.max((p.updatedAtMs ?? 0) + 1, Date.now());
      await tx
        .update(brandProfilesTable)
        .set({ values, updatedAtMs: stamp })
        .where(
          and(
            eq(brandProfilesTable.key, p.key),
            eq(brandProfilesTable.scope, p.scope),
          ),
        );
      healedProfiles++;
    }

    // Delete poisoned alias: "Masa recipe" → "Masa recipe natural".
    // "Masa recipe natural" does not exist in the dough pool; future imports
    // that say "Masa recipe" would have tried to link to a ghost recipe.
    const deletedAliases = await tx
      .delete(specImportAliasesTable)
      .where(
        and(
          eq(specImportAliasesTable.kind, "recipeName"),
          eq(sql`lower(${specImportAliasesTable.externalName})`, "masa recipe"),
          eq(
            sql`lower(${specImportAliasesTable.canonicalName})`,
            "masa recipe natural",
          ),
        ),
      )
      .returning({ id: specImportAliasesTable.id });

    // Ensure "Naan recipe → Naan Dough" alias exists so future re-imports of
    // the 11" Hannaford sheet auto-link without needing another manual patch.
    const existingNaan = await tx
      .select({ id: specImportAliasesTable.id })
      .from(specImportAliasesTable)
      .where(
        and(
          eq(specImportAliasesTable.kind, "recipeName"),
          eq(sql`lower(${specImportAliasesTable.externalName})`, "naan recipe"),
        ),
      );
    let addedAliases = 0;
    if (existingNaan.length === 0) {
      await tx.insert(specImportAliasesTable).values({
        scope: "live",
        kind: "recipeName",
        externalName: "Naan recipe",
        canonicalName: "Naan Dough",
        context: "dough",
      });
      addedAliases = 1;
    }

    logger.info(
      {
        heal: JULY_2026_PROFILE_CORRECTIONS_V1,
        healedProfiles,
        deletedAliases: deletedAliases.length,
        addedAliases,
      },
      "Data heal applied",
    );
  });
}

// ── July 2026 audit corrections v2 ───────────────────────────────────────────
// Second pass after a full prod-DB audit uncovered additional issues:
//
//   • Bad alias: "Al Pastor Sauce → Tikka Masala Sauce" (learned incorrectly)
//   • brand/mr07ch24 weight 5 → 6.2 oz (7" Marriott)
//   • brand/mr12ch14 weight 5 → 14.2 oz (12" Marriott)
//   • hannaford/chicken tikka masala weight 0 → 11.5 oz (Naan, scratch-made)
//   • lowe's/red hot chicken sauce "Four Hands Red Hot Recipe"
//     → "Four Hands Red Hot Pizza Sauce" (previous heal used the wrong name)
//   • lowe's/buffalo chicken sauce blank → "Buffalo Sauce"
//   • lowe's/margherita sauce blank → "Lucia Pizza Sauce"
//   • lucia's pinsa (proof)/chicken tikka masala sauce "Masala Sauce (Rasoi)"
//     → "Tikka Masala Sauce" (resolve stored alias value to pool name)
//   • Add "Al Pastor Sauce" to sauce_recipes pool so nob hill craft/south of
//     the border profile sauce link resolves correctly
const JULY_2026_AUDIT_CORRECTIONS_V2 = "july-2026-audit-corrections-v2";

async function runJuly2026AuditCorrectionsV2(): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(dataHealsTable)
      .values({ id: JULY_2026_AUDIT_CORRECTIONS_V2 })
      .onConflictDoNothing({ target: dataHealsTable.id })
      .returning({ id: dataHealsTable.id });
    if (claimed.length === 0) return;

    // 1. Delete the bad "Al Pastor Sauce → Tikka Masala Sauce" alias.
    //    Al Pastor and Tikka Masala are completely different sauces; this was
    //    a mis-learned AI correction.
    const deletedAliases = await tx
      .delete(specImportAliasesTable)
      .where(
        and(
          eq(specImportAliasesTable.kind, "recipeName"),
          eq(sql`lower(${specImportAliasesTable.externalName})`, "al pastor sauce"),
          eq(sql`lower(${specImportAliasesTable.canonicalName})`, "tikka masala sauce"),
        ),
      )
      .returning({ id: specImportAliasesTable.id });

    // 2. Profile corrections.
    const profiles = await tx.select().from(brandProfilesTable).for("update");
    let healedProfiles = 0;

    for (const p of profiles) {
      const values = { ...(p.values as Record<string, unknown>) };
      let changed = false;
      const brand = p.brand.toLowerCase();
      const flavor = p.flavor.toLowerCase();

      // brand / mr07ch24 — 7" Marriott: weight 5 → 6.2 oz.
      if (brand === "brand" && flavor === "mr07ch24") {
        if (Math.abs(Number(values.targetDoughballWeight ?? 0) - 5) < 0.05) {
          values.targetDoughballWeight = 6.2;
          changed = true;
        }
      }

      // brand / mr12ch14 — 12" Marriott: weight 5 → 14.2 oz.
      if (brand === "brand" && flavor === "mr12ch14") {
        if (Math.abs(Number(values.targetDoughballWeight ?? 0) - 5) < 0.05) {
          values.targetDoughballWeight = 14.2;
          changed = true;
        }
      }

      // hannaford / chicken tikka masala — Naan Dough (scratch-made): weight 0 → 11.5 oz.
      if (brand === "hannaford" && flavor === "chicken tikka masala") {
        if (!(Number(values.targetDoughballWeight ?? 0) > 0)) {
          values.targetDoughballWeight = 11.5;
          changed = true;
        }
      }

      // lowe's / red hot chicken — previous heal wrote the wrong pool name.
      // "Four Hands Red Hot Recipe" → "Four Hands Red Hot Pizza Sauce".
      if (brand === "lowe's" && flavor === "red hot chicken") {
        if (String(values.frontlineRecipeName ?? "").trim() === "Four Hands Red Hot Recipe") {
          values.frontlineRecipeName = "Four Hands Red Hot Pizza Sauce";
          changed = true;
        }
      }

      // lowe's / buffalo chicken — sauce was blank.
      if (brand === "lowe's" && flavor === "buffalo chicken") {
        if (!String(values.frontlineRecipeName ?? "").trim()) {
          values.frontlineRecipeName = "Buffalo Sauce";
          changed = true;
        }
      }

      // lowe's / margherita — sauce was blank.
      if (brand === "lowe's" && flavor === "margherita") {
        if (!String(values.frontlineRecipeName ?? "").trim()) {
          values.frontlineRecipeName = "Lucia Pizza Sauce";
          changed = true;
        }
      }

      // lucia's pinsa (proof) / chicken tikka masala — sauce stored as the
      // raw alias value; resolve to the pool name "Tikka Masala Sauce".
      if (
        brand === "lucia's pinsa (proof)" &&
        flavor === "chicken tikka masala"
      ) {
        if (
          String(values.frontlineRecipeName ?? "").toLowerCase().includes("masala sauce (rasoi)")
        ) {
          values.frontlineRecipeName = "Tikka Masala Sauce";
          changed = true;
        }
      }

      if (!changed) continue;
      const stamp = Math.max((p.updatedAtMs ?? 0) + 1, Date.now());
      await tx
        .update(brandProfilesTable)
        .set({ values, updatedAtMs: stamp })
        .where(
          and(
            eq(brandProfilesTable.key, p.key),
            eq(brandProfilesTable.scope, p.scope),
          ),
        );
      healedProfiles++;
    }

    // 3. Add "Al Pastor Sauce" to the sauce_recipes pool so the
    //    nob hill craft / south of the border profile sauce link resolves.
    //    Empty components — manager fills in the recipe via the UI.
    const existingAlPastor = await tx
      .select({ id: sauceRecipesTable.id })
      .from(sauceRecipesTable)
      .where(
        eq(sql`lower(${sauceRecipesTable.name})`, "al pastor sauce"),
      );
    let addedSauces = 0;
    if (existingAlPastor.length === 0) {
      await tx.insert(sauceRecipesTable).values({
        id: "al-pastor-sauce",
        scope: "live",
        name: "Al Pastor Sauce",
        notes: "",
        components: [],
        enabled: true,
        brand: "",
        flavors: [],
      });
      addedSauces = 1;
    }

    logger.info(
      {
        heal: JULY_2026_AUDIT_CORRECTIONS_V2,
        healedProfiles,
        deletedAliases: deletedAliases.length,
        addedSauces,
      },
      "Data heal applied",
    );
  });
}

export async function runDataHeals(): Promise<void> {
  await runCheesePoisonCleanup();
  await runSpecAliasHygienePurge();
  await runCheeseDuplicateNamePurge();
  await runGenericMixPoisonPurge();
  await runCheeseMixCrossoverPurge();
  await runCheeseShareBackfill();
  await runCheeseOzDepoison();
  await runNamedRecipeNameCleanup();
  await runDoughYieldDepoison();
  await runDoughFamilyWeightDepoison();
  await runSmdPepCheeseRestore();
  await runSeaSaltAliasUndo();
  await runMixDuplicateNamePurge();
  await runPurchasedCrustDieDepoison();
  await runDoughVariantSuffixDedupe();
  await runDoughMergeVanishRestore();
  await runBogusMergeAliasPurge();
  await runCrosslinkedSavedParsePurge();
  await runAldoCheeseOzDepoison();
  await runBoboCrossFamilyAliasUndo();
  await runNaturalPepNameDepoison();
  await runBrandFanDoughDepoison();
  await runBrandDriftRename();
  await runCrbLuciaVariantCustomersV2();
  await runJuly2026ProfileCorrections();
  await runJuly2026AuditCorrectionsV2();
}
