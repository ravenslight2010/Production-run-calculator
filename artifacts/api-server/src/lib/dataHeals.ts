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
} from "@workspace/db";
import { logger } from "./logger";
import { sanitizeSpecAliases, isGenericSlotTypeName, type SpecImportAlias as SpecAliasEntry } from "@workspace/spec-import";
import {
  POISONED_CHEESE_ALIAS_PAIRS,
  POISONED_FLAVOR_PAIR,
  POISONED_FLAVOR_BRAND_CONTEXT,
  healCheesePicksInPayload,
} from "./cheesePickHeal";

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
}
