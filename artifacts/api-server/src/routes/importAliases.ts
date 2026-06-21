import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, importAliasesTable, type ImportAlias } from "@workspace/db";
import { SaveImportAliasesBody } from "@workspace/api-zod";
import { noStore } from "../lib/cacheControl";

const router: IRouter = Router();

// Learned import aliases: persisted brand/flavor name mappings a user confirmed
// during an Excel import, so future imports auto-apply them. All routes sit
// behind the router-level requireAuth, so any signed-in user (operators
// included) can read and contribute — intentionally NOT manager-gated.

const MAX_BATCH = 500;
const MAX_NAME_LEN = 200;

type AliasRow = {
  type: "brand" | "flavor";
  externalName: string;
  canonicalName: string;
  brandContext: string | null;
};

// Case-insensitive identity key for an alias: an imported name under a (flavor)
// brand context resolves to exactly one canonical name.
function aliasKey(type: string, externalName: string, brandContext: string | null): string {
  return `${type}\u0000${externalName.toLowerCase()}\u0000${(brandContext ?? "").toLowerCase()}`;
}

function toApiAlias(row: ImportAlias): AliasRow {
  return {
    type: row.type === "flavor" ? "flavor" : "brand",
    externalName: row.externalName,
    canonicalName: row.canonicalName,
    brandContext: row.brandContext ?? null,
  };
}

async function listAll(): Promise<AliasRow[]> {
  const rows = await db.select().from(importAliasesTable);
  return rows.map(toApiAlias);
}

router.get("/import-aliases", async (req: Request, res: Response) => {
  try {
    noStore(res);
    const aliases = await listAll();
    res.json({ aliases });
  } catch (err) {
    req.log.error({ err }, "failed to list import aliases");
    res.status(500).json({ error: "Failed to list import aliases" });
  }
});

router.post("/import-aliases", async (req: Request, res: Response) => {
  const parsed = SaveImportAliasesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  // Normalize, bound, and drop degenerate/self-referential entries up front.
  const incoming: AliasRow[] = [];
  for (const a of parsed.data.aliases.slice(0, MAX_BATCH)) {
    const type = a.type === "flavor" ? "flavor" : "brand";
    const externalName = (a.externalName ?? "").trim().slice(0, MAX_NAME_LEN);
    const canonicalName = (a.canonicalName ?? "").trim().slice(0, MAX_NAME_LEN);
    const brandContext =
      type === "flavor" && a.brandContext
        ? a.brandContext.trim().slice(0, MAX_NAME_LEN) || null
        : null;
    if (!externalName || !canonicalName) continue;
    // A mapping that just restates the same name carries no information.
    if (externalName.toLowerCase() === canonicalName.toLowerCase()) continue;
    incoming.push({ type, externalName, canonicalName, brandContext });
  }

  try {
    if (incoming.length > 0) {
      const existing = await db.select().from(importAliasesTable);
      const byKey = new Map<string, ImportAlias>();
      for (const row of existing) {
        byKey.set(aliasKey(row.type, row.externalName, row.brandContext ?? null), row);
      }

      // Dedupe the incoming batch by identity key (last write wins) so a single
      // request can't fight itself with two values for the same key.
      const toApply = new Map<string, AliasRow>();
      for (const a of incoming) {
        toApply.set(aliasKey(a.type, a.externalName, a.brandContext), a);
      }

      const inserts: AliasRow[] = [];
      for (const [key, a] of toApply) {
        const prior = byKey.get(key);
        if (!prior) {
          inserts.push(a);
        } else if (prior.canonicalName !== a.canonicalName) {
          await db
            .update(importAliasesTable)
            .set({ canonicalName: a.canonicalName, updatedAt: new Date() })
            .where(eq(importAliasesTable.id, prior.id));
        }
      }
      if (inserts.length > 0) {
        await db.insert(importAliasesTable).values(inserts);
      }
    }

    const aliases = await listAll();
    res.json({ aliases });
  } catch (err) {
    req.log.error({ err }, "failed to save import aliases");
    res.status(500).json({ error: "Failed to save import aliases" });
  }
});

export default router;
