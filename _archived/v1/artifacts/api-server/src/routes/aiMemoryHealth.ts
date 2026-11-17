import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  aiCorrectionsTable,
  facilityKnowledgeTable,
  mergeAliasesTable,
  importAliasesTable,
  mergedAwayTable,
  ingredientsTable,
  mixesTable,
  doughRecipesTable,
  sauceRecipesTable,
  cheeseRecipesTable,
  brandProfilesTable,
  dieTypesTable,
} from "@workspace/db";
import {
  auditAiMemory,
  type AiMemoryHealthInput,
  type AiMemoryHealthReport,
} from "@workspace/ai-memory";
import { currentScope } from "../lib/requestScope";
import { requireCapability } from "../middlewares/requireCapability";

// This is intentionally a manager-only, narrow maintenance surface. It does not
// expose conversation rows and it has no arbitrary delete endpoint: the only
// write route re-computes the pure audit while holding one transaction, then
// applies its pre-defined deterministic correction repairs.

const router: IRouter = Router();

type QueryExecutor = Pick<typeof db, "select">;

const KNOWN_FACILITY_SOURCES = [
  "proactive-watcher",
  "demand-forecaster",
  "forecast-accuracy",
  "waste-insight",
  "incident-report",
];

function addName(set: Set<string>, value: unknown): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (trimmed) set.add(trimmed);
}

async function loadAuditInput(executor: QueryExecutor): Promise<AiMemoryHealthInput> {
  const scope = currentScope();
  const [
    corrections,
    facilityKnowledge,
    mergeAliases,
    importAliases,
    mergedAway,
    ingredients,
    mixes,
    doughRecipes,
    sauceRecipes,
    cheeseRecipes,
    brandProfiles,
    dieTypes,
  ] = await Promise.all([
    executor.select().from(aiCorrectionsTable).where(eq(aiCorrectionsTable.scope, scope)),
    executor.select().from(facilityKnowledgeTable).where(eq(facilityKnowledgeTable.scope, scope)),
    executor.select().from(mergeAliasesTable).where(eq(mergeAliasesTable.scope, scope)),
    executor.select().from(importAliasesTable).where(eq(importAliasesTable.scope, scope)),
    executor.select().from(mergedAwayTable).where(eq(mergedAwayTable.scope, scope)),
    executor.select().from(ingredientsTable).where(eq(ingredientsTable.scope, scope)),
    executor.select().from(mixesTable).where(eq(mixesTable.scope, scope)),
    executor.select().from(doughRecipesTable).where(eq(doughRecipesTable.scope, scope)),
    executor.select().from(sauceRecipesTable).where(eq(sauceRecipesTable.scope, scope)),
    executor.select().from(cheeseRecipesTable).where(eq(cheeseRecipesTable.scope, scope)),
    executor.select().from(brandProfilesTable).where(eq(brandProfilesTable.scope, scope)),
    executor.select().from(dieTypesTable).where(eq(dieTypesTable.scope, scope)),
  ]);

  const ingredientsNames = new Set<string>();
  for (const row of ingredients) {
    if (row.enabled && !row.mergedInto) addName(ingredientsNames, row.name);
  }
  const brands = new Set<string>();
  const flavors = new Set<string>();
  const recipeNames = new Set<string>();
  const addRecipeRows = (
    rows: Array<{ enabled: boolean; name: string; brand: string; flavors?: string[] }>,
  ) => {
    for (const row of rows) {
      if (row.enabled) addName(recipeNames, row.name);
      addName(brands, row.brand);
      for (const flavor of row.flavors ?? []) addName(flavors, flavor);
    }
  };
  addRecipeRows(doughRecipes);
  addRecipeRows(sauceRecipes);
  addRecipeRows(cheeseRecipes);
  for (const row of mixes) {
    if (row.enabled) addName(recipeNames, row.name);
    addName(brands, row.brand);
    addName(flavors, row.flavor);
  }
  for (const row of brandProfiles) {
    addName(brands, row.brand);
    addName(flavors, row.flavor);
  }

  // Merge categories map onto correction domains. Flavor aliases with different
  // brand contexts can legitimately disagree, so the pure audit will mark that
  // source ambiguous rather than treating either target as canonical.
  const categoryDomain: Record<string, string> = {
    ingredient: "ingredient",
    brand: "brand",
    flavor: "flavor",
    mixes: "recipe",
    dough: "recipe",
    sauce: "recipe",
    cheese: "recipe",
  };
  return {
    corrections: corrections.map((row) => ({
      id: row.id,
      domain: row.domain,
      fromText: row.fromText,
      toText: row.toText,
    })),
    facilityKnowledge: facilityKnowledge.map((row) => ({
      id: row.id,
      domain: row.domain,
      key: row.key,
      fact: row.fact,
      source: row.source,
    })),
    canonicalAliases: [
      ...mergeAliases.map((row) => ({
        domain: categoryDomain[row.category] ?? "",
        fromText: row.externalName,
        toText: row.canonicalName,
        source: `merge alias (${row.category})`,
      })),
      // Confirmed import aliases preserve valid historic source wording even
      // when it no longer appears in a current menu or master-data list.
      ...importAliases.map((row) => ({
        domain: row.type === "flavor" ? "flavor" : "brand",
        fromText: row.externalName,
        toText: row.canonicalName,
        source: `confirmed import alias (${row.type})`,
      })),
    ].filter((row) => !!row.domain),
    activeNamesByDomain: {
      ingredient: [...ingredientsNames],
      brand: [...brands],
      flavor: [...flavors],
      recipe: [...recipeNames],
      die: dieTypes.map((row) => row.name),
    },
    mergedAwayNames: mergedAway.map((row) => row.name),
    knownFacilitySources: KNOWN_FACILITY_SOURCES,
  };
}

async function healthReport(executor: QueryExecutor): Promise<AiMemoryHealthReport> {
  return auditAiMemory(await loadAuditInput(executor));
}

router.get(
  "/ai-memory/health-check",
  requireCapability("manage-staff"),
  async (req: Request, res: Response) => {
    try {
      res.json({ report: await healthReport(db) });
    } catch (err) {
      req.log.error({ err }, "failed to audit ai memory");
      res.status(500).json({ error: "Failed to audit AI memory" });
    }
  },
);

router.post(
  "/ai-memory/health-check/apply",
  requireCapability("manage-staff"),
  async (req: Request, res: Response) => {
    try {
      const result = await db.transaction(async (tx) => {
        const before = await healthReport(tx);
        for (const repair of before.safeRepairs) {
          if (repair.action === "delete") {
            await tx
              .delete(aiCorrectionsTable)
              .where(
                and(
                  eq(aiCorrectionsTable.id, repair.correctionId),
                  eq(aiCorrectionsTable.scope, currentScope()),
                ),
              );
          } else {
            await tx
              .update(aiCorrectionsTable)
              .set({ toText: repair.after.toText, updatedAt: new Date() })
              .where(
                and(
                  eq(aiCorrectionsTable.id, repair.correctionId),
                  eq(aiCorrectionsTable.scope, currentScope()),
                ),
              );
          }
        }
        const after = await healthReport(tx);
        return {
          before,
          after,
          applied: before.safeRepairs,
          summary: {
            deleted: before.safeRepairs.filter((repair) => repair.action === "delete").length,
            retargeted: before.safeRepairs.filter((repair) => repair.action === "retarget").length,
          },
        };
      });
      res.json(result);
    } catch (err) {
      req.log.error({ err }, "failed to apply safe ai-memory repairs");
      res.status(500).json({ error: "Failed to apply safe AI-memory repairs" });
    }
  },
);

export default router;