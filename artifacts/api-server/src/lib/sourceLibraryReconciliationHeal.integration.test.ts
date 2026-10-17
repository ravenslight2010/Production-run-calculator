// Real-Postgres coverage for the reviewed 2026-08-26 source-library heal.
// Import @workspace/db only after DATABASE_URL is switched: its pool binds on
// module evaluation.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"]; let pool: DbModule["pool"];
let doughRecipesTable: DbModule["doughRecipesTable"]; let sauceRecipesTable: DbModule["sauceRecipesTable"];
let cheeseRecipesTable: DbModule["cheeseRecipesTable"]; let mixesTable: DbModule["mixesTable"];
let brandProfilesTable: DbModule["brandProfilesTable"]; let dailySyncTable: DbModule["dailySyncTable"];
let specImportAliasesTable: DbModule["specImportAliasesTable"]; let dataHealsTable: DbModule["dataHealsTable"];
let runSourceLibraryReconciliationHeal: () => Promise<void>;
let sourceLibraryReconciliationStatus: typeof import("./sourceLibraryReconciliationHeal")["sourceLibraryReconciliationStatus"];
let runProfileNameLinkStubPurge: () => Promise<void>;
let runWorkbookImportStubPurge: () => Promise<void>;
let admin: pg.Pool; let databaseName: string; let originalUrl: string | undefined;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const HEAL = "source-library-reconciliation-2026-08-26-v1";
const STUBS = [
  ["cheese:spec:basha-s-ultra-thin-crust-basha-s-ultra-thin-bbq-chicken-cheese-mix", "basha's ultra thin crust Basha's Ultra Thin BBQ Chicken Cheese Mix"],
  ["cheese:spec:basha-s-ultra-thin-crust-basha-s-ultra-thin-pepperoni-cheese-mix", "basha's ultra thin crust Basha's Ultra Thin Pepperoni Cheese Mix"],
  ["cheese:spec:basha-s-ultra-thin-crust-basha-s-ultra-thin-pepperoni-romano-cheese-mix", "basha's ultra thin crust Basha's Ultra Thin Pepperoni/Romano Cheese Mix"],
] as const;

