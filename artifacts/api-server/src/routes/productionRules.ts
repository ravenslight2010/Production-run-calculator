import { Router, type IRouter, type Request, type Response } from "express";
import { inArray } from "drizzle-orm";
import { db, productionRulesTable, type ProductionRuleRow } from "@workspace/db";
import { SaveProductionRulesBody, DeleteProductionRulesBody } from "@workspace/api-zod";
import { normalizeRule, type ProductionRule } from "@workspace/production-rules";
import { requireRole } from "../middlewares/requireRole";

const router: IRouter = Router();

// Manager-defined, factory-wide production rules. Reading is open to any
// signed-in user (both apps evaluate rules to warn/block), while creating,
// updating, and deleting are manager-only — matching the inventory-settings
// precedent (open GET, manager-gated writes). Rules are normalized + validated
// with the shared @workspace/production-rules model so the server is the source
// of truth for what a well-formed rule is.

const MAX_BATCH = 500;

function toApiRule(row: ProductionRuleRow): ProductionRule {
  const rule: ProductionRule = {
    id: row.id,
    name: row.name,
    type: row.type as ProductionRule["type"],
    enforcement: row.enforcement as ProductionRule["enforcement"],
    enabled: row.enabled,
  };
  if (row.field !== null) rule.field = row.field;
  if (row.min !== null) rule.min = row.min;
  if (row.max !== null) rule.max = row.max;
  if (row.attribute !== null) rule.attribute = row.attribute;
  if (row.before !== null) rule.before = row.before;
  if (row.after !== null) rule.after = row.after;
  if (row.bypass && row.bypass.length > 0) rule.bypass = row.bypass;
  if (row.checklist && row.checklist.length > 0) rule.checklist = row.checklist;
  return rule;
}

// Map a validated rule onto the flat DB columns, nulling out any setting that
// does not apply to its type.
function toDbValues(rule: ProductionRule) {
  return {
    id: rule.id,
    name: rule.name,
    type: rule.type,
    enforcement: rule.enforcement,
    enabled: rule.enabled,
    field: rule.field ?? null,
    min: rule.min ?? null,
    max: rule.max ?? null,
    attribute: rule.attribute ?? null,
    before: rule.before ?? null,
    after: rule.after ?? null,
    bypass: rule.bypass ?? null,
    checklist: rule.checklist ?? null,
    updatedAt: new Date(),
  };
}

async function listAll(): Promise<ProductionRule[]> {
  const rows = await db.select().from(productionRulesTable);
  return rows.map(toApiRule);
}

router.get("/production-rules", async (req: Request, res: Response) => {
  try {
    // Rules are edited by managers and must be reflected on every client within
    // seconds. Without this, browsers cache the response (no validators/headers)
    // and serve a stale rules list — even the periodic refetch gets the cached
    // copy — so an operator keeps seeing an old/deleted rule until a full reload.
    const rules = await listAll();
    res.json({ rules });
  } catch (err) {
    req.log.error({ err }, "failed to list production rules");
    res.status(500).json({ error: "Failed to list production rules" });
  }
});

router.post(
  "/production-rules",
  requireRole("manager"),
  async (req: Request, res: Response) => {
    const parsed = SaveProductionRulesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    // Normalize + drop malformed rules, then dedupe by id (last write wins) so a
    // single request can't fight itself with two values for the same id.
    const byId = new Map<string, ProductionRule>();
    for (const raw of parsed.data.rules.slice(0, MAX_BATCH)) {
      const rule = normalizeRule(raw);
      if (rule) byId.set(rule.id, rule);
    }

    try {
      for (const rule of byId.values()) {
        const values = toDbValues(rule);
        await db
          .insert(productionRulesTable)
          .values(values)
          .onConflictDoUpdate({
            target: productionRulesTable.id,
            set: {
              name: values.name,
              type: values.type,
              enforcement: values.enforcement,
              enabled: values.enabled,
              field: values.field,
              min: values.min,
              max: values.max,
              attribute: values.attribute,
              before: values.before,
              after: values.after,
              bypass: values.bypass,
              checklist: values.checklist,
              updatedAt: values.updatedAt,
            },
          });
      }
      const rules = await listAll();
      res.json({ rules });
    } catch (err) {
      req.log.error({ err }, "failed to save production rules");
      res.status(500).json({ error: "Failed to save production rules" });
    }
  },
);

router.delete(
  "/production-rules",
  requireRole("manager"),
  async (req: Request, res: Response) => {
    const parsed = DeleteProductionRulesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    const ids = parsed.data.ids
      .slice(0, MAX_BATCH)
      .map((id) => (typeof id === "string" ? id.trim() : ""))
      .filter((id) => id.length > 0);

    try {
      if (ids.length > 0) {
        await db.delete(productionRulesTable).where(inArray(productionRulesTable.id, ids));
      }
      const rules = await listAll();
      res.json({ rules });
    } catch (err) {
      req.log.error({ err }, "failed to delete production rules");
      res.status(500).json({ error: "Failed to delete production rules" });
    }
  },
);

export default router;
