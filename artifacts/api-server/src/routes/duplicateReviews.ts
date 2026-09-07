import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  duplicateReviewGroupsTable,
  type DuplicateReviewGroup,
} from "@workspace/db";
import {
  ResolveDuplicateReviewBody,
  SaveDuplicateReviewsBody,
} from "@workspace/api-zod";
import type { MergeSuggestCategory } from "@workspace/merge-suggest";
import { currentScope } from "../lib/requestScope";
import { requireCapability } from "../middlewares/requireCapability";

const router: IRouter = Router();

const MAX_GROUPS = 1000;
const MAX_NAME_LEN = 200;
const MAX_KEY_LEN = 500;
const CATEGORIES: MergeSuggestCategory[] = [
  "ingredient",
  "mixes",
  "dough",
  "sauce",
  "cheese",
  "brand",
  "flavor",
];

type ApiDuplicateReviewGroup = {
  groupKey: string;
  category: MergeSuggestCategory;
  brand: string | null;
  target: string;
  sources: string[];
  status: "pending" | "resolved" | "ignored";
};

function normalizeName(raw: unknown): string {
  return (typeof raw === "string" ? raw : "").trim().slice(0, MAX_NAME_LEN);
}

function normalizeGroupKey(raw: unknown): string {
  return (typeof raw === "string" ? raw : "").trim().slice(0, MAX_KEY_LEN);
}

function normalizeCategory(raw: unknown): MergeSuggestCategory | null {
  const category = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (CATEGORIES as string[]).includes(category)
    ? (category as MergeSuggestCategory)
    : null;
}

function normalizeGroup(raw: {
  groupKey?: unknown;
  category?: unknown;
  brand?: unknown;
  target?: unknown;
  sources?: unknown;
}): {
  groupKey: string;
  category: MergeSuggestCategory;
  brand: string | null;
  target: string;
  sources: string[];
} | null {
  const groupKey = normalizeGroupKey(raw.groupKey);
  const category = normalizeCategory(raw.category);
  const target = normalizeName(raw.target);
  const brand = category === "flavor" ? normalizeName(raw.brand) || null : null;
  if (!groupKey || !category || !target || !Array.isArray(raw.sources)) return null;

  const sources = [...new Set(
    raw.sources
      .map(normalizeName)
      .filter((source) => source && source.toLowerCase() !== target.toLowerCase()),
  )];
  if (sources.length === 0) return null;
  return { groupKey, category, brand, target, sources };
}

function toApiGroup(row: DuplicateReviewGroup): ApiDuplicateReviewGroup | null {
  const category = normalizeCategory(row.category);
  const status = row.status === "resolved" || row.status === "ignored" ? row.status : "pending";
  const sources = Array.isArray(row.sources)
    ? row.sources.filter((source): source is string => typeof source === "string")
    : [];
  if (!category) return null;
  return {
    groupKey: row.groupKey,
    category,
    brand: row.brand,
    target: row.target,
    sources,
    status,
  };
}

async function listPending(): Promise<{ groups: ApiDuplicateReviewGroup[]; count: number }> {
  const rows = await db
    .select()
    .from(duplicateReviewGroupsTable)
    .where(and(
      eq(duplicateReviewGroupsTable.scope, currentScope()),
      eq(duplicateReviewGroupsTable.status, "pending"),
    ));
  const groups = rows
    .map(toApiGroup)
    .filter((group): group is ApiDuplicateReviewGroup => group !== null);
  return { groups, count: groups.length };
}

router.get(
  "/duplicate-reviews",
  requireCapability("manage-inventory"),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await listPending());
    } catch (err) {
      _req.log.error({ err }, "failed to list duplicate reviews");
      res.status(500).json({ error: "Failed to list duplicate reviews" });
    }
  },
);

router.post(
  "/duplicate-reviews",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = SaveDuplicateReviewsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    const groups = parsed.data.groups
      .slice(0, MAX_GROUPS)
      .map((group) => normalizeGroup(group))
      .filter((group): group is NonNullable<ReturnType<typeof normalizeGroup>> => group !== null);

    try {
      if (groups.length > 0) {
        await db
          .insert(duplicateReviewGroupsTable)
          .values(groups.map((group) => ({
            ...group,
            scope: currentScope(),
            status: "pending",
          })))
          .onConflictDoNothing();
      }
      res.json(await listPending());
    } catch (err) {
      req.log.error({ err }, "failed to save duplicate reviews");
      res.status(500).json({ error: "Failed to save duplicate reviews" });
    }
  },
);

router.post(
  "/duplicate-reviews/resolve",
  requireCapability("manage-inventory"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = ResolveDuplicateReviewBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    try {
      await db
        .update(duplicateReviewGroupsTable)
        .set({
          status: parsed.data.outcome,
          updatedAt: new Date(),
          resolvedAt: new Date(),
        })
        .where(and(
          eq(duplicateReviewGroupsTable.scope, currentScope()),
          eq(duplicateReviewGroupsTable.groupKey, normalizeGroupKey(parsed.data.groupKey)),
          eq(duplicateReviewGroupsTable.status, "pending"),
        ));
      res.json(await listPending());
    } catch (err) {
      req.log.error({ err }, "failed to resolve duplicate review");
      res.status(500).json({ error: "Failed to resolve duplicate review" });
    }
  },
);

export default router;