beforeAll(async () => {
  originalUrl = process.env.DATABASE_URL; if (!originalUrl) throw new Error("DATABASE_URL must be set");
  admin = new pg.Pool({ connectionString: originalUrl }); admin.on("error", () => {});
  databaseName = `helium_reconcile_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(originalUrl); url.pathname = `/${databaseName}`;
  const pushed = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: root, env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8",
  });
  if (pushed.status !== 0) throw new Error(`push failed: ${pushed.stderr}`);
  process.env.DATABASE_URL = url.toString();
  const mod = await import("@workspace/db");
  ({ db, pool, doughRecipesTable, sauceRecipesTable, cheeseRecipesTable, mixesTable,
    brandProfilesTable, dailySyncTable, specImportAliasesTable, dataHealsTable } = mod);
  ({
    runSourceLibraryReconciliationHeal,
    runProfileNameLinkStubPurge,
    runWorkbookImportStubPurge,
  } = await import("./dataHeals"));
  ({ sourceLibraryReconciliationStatus } = await import("./sourceLibraryReconciliationHeal"));

  const report = JSON.parse(readFileSync(
    path.join(root, "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json"),
    "utf8",
  )) as {
    proposals: Array<{
      classification: string;
      table: string;
      before: Record<string, any>;
    }>;
  };
  const auditedBefore = (table: string, id: string): Record<string, any> => {
    const proposal = report.proposals.find(
      (candidate) => candidate.classification === "automatic" &&
        candidate.table === table && candidate.before.id === id,
    );
    if (!proposal) throw new Error(`Missing audited before-image for ${table}:${id}`);
    return proposal.before;
  };

  // Seed the exact, nonblank audited before-images so the repair's full-content
  // guard accepts only the reviewed source state and still proves replacement.
  await db.insert(doughRecipesTable).values({
    ...auditedBefore("dough_recipes", "dough:masa-dough"),
    scope: "live",
  } as any);
  await db.insert(sauceRecipesTable).values({
    ...auditedBefore("sauce_recipes", "sauce:bobo-s-buffalo-pizza-sauce"),
    scope: "live",
  } as any);
  await db.insert(cheeseRecipesTable).values([
    {
      ...auditedBefore("cheese_recipes", "cheese:aldo:aldo-s-standard-cheese-mix"),
      scope: "live",
    } as any,
    // An audited replacement id with a manager rename: stale id+name guard
    // must skip it rather than overwriting its nonblank components.
    { id: "cheese:basha-s-original:basha-s-original-cheese-cheese-mix", scope: "live", name: "Manager renamed replacement", components: [{ ingredient: "must survive", lbs: 7 }] },
    { id: "cheese:corner-booth:corner-bbq-chicken-cheese-mix", scope: "live", name: "Corner Booth BBQ Chicken Cheese Mix", components: [{ ingredient: "x", lbs: 1 }] },
    { id: "cheese:four-hands:4hands-chicken-bacon-club-cheese-mix", scope: "live", name: "Manager renamed", components: [{ ingredient: "x", lbs: 1 }] },
    { id: STUBS[0][0], scope: "live", name: STUBS[0][1], components: [] },
    { id: STUBS[1][0], scope: "live", name: STUBS[1][1], components: [] },
    { id: STUBS[2][0], scope: "live", name: STUBS[2][1], components: [{ ingredient: "protected", lbs: 1 }] },
    { id: "cheese:basha-s-ultra-thin:basha-s-ultra-thin-bbq-chicken-cheese-mix", scope: "live", name: "Basha's Ultra Thin BBQ Chicken Cheese Mix", components: [{ ingredient: "canonical", lbs: 1 }] },
  ]);
  await db.insert(mixesTable).values({
    ...auditedBefore("mixes", "premix--bobo-s-deluxe-bobo-s-deluxe-veggie-mix"),
    scope: "live",
  } as any);
  await db.insert(brandProfilesTable).values([
    { key: "link__profile", scope: "live", brand: "Link", flavor: "Profile",
      values: { app1CheeseRecipeName: "Corner BBQ Chicken Cheese Mix" }, updatedAtMs: 100 },
    { key: "stub__repoint", scope: "live", brand: "Stub", flavor: "Repoint",
      values: { app1CheeseRecipeName: STUBS[0][1] }, updatedAtMs: 100 },
  ]);
  await db.insert(dailySyncTable).values([
    { date: "2026-08-26", scope: "live", data: { dayState: { runs: [
      { id: "pending" }, { id: "stub-pending" }, { id: "started", startedAt: 1 }, { id: "ended-only", endedAt: 2 },
    ] }, runValues: {
      pending: { app1CheeseRecipeName: "Corner BBQ Chicken Cheese Mix" },
      "stub-pending": { app1CheeseRecipeName: STUBS[0][1] },
      started: { app1CheeseRecipeName: STUBS[1][1] },
      "ended-only": { app1CheeseRecipeName: "Corner BBQ Chicken Cheese Mix" },
    }, runValuesUpdatedAt: { pending: 10, "stub-pending": 10, started: 10 } } },
    { date: "2026-08-25", scope: "live", data: { dayState: { runs: [{ id: "history" }] },
      runValues: { history: { app1CheeseRecipeName: STUBS[1][1] } },
      runValuesUpdatedAt: { history: 10 } } },
  ]);
}, 120_000);

afterAll(async () => {
  await pool?.end().catch(() => {}); process.env.DATABASE_URL = originalUrl;
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).catch(() => {});
  await admin.end();
});

describe("runSourceLibraryReconciliationHeal", () => {
  it("preserves audited before-images and rejects stale or unreviewed repair rows", async () => {
    const beforeStatus = await sourceLibraryReconciliationStatus(db, "live");
    expect(beforeStatus.status).toBe("not-verified");
    expect(beforeStatus.heal.markerValid).toBe(false);
    expect(beforeStatus.report.path).toBe("attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json");
    expect(beforeStatus.findings.map((finding) => finding.category)).toEqual(expect.arrayContaining([
      "pool-mismatch",
      "alias-gap",
      "stale-profile-link",
      "stale-pending-run-link",
      "protected-stub",
      "unexpected-stub",
    ]));
    expect(beforeStatus.findings).toContainEqual(expect.objectContaining({
      id: `source:stub-protected:${STUBS[1][0]}`,
      category: "protected-stub",
      protectedValue: true,
    }));
    expect(beforeStatus.findings.filter((finding) => finding.category === "pool-mismatch").length).toBeLessThanOrEqual(50);
    expect(beforeStatus.summary.omittedFindings).toBeGreaterThan(0);
    expect(beforeStatus.summary.findingLimitPerCategory).toBe(50);
    expect(JSON.stringify(beforeStatus)).not.toContain('"runValues"');
    expect(JSON.stringify(beforeStatus)).not.toContain('"values"');

    // Exercise the two generic stub purges that run earlier during production
    // boot. Audited rows with nonzero legacy `amount` components are not empty
    // stubs and must survive until the source reconciliation can inspect them.
    const [doughBeforePurge] = await db.select().from(doughRecipesTable)
      .where(eq(doughRecipesTable.id, "dough:masa-dough"));
    const [sauceBeforePurge] = await db.select().from(sauceRecipesTable)
      .where(eq(sauceRecipesTable.id, "sauce:bobo-s-buffalo-pizza-sauce"));
    const [cheeseBeforePurge] = await db.select().from(cheeseRecipesTable)
      .where(eq(cheeseRecipesTable.id, "cheese:aldo:aldo-s-standard-cheese-mix"));
    const [mixBeforePurge] = await db.select().from(mixesTable)
      .where(eq(mixesTable.id, "premix--bobo-s-deluxe-bobo-s-deluxe-veggie-mix"));
    await runProfileNameLinkStubPurge();
    await runWorkbookImportStubPurge();
    const [doughAfterPurge] = await db.select().from(doughRecipesTable)
      .where(eq(doughRecipesTable.id, "dough:masa-dough"));
    const [sauceAfterPurge] = await db.select().from(sauceRecipesTable)
      .where(eq(sauceRecipesTable.id, "sauce:bobo-s-buffalo-pizza-sauce"));
    const [cheeseAfterPurge] = await db.select().from(cheeseRecipesTable)
      .where(eq(cheeseRecipesTable.id, "cheese:aldo:aldo-s-standard-cheese-mix"));
    const [mixAfterPurge] = await db.select().from(mixesTable)
      .where(eq(mixesTable.id, "premix--bobo-s-deluxe-bobo-s-deluxe-veggie-mix"));
    expect(doughAfterPurge).toEqual(doughBeforePurge);
    expect(sauceAfterPurge).toEqual(sauceBeforePurge);
    expect(cheeseAfterPurge).toEqual(cheeseBeforePurge);
    expect(mixAfterPurge).toEqual(mixBeforePurge);
    expect(await db.select().from(cheeseRecipesTable).where(eq(cheeseRecipesTable.id, STUBS[1][0]))).toHaveLength(1);
    // This audited row is fully represented in its before-image. A live edit
    // after that snapshot must block the repair; other rows also have after
    // fields absent from the retained before-image and must fail closed.
    const managerComponents = [{ ingredient: "Manager edit", lbs: 7 }];
    await db.update(sauceRecipesTable).set({ components: managerComponents })
      .where(and(eq(sauceRecipesTable.scope, "live"), eq(sauceRecipesTable.id, "sauce:bobo-s-buffalo-pizza-sauce")));
    let failure: unknown;
    try {
      await runSourceLibraryReconciliationHeal();
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      name: "RepairExecutionError",
      cause: expect.objectContaining({
        message: expect.stringContaining("Source-library reconciliation conflict: 1 stale row(s), 3 unreviewed row(s) skipped"),
      }),
    });

    const [dough] = await db.select().from(doughRecipesTable).where(eq(doughRecipesTable.id, "dough:masa-dough"));
    const [sauce] = await db.select().from(sauceRecipesTable).where(eq(sauceRecipesTable.id, "sauce:bobo-s-buffalo-pizza-sauce"));
    const [cheese] = await db.select().from(cheeseRecipesTable).where(eq(cheeseRecipesTable.id, "cheese:aldo:aldo-s-standard-cheese-mix"));
    const [mix] = await db.select().from(mixesTable).where(eq(mixesTable.id, "premix--bobo-s-deluxe-bobo-s-deluxe-veggie-mix"));
    expect(dough.components).toEqual(doughAfterPurge.components);
    expect(sauce.components).toEqual(managerComponents);
    expect(cheese.components).toEqual(cheeseAfterPurge.components);
    expect(mix.components).toEqual(mixAfterPurge.components);
    expect(mix.batchSize).toBe(mixAfterPurge.batchSize);
    expect(await db.select().from(dataHealsTable).where(eq(dataHealsTable.id, HEAL))).toHaveLength(0);
    expect(await db.select().from(specImportAliasesTable).where(and(
      eq(specImportAliasesTable.scope, "live"),
      eq(specImportAliasesTable.kind, "appType"),
      eq(specImportAliasesTable.externalName, "Corner BBQ Chicken Cheese Mix"),
    ))).toHaveLength(0);
    const statusAfterRejectedRepair = await sourceLibraryReconciliationStatus(db, "live");
    expect(statusAfterRejectedRepair.status).toBe("not-verified");
    expect(statusAfterRejectedRepair.heal.markerValid).toBe(false);
  });

  it("keeps a blocked repair retryable without replacing later manager edits", async () => {
    await db.update(brandProfilesTable).set({ values: { app1CheeseRecipeName: "Manual override" }, updatedAtMs: 9999 })
      .where(eq(brandProfilesTable.key, "link__profile"));
    let failure: unknown;
    try {
      await runSourceLibraryReconciliationHeal();
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      name: "RepairExecutionError",
      cause: expect.objectContaining({
        message: expect.stringContaining("Source-library reconciliation conflict: 1 stale row(s), 3 unreviewed row(s) skipped"),
      }),
    });
    const [profile] = await db.select().from(brandProfilesTable).where(eq(brandProfilesTable.key, "link__profile"));
    expect((profile.values as any).app1CheeseRecipeName).toBe("Manual override");
    expect(await db.select().from(dataHealsTable).where(eq(dataHealsTable.id, HEAL))).toHaveLength(0);
    const sandboxStatus = await sourceLibraryReconciliationStatus(db, "sandbox");
    expect(sandboxStatus.status).toBe("not-verified");
    expect(sandboxStatus.freshness).toBe("stale");
    expect(sandboxStatus.heal.markerValid).toBe(false);
    expect(sandboxStatus.heal.appliedAt).toBeNull();
    expect(sandboxStatus.heal.result).toEqual({
      replacements: 0,
      aliasesInserted: 0,
      repointedProfiles: 0,
      repointedRuns: 0,
      deletedStubs: 0,
    });
  });
});