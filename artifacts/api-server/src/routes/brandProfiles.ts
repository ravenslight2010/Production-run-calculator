import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, brandProfilesTable, type BrandProfileRow } from "@workspace/db";
import { SaveBrandProfilesBody, DeleteBrandProfilesBody } from "@workspace/api-zod";
import { currentScope } from "../lib/requestScope";

// Plain generic sauce category labels that imply the spec-sheet parenthetical
// product name was silently dropped during import (e.g. a row reading
// "BBQ Sauce (Hoosier Daddy Sweet & Sassy)" stored only "BBQ Sauce").
// Compared case-insensitively against the stored frontlineRecipeName.
export const GENERIC_SAUCE_NAMES = [
  "BBQ Sauce",
  "Ranch",
  "Garlic Sauce",
  "Alfredo Sauce",
  "Buffalo Sauce",
  "Hot Sauce",
  "White Sauce",
  "Honey Mustard",
  "Pesto Sauce",
  "Pesto",
];

// Factory-wide brand+flavor SETUP PROFILES (the saved run form for a product).
// Moved out of the per-day sync payload — where they travelled as an unstamped
// map and last-push-won — into their own master-data pool like Cheese / Dough /
// Sauce recipes.
//
// Reads and writes are open to any signed-in user (requireAuth is applied at
// the router mount): floor staff have always saved profiles implicitly from
// the run form (every nav path persists the open form), and profile deletion
// rides along with the master-list flows staff already perform through sync.
// No capability gate is added so no existing flow silently starts failing.
//
// The upsert is STAMP-GUARDED server-side (per-profile last-write-wins): each
// profile carries a client edit stamp (`updatedAt`, ms epoch) and the row is
// only overwritten when the incoming stamp is STRICTLY newer. A stale device
// re-publishing an old form (the recurring loss mode of the old sync-map
// transport) is simply ignored.

const MAX_BATCH = 500;
// A profile blob is a saved run form — generous but bounded so a single row
// can't be flooded with megabytes of junk.
const MAX_BLOB_CHARS = 200_000;
const MAX_KEY_CHARS = 400;

type ApiProfile = {
  key: string;
  brand: string;
  flavor: string;
  values: Record<string, unknown>;
  crustValues: Record<string, unknown>;
  updatedAt: number;
};

function toApiItem(row: BrandProfileRow): ApiProfile {
  return {
    key: row.key,
    brand: row.brand ?? "",
    flavor: row.flavor ?? "",
    values: row.values ?? {},
    crustValues: row.crustValues ?? {},
    updatedAt: row.updatedAtMs ?? 0,
  };
}

