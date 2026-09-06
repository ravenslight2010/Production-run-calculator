import { and, eq, sql } from "drizzle-orm";
import {
  brandProfilesTable,
  cheeseRecipesTable,
  dailySyncTable,
  doughRecipesTable,
  mergeAliasesTable,
  mixesTable,
  sauceRecipesTable,
  savedSpecSheetsTable,
} from "@workspace/db";
import { resolveImportName, type ImportMergeAliasMap } from "@workspace/spec-import";
import type { RepairDefinition, RepairTransaction } from "../repairRegistry";

export const PROFILE_NAME_LINK_STUB_PURGE_ID = "profile-name-link-stub-purge-v1";
export const PROFILE_NAME_LINK_STUB_PURGE_REPAIR_ID = PROFILE_NAME_LINK_STUB_PURGE_ID;

const ciName = (s: unknown): string => String(s ?? "").trim().toLowerCase();

type SnapshotNames = { sauceName?: string; doughName?: string };

export const profileNameLinkStubPurgeRepair: RepairDefinition<RepairTransaction> = Object.freeze({
  id: PROFILE_NAME_LINK_STUB_PURGE_ID,
  owner: "import-review",
  dependencies: Object.freeze(["hannaford-tikka-masala-fix-v1"]),
  eligibility: "Profiles with a latest saved-spec name source and no started run may be corrected; only unreferenced zero-value recipe stubs are deleted.",
  mode: "automatic",
  executionMode: "runner-transactional",
  resultOwnership: "runner-marker",
  managerAllowed: false,
  safety: Object.freeze({
    affectedScope: "Profiles with saved-spec sauce or dough names, plus unreferenced zero-value dough, sauce, cheese, and mix rows.",
    excludedScope: "Started-run profiles, profiles without saved snapshots, merge-target links, referenced rows, and mixes with live progress or batch size.",
    rollback: "The marker retains grouped counts; restoring a changed link or deleted stub requires reviewed source data.",
    evidence: "Latest saved-spec snapshots, merge aliases, persisted profile/day references, and zero-value component predicates.",
  }),
  async execute(tx) {
    // Recipe references are text fields rather than foreign keys. Serialize
    // profile/day writes with the scan and deletes so a writer that already
    // holds a row lock commits before we decide whether a recipe is orphaned.
    // This also covers another API replica serving while this one starts.
    await tx.execute(sql`LOCK TABLE ${brandProfilesTable} IN SHARE ROW EXCLUSIVE MODE`);
    await tx.execute(sql`LOCK TABLE ${dailySyncTable} IN SHARE ROW EXCLUSIVE MODE`);

    // Latest snapshot names per scope+brand+flavor (newest sheet wins).
    const sheets = await tx
      .select()
      .from(savedSpecSheetsTable)
      .orderBy(sql`${savedSpecSheetsTable.createdAt} DESC, ${savedSpecSheetsTable.id} DESC`);
    const snapByProfile = new Map<string, SnapshotNames>();
    for (const sheet of sheets) {
      const data = sheet.data as { profiles?: unknown } | null;
      const profiles = Array.isArray(data?.profiles) ? (data!.profiles as Array<Record<string, unknown>>) : [];
      for (const p of profiles) {
        if (!p || typeof p !== "object") continue;
        const key = `${sheet.scope}\u0000${ciName(p.brand)}\u0000${ciName(p.flavor)}`;
        if (snapByProfile.has(key)) continue; // newest-first: first wins
        snapByProfile.set(key, {
          sauceName: typeof p.sauceName === "string" ? p.sauceName.trim() : undefined,
          doughName: typeof p.doughName === "string" ? p.doughName.trim() : undefined,
        });
      }
    }

    // Merge aliases (sauce + dough) per scope, plus canonical-name sets: a
    // stored name that IS a merge target was re-pointed intentionally by a
    // manager merge and must not be reverted to the (older) spec name.
    const aliasRows = await tx
      .select()
      .from(mergeAliasesTable)
      .where(sql`${mergeAliasesTable.category} IN ('sauce', 'dough')`);
    const aliasesByScope = new Map<string, ImportMergeAliasMap>();
    const canonicalByScope = new Map<string, { sauce: Set<string>; dough: Set<string> }>();
    for (const a of aliasRows) {
      const cat = a.category as "sauce" | "dough";
      let map = aliasesByScope.get(a.scope);
      if (!map) aliasesByScope.set(a.scope, (map = {}));
      const list = ((map as Record<string, unknown>)[cat] ??= []) as Array<{
        externalName: string;
        canonicalName: string;
      }>;
      list.push({ externalName: a.externalName, canonicalName: a.canonicalName });
      let canon = canonicalByScope.get(a.scope);
      if (!canon) canonicalByScope.set(a.scope, (canon = { sauce: new Set(), dough: new Set() }));
      canon[cat].add(ciName(a.canonicalName));
    }

    // Brand+flavor pairs of STARTED runs (any date) per scope — their profile
    // snapshots are frozen by design and must not be rewritten.
    const days = await tx.select().from(dailySyncTable);
    const startedPairs = new Set<string>();
    for (const day of days) {
      const data = day.data as Record<string, unknown> | null;
      const runs = Array.isArray(data?.runs) ? (data!.runs as Array<Record<string, unknown>>) : [];
      for (const r of runs) {
        if (!r || typeof r !== "object") continue;
        if (r.startedAt == null) continue;
        startedPairs.add(`${day.scope}\u0000${ciName(r.brand)}\u0000${ciName(r.flavor)}`);
      }
    }

    // Correct mismatched profile name links.
    const profiles = await tx.select().from(brandProfilesTable).for("update");
    let correctedProfiles = 0;
    let skippedStarted = 0;
    for (const p of profiles) {
      const profKey = `${p.scope}\u0000${ciName(p.brand)}\u0000${ciName(p.flavor)}`;
      const snap = snapByProfile.get(profKey);
      if (!snap) continue; // no snapshot — no source of truth, leave untouched
      const aliasMap = aliasesByScope.get(p.scope);
      const canon = canonicalByScope.get(p.scope);
      const values = { ...(p.values as Record<string, unknown>) };
      const fields: Array<{
        field: "frontlineRecipeName" | "doughRecipeName";
        specName: string | undefined;
        cat: "sauce" | "dough";
      }> = [
        { field: "frontlineRecipeName", specName: snap.sauceName, cat: "sauce" },
        { field: "doughRecipeName", specName: snap.doughName, cat: "dough" },
      ];
      let wouldChange = false;
      for (const { field, specName, cat } of fields) {
        if (!specName) continue;
        const resolved = resolveImportName(specName, cat, aliasMap);
        if (!resolved) continue;
        const stored = String(values[field] ?? "").trim();
        if (ciName(stored) === ciName(resolved)) continue;
        // Stored name is a merge target (canonical_name) — intentional, keep.
        if (stored && canon?.[cat].has(ciName(stored))) continue;
        wouldChange = true;
        values[field] = resolved;
      }
      if (!wouldChange) continue;
      if (startedPairs.has(profKey)) {
        skippedStarted++;
        continue;
      }
      const stamp = Math.max((p.updatedAtMs ?? 0) + 1, Date.now());
      await tx
        .update(brandProfilesTable)
        .set({ values, updatedAtMs: stamp })
        .where(and(eq(brandProfilesTable.key, p.key), eq(brandProfilesTable.scope, p.scope)));
      correctedProfiles++;
    }

    // Collect every persisted recipe-name reference (using corrected profile
    // values) per scope. Historical and started run snapshots are immutable,
    // but their text links must still keep a zero-value recipe from being
    // deleted out from under production history.
    const doughRefs = new Set<string>();
    const sauceRefs = new Set<string>();
    const slotRefs = new Set<string>(); // cheese recipes + mixes (applicator slots)
    const addRefs = (scope: string, vals: Record<string, unknown> | null | undefined) => {
      if (!vals || typeof vals !== "object") return;
      const dough = ciName(vals.doughRecipeName);
      if (dough) doughRefs.add(`${scope}\u0000${dough}`);
      const sauce = ciName(vals.frontlineRecipeName);
      if (sauce) sauceRefs.add(`${scope}\u0000${sauce}`);
      for (const f of [
        "app1CheeseRecipeName",
        "app2CheeseRecipeName",
        "app3CheeseRecipeName",
        "app4CheeseRecipeName",
      ]) {
        const n = ciName(vals[f]);
        if (n) slotRefs.add(`${scope}\u0000${n}`);
      }
    };
    // Re-read after profile correction and immediately before selecting purge
    // candidates. Under the table locks this is the final committed reference
    // set that can exist for the duration of the conditional deletes.
    const finalProfiles = await tx.select().from(brandProfilesTable);
    const finalDays = await tx.select().from(dailySyncTable);
    for (const p of finalProfiles) {
      addRefs(p.scope, p.values as Record<string, unknown>);
      addRefs(p.scope, p.crustValues as Record<string, unknown>);
    }
    for (const day of finalDays) {
      const data = day.data as Record<string, unknown> | null;
      const runValues =
        data?.runValues && typeof data.runValues === "object" && !Array.isArray(data.runValues)
          ? (data.runValues as Record<string, unknown>)
          : {};
      for (const values of Object.values(runValues)) {
        if (!values || typeof values !== "object" || Array.isArray(values)) continue;
        addRefs(day.scope, values as Record<string, unknown>);
      }
    }

    // Orphaned zero-value stub purge. A stub has NO non-zero component amount;
    // an orphan additionally has no profile or production-run reference.
    const num = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const isZeroNamedComponents = (components: unknown): boolean =>
      !Array.isArray(components) ||
      components.every((c) => {
        if (!c || typeof c !== "object") return true;
        const row = c as Record<string, unknown>;
        return num(row.lbs) <= 0 && num(row.ozPerPizza) <= 0 && num(row.perPizza) <= 0;
      });

    let removedDough = 0;
    let removedSauce = 0;
    let removedCheese = 0;
    let removedMix = 0;

    const doughRows = await tx.select().from(doughRecipesTable).for("update");
    for (const r of doughRows) {
      if (!isZeroNamedComponents(r.components)) continue;
      if (doughRefs.has(`${r.scope}\u0000${ciName(r.name)}`)) continue;
      await tx
        .delete(doughRecipesTable)
        .where(and(eq(doughRecipesTable.id, r.id), eq(doughRecipesTable.scope, r.scope)));
      removedDough++;
    }

    const sauceRows = await tx.select().from(sauceRecipesTable).for("update");
    for (const r of sauceRows) {
      if (!isZeroNamedComponents(r.components)) continue;
      if (sauceRefs.has(`${r.scope}\u0000${ciName(r.name)}`)) continue;
      await tx
        .delete(sauceRecipesTable)
        .where(and(eq(sauceRecipesTable.id, r.id), eq(sauceRecipesTable.scope, r.scope)));
      removedSauce++;
    }

    const cheeseRows = await tx.select().from(cheeseRecipesTable).for("update");
    for (const r of cheeseRows) {
      if (!isZeroNamedComponents(r.components)) continue;
      if (slotRefs.has(`${r.scope}\u0000${ciName(r.name)}`)) continue;
      await tx
        .delete(cheeseRecipesTable)
        .where(and(eq(cheeseRecipesTable.id, r.id), eq(cheeseRecipesTable.scope, r.scope)));
      removedCheese++;
    }

    const mixRows = await tx.select().from(mixesTable).for("update");
    for (const r of mixRows) {
      if (!isZeroNamedComponents(r.components)) continue;
      // A mix with live "already made" progress or a stated batch size carries
      // real data even with zero per-pizza rows — never treat it as a stub.
      if (num(r.batchSize) > 0 || num(r.amountAlreadyMade) > 0) continue;
      if (slotRefs.has(`${r.scope}\u0000${ciName(r.name)}`)) continue;
      await tx
        .delete(mixesTable)
        .where(and(eq(mixesTable.id, r.id), eq(mixesTable.scope, r.scope)));
      removedMix++;
    }

    const result = {
      scannedProfiles: profiles.length,
      correctedProfiles,
      skippedStarted,
      removedStubs: {
        dough: removedDough,
        sauce: removedSauce,
        cheese: removedCheese,
        mix: removedMix,
      },
    };
    return result;
  },
});