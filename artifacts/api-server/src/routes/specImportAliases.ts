import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, specImportAliasesTable, type SpecImportAlias as SpecImportAliasRow } from "@workspace/db";
import { SaveSpecImportAliasesBody } from "@workspace/api-zod";
import { currentScope } from "../lib/requestScope";
import { SPEC_ALIAS_KINDS, specAliasKey, isGenericSlotTypeName, isModifierDropNamePair, isCrossFamilyMixCheesePair, type SpecAliasKind } from "@workspace/spec-import";

const router: IRouter = Router();

// Learned spec-sheet-import aliases: persisted mappings from a messy spreadsheet
// label to the app's canonical name, contributed automatically when the Excel
// spec-sheet importer resolves a name. Future imports auto-apply them. All routes
// sit behind the router-level requireAuth, so any signed-in user (operators
// included) can read and contribute — intentionally NOT manager-gated.

const MAX_BATCH = 1000;
const MAX_NAME_LEN = 200;

const KIND_SET = new Set<string>(SPEC_ALIAS_KINDS);

type AliasRow = {
  kind: SpecAliasKind;
  externalName: string;
  canonicalName: string;
  context: string | null;
};

function toApiAlias(row: SpecImportAliasRow): AliasRow | null {
  if (!KIND_SET.has(row.kind)) return null;
  return {
    kind: row.kind as SpecAliasKind,
    externalName: row.externalName,
    canonicalName: row.canonicalName,
    context: row.context ?? null,
  };
}

async function listAll(): Promise<AliasRow[]> {
  const rows = await db
    .select()
    .from(specImportAliasesTable)
    .where(eq(specImportAliasesTable.scope, currentScope()));
  return rows.map(toApiAlias).filter((a): a is AliasRow => a !== null);
}

router.get("/spec-import-aliases", async (req: Request, res: Response) => {
  try {
    const aliases = await listAll();
    res.json({ aliases });
  } catch (err) {
    req.log.error({ err }, "failed to list spec-import aliases");
    res.status(500).json({ error: "Failed to list spec-import aliases" });
  }
});

router.post("/spec-import-aliases", async (req: Request, res: Response) => {
  const parsed = SaveSpecImportAliasesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  // Normalize, bound, and drop degenerate/self-referential entries up front.
  const incoming: AliasRow[] = [];
  for (const a of parsed.data.aliases.slice(0, MAX_BATCH)) {
    if (!KIND_SET.has(a.kind)) continue;
    const kind = a.kind as SpecAliasKind;
    const externalName = (a.externalName ?? "").trim().slice(0, MAX_NAME_LEN);
    const canonicalName = (a.canonicalName ?? "").trim().slice(0, MAX_NAME_LEN);
    const context = a.context ? a.context.trim().slice(0, MAX_NAME_LEN) || null : null;
    if (!externalName || !canonicalName) continue;
    // A mapping that just restates the same name carries no information.
    if (externalName.toLowerCase() === canonicalName.toLowerCase()) continue;
    // Server-side backstop for the blend-name namespace: a generic slot-type
    // name ("Mix"/"cheese") on either side of an appType alias is poison — it
    // renames every distinct blend onto one garbage record at the next import.
    // Old/unfixed clients must not be able to write these.
    if (kind === "appType" && (isGenericSlotTypeName(externalName) || isGenericSlotTypeName(canonicalName))) {
      continue;
    }
    // Server-side backstop: an appType alias that crosses the mix ↔ cheese
    // blend family line (adds/removes the word "cheese" between a mix-family
    // and cheese-family name) renames a DIFFERENT product ("Bobo Breakfast
    // Mix" → "Bobo's Breakfast Cheese Mix" swapped an egg/bacon premix for a
    // mozzarella blend). Old/unfixed clients must not be able to write these.
    if (kind === "appType" && isCrossFamilyMixCheesePair(externalName, canonicalName)) {
      continue;
    }
    // Server-side backstop for ingredient aliases: a pair that drops a
    // distinguishing modifier word ("Sea Salt" → "Salt") names a DIFFERENT
    // ingredient, and ingredient aliases auto-apply with no review step.
    // Old/unfixed clients must not be able to write these.
    if (
      (kind === "cheeseIngredient" || kind === "doughIngredient" || kind === "sauceIngredient") &&
      isModifierDropNamePair(externalName, canonicalName)
    ) {
      continue;
    }
    incoming.push({ kind, externalName, canonicalName, context });
  }

  try {
    if (incoming.length > 0) {
      const existing = await db
        .select()
        .from(specImportAliasesTable)
        .where(eq(specImportAliasesTable.scope, currentScope()));
      const byKey = new Map<string, SpecImportAliasRow>();
      for (const row of existing) {
        byKey.set(specAliasKey(row.kind, row.externalName, row.context ?? null), row);
      }

      // Dedupe the incoming batch by identity key (last write wins) so a single
      // request can't fight itself with two values for the same key.
      const toApply = new Map<string, AliasRow>();
      for (const a of incoming) {
        toApply.set(specAliasKey(a.kind, a.externalName, a.context), a);
      }

      const inserts: AliasRow[] = [];
      for (const [key, a] of toApply) {
        const prior = byKey.get(key);
        if (!prior) {
          inserts.push(a);
        } else if (prior.canonicalName !== a.canonicalName) {
          await db
            .update(specImportAliasesTable)
            .set({ canonicalName: a.canonicalName, updatedAt: new Date() })
            .where(eq(specImportAliasesTable.id, prior.id));
        }
      }
      if (inserts.length > 0) {
        await db
          .insert(specImportAliasesTable)
          .values(inserts.map((a) => ({ ...a, scope: currentScope() })));
      }
    }

    const aliases = await listAll();
    res.json({ aliases });
  } catch (err) {
    req.log.error({ err }, "failed to save spec-import aliases");
    res.status(500).json({ error: "Failed to save spec-import aliases" });
  }
});

export default router;
