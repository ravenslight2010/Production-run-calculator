import { and, eq, gte, sql } from "drizzle-orm";
import {
  db,
  dataHealsTable,
  dailySyncTable,
  specImportAliasesTable,
  aiCorrectionsTable,
  importAliasesTable,
  cheeseRecipesTable,
  mixesTable,
  doughRecipesTable,
  sauceRecipesTable,
  brandProfilesTable,
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
import { normalizeDoughballVariants } from "@workspace/named-recipes";
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

/**
 * Run all pending one-time data heals. Best-effort: callers must catch — a
 * failed heal logs and leaves its marker unclaimed (the transaction rolls
 * back), so it retries on the next boot.
 */
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
}