// Canonicalize + validate one incoming profile; null = drop (malformed).
// The key is derived from brand+flavor the same way the clients derive it
// (lowercase + trim, `${brand}__${flavor}`) so a client can't desync a row's
// key from its display identity.
function sanitizeItem(raw: {
  key: string;
  brand: string;
  flavor: string;
  values: Record<string, unknown>;
  crustValues: Record<string, unknown>;
  updatedAt: number;
}): ApiProfile | null {
  const brand = (raw.brand ?? "").trim();
  const flavor = (raw.flavor ?? "").trim();
  const derivedKey = `${brand.toLowerCase()}__${flavor.toLowerCase()}`;
  const key = (raw.key ?? "").trim() || derivedKey;
  if (!key || key === "__" || key.length > MAX_KEY_CHARS) return null;
  // Canonical keys are always `${brand}__${flavor}` — reject anything without
  // the separator so stray non-profile localStorage keys (markers etc.) that a
  // buggy client sweeps up can't become junk pool rows.
  if (!key.includes("__")) return null;
  // When brand/flavor are present they must agree with the key; otherwise trust
  // the key (older callers may only know the key form).
  if (brand && flavor && key !== derivedKey) return null;
  if (!Number.isFinite(raw.updatedAt) || raw.updatedAt < 0) return null;
  const values = raw.values && typeof raw.values === "object" ? raw.values : {};
  const crustValues =
    raw.crustValues && typeof raw.crustValues === "object" ? raw.crustValues : {};
  try {
    if (
      JSON.stringify(values).length > MAX_BLOB_CHARS ||
      JSON.stringify(crustValues).length > MAX_BLOB_CHARS
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return {
    key,
    brand,
    flavor,
    values: values as Record<string, unknown>,
    crustValues: crustValues as Record<string, unknown>,
    updatedAt: Math.floor(raw.updatedAt),
  };
}

async function listAll(): Promise<ApiProfile[]> {
  const rows = await db
    .select()
    .from(brandProfilesTable)
    .where(eq(brandProfilesTable.scope, currentScope()));
  return rows.map(toApiItem);
}

const router: IRouter = Router();

router.get("/brand-profiles", async (req: Request, res: Response) => {
  try {
    const items = await listAll();
    res.json({ items });
  } catch (err) {
    req.log.error({ err }, "failed to list brand profiles");
    res.status(500).json({ error: "Failed to list brand profiles" });
  }
});

// Returns profiles whose stored frontlineRecipeName is a plain generic sauce
// category label (e.g. "BBQ Sauce", "Ranch") rather than a specific product
// name — a sign the spec-sheet parenthetical was dropped during import.
// Managers can use this list to identify profiles that need a re-import.
router.get("/brand-profiles/stale-sauce-names", async (req: Request, res: Response) => {
  try {
    const scope = currentScope();
    // Build a SQL expression matching any GENERIC_SAUCE_NAMES value
    // case-insensitively against the stored frontlineRecipeName JSON field.
    const lowerNames = GENERIC_SAUCE_NAMES.map((n) => n.toLowerCase());
    const rows = await db
      .select({
        key: brandProfilesTable.key,
        brand: brandProfilesTable.brand,
        flavor: brandProfilesTable.flavor,
        sauceName: sql<string>`${brandProfilesTable.values}->>'frontlineRecipeName'`,
      })
      .from(brandProfilesTable)
      .where(
        and(
          eq(brandProfilesTable.scope, scope),
          sql`lower(${brandProfilesTable.values}->>'frontlineRecipeName') = ANY(${sql.raw(
            `ARRAY[${lowerNames.map((n) => `'${n.replace(/'/g, "''")}'`).join(",")}]`,
          )})`,
        ),
      );
    res.json({ items: rows });
  } catch (err) {
    req.log.error({ err }, "failed to list stale-sauce-name profiles");
    res.status(500).json({ error: "Failed to list stale sauce name profiles" });
  }
});

router.post("/brand-profiles", async (req: Request, res: Response) => {
  const parsed = SaveBrandProfilesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  // Sanitize + drop malformed profiles, then dedupe by key keeping the NEWEST
  // stamp so a single request can't fight itself with two values for one key.
  const byKey = new Map<string, ApiProfile>();
  for (const raw of parsed.data.items.slice(0, MAX_BATCH)) {
    const item = sanitizeItem(raw);
    if (!item) continue;
    const prev = byKey.get(item.key);
    if (!prev || item.updatedAt >= prev.updatedAt) byKey.set(item.key, item);
  }

  try {
    const scope = currentScope();
    for (const item of byKey.values()) {
      // Stamp-guarded upsert: insert when absent; on conflict only overwrite
      // when the incoming stamp is STRICTLY newer than the stored one (older
      // or equal-stamp writes are silently ignored — last-write-wins).
      await db
        .insert(brandProfilesTable)
        .values({
          key: item.key,
          scope,
          brand: item.brand,
          flavor: item.flavor,
          values: item.values,
          crustValues: item.crustValues,
          updatedAtMs: item.updatedAt,
        })
        .onConflictDoUpdate({
          target: [brandProfilesTable.key, brandProfilesTable.scope],
          set: {
            brand: item.brand,
            flavor: item.flavor,
            values: item.values,
            crustValues: item.crustValues,
            updatedAtMs: item.updatedAt,
          },
          setWhere: sql`${brandProfilesTable.updatedAtMs} < ${item.updatedAt}`,
        });
    }
    const items = await listAll();
    res.json({ items });
  } catch (err) {
    req.log.error({ err }, "failed to save brand profiles");
    res.status(500).json({ error: "Failed to save brand profiles" });
  }
});

router.delete("/brand-profiles", async (req: Request, res: Response) => {
  const parsed = DeleteBrandProfilesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const keys = parsed.data.keys
    .slice(0, MAX_BATCH)
    .map((k) => (typeof k === "string" ? k.trim() : ""))
    .filter((k) => k.length > 0);

  try {
    if (keys.length > 0) {
      await db
        .delete(brandProfilesTable)
        .where(
          and(
            inArray(brandProfilesTable.key, keys),
            eq(brandProfilesTable.scope, currentScope()),
          ),
        );
    }
    const items = await listAll();
    res.json({ items });
  } catch (err) {
    req.log.error({ err }, "failed to delete brand profiles");
    res.status(500).json({ error: "Failed to delete brand profiles" });
  }
});

export default router;
