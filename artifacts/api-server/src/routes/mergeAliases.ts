import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, mergeAliasesTable, type MergeAlias as MergeAliasRow } from "@workspace/db";
import { SaveMergeAliasesBody } from "@workspace/api-zod";
import { currentScope } from "../lib/requestScope";
import { mergeAliasKey, type MergeSuggestCategory } from "@workspace/merge-suggest";

const router: IRouter = Router();

// Learned merge aliases: persisted mappings from a merged-away name to the
// canonical name it was folded into, contributed automatically whenever a
// merge is confirmed. The AI merge-suggester and the local "previously
// merged" suggestions reuse them. All routes sit behind the router-level
// requireAuth, so any signed-in user (operators included) can read and
// contribute — intentionally NOT manager-gated, matching the import/spec
// alias precedent.
//
// Every alias is scoped to a `category` (which merge tab it came from), so a
// learned alias never leaks into an unrelated tab's suggestions. "flavor"
// rows are additionally scoped to a single `brand` (a flavor name can
// legitimately repeat across brands). Rows written before categories existed
// default to category "ingredient" (see schema), matching every pre-existing
// caller that never sent one.

const MAX_BATCH = 1000;
const MAX_NAME_LEN = 200;
const CATEGORIES: MergeSuggestCategory[] = [
  "ingredient",
  "mixes",
  "dough",
  "sauce",
  "cheese",
  "brand",
  "flavor",
];

type AliasRow = {
  externalName: string;
  canonicalName: string;
};

function toApiAlias(row: MergeAliasRow): AliasRow {
  return { externalName: row.externalName, canonicalName: row.canonicalName };
}

function parseCategory(raw: unknown): MergeSuggestCategory {
  const c = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (CATEGORIES as string[]).includes(c) ? (c as MergeSuggestCategory) : "ingredient";
}

// Strict variant for GET query params: an unrecognized category is a caller
// error (bad query string), not an implicit "ingredient" — unlike the POST/
// DELETE body paths, which go through the zod enum first and so can only
// ever see an already-valid value or `undefined`.
function parseCategoryStrict(raw: unknown): MergeSuggestCategory | null {
  if (raw === undefined) return "ingredient";
  const c = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (CATEGORIES as string[]).includes(c) ? (c as MergeSuggestCategory) : null;
}

function parseBrand(category: MergeSuggestCategory, raw: unknown): string | null {
  if (category !== "flavor") return null;
  const b = typeof raw === "string" ? raw.trim().slice(0, MAX_NAME_LEN) : "";
  return b || null;
}

async function listAll(category: MergeSuggestCategory, brand: string | null): Promise<AliasRow[]> {
  const rows = await db
    .select()
    .from(mergeAliasesTable)
    .where(
      and(
        eq(mergeAliasesTable.scope, currentScope()),
        eq(mergeAliasesTable.category, category),
        brand ? eq(mergeAliasesTable.brand, brand) : isNull(mergeAliasesTable.brand),
      ),
    );
  return rows.map(toApiAlias);
}

router.get("/merge-aliases", async (req: Request, res: Response) => {
  const category = parseCategoryStrict(req.query.category);
  if (category === null) {
    res.status(400).json({ error: "Invalid category" });
    return;
  }
  try {
    const brand = parseBrand(category, req.query.brand);
    const aliases = await listAll(category, brand);
    res.json({ aliases });
  } catch (err) {
    req.log.error({ err }, "failed to list merge aliases");
    res.status(500).json({ error: "Failed to list merge aliases" });
  }
});

router.post("/merge-aliases", async (req: Request, res: Response) => {
  const parsed = SaveMergeAliasesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const category = parseCategory(parsed.data.category);
  const brand = parseBrand(category, parsed.data.brand);

  // Normalize, bound, and drop degenerate/self-referential entries up front.
  const incoming: AliasRow[] = [];
  for (const a of parsed.data.aliases.slice(0, MAX_BATCH)) {
    const externalName = (a.externalName ?? "").trim().slice(0, MAX_NAME_LEN);
    const canonicalName = (a.canonicalName ?? "").trim().slice(0, MAX_NAME_LEN);
    if (!externalName || !canonicalName) continue;
    // A mapping that just restates the same name carries no information.
    if (externalName.toLowerCase() === canonicalName.toLowerCase()) continue;
    incoming.push({ externalName, canonicalName });
  }

  try {
    if (incoming.length > 0) {
      const existing = await db
        .select()
        .from(mergeAliasesTable)
        .where(
          and(
            eq(mergeAliasesTable.scope, currentScope()),
            eq(mergeAliasesTable.category, category),
            brand ? eq(mergeAliasesTable.brand, brand) : isNull(mergeAliasesTable.brand),
          ),
        );
      const byKey = new Map<string, MergeAliasRow>();
      for (const row of existing) {
        byKey.set(mergeAliasKey(row.externalName), row);
      }

      // Dedupe the incoming batch by identity key (last write wins) so a single
      // request can't fight itself with two values for the same key.
      const toApply = new Map<string, AliasRow>();
      for (const a of incoming) {
        toApply.set(mergeAliasKey(a.externalName), a);
      }

      const inserts: AliasRow[] = [];
      for (const [key, a] of toApply) {
        const prior = byKey.get(key);
        if (!prior) {
          inserts.push(a);
        } else if (prior.canonicalName !== a.canonicalName) {
          await db
            .update(mergeAliasesTable)
            .set({ canonicalName: a.canonicalName, updatedAt: new Date() })
            .where(eq(mergeAliasesTable.id, prior.id));
        }
      }
      if (inserts.length > 0) {
        await db
          .insert(mergeAliasesTable)
          .values(inserts.map((a) => ({ ...a, scope: currentScope(), category, brand })));
      }
    }

    const aliases = await listAll(category, brand);
    res.json({ aliases });
  } catch (err) {
    req.log.error({ err }, "failed to save merge aliases");
    res.status(500).json({ error: "Failed to save merge aliases" });
  }
});

export default router;
