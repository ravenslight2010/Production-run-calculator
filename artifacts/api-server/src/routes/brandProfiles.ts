import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, brandProfilesTable, type BrandProfileRow } from "@workspace/db";
import { SaveBrandProfilesBody, DeleteBrandProfilesBody } from "@workspace/api-zod";
import { currentScope } from "../lib/requestScope";
import { getUserCapabilities } from "../lib/roles";

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
  /**
   * Explicit authoritative write (manager Apply — e.g. spec import): bypass
   * the strictly-newer stamp guard and advance the stored stamp past the
   * previous one so the write also wins future LWW comparisons.
   */
  force?: boolean;
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
  force?: boolean;
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
    ...(raw.force === true ? { force: true } : {}),
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

export type AuditItem = {
  key: string;
  brand: string;
  flavor: string;
  slot: "app3" | "app4";
  recipeName: string;
  appType: string;
  reason: "cross-profile" | "cross-brand" | "orphaned-type";
};

type AuditProfile = {
  key: string;
  brand: string;
  flavor: string;
  values: Record<string, unknown>;
};

// Pure function: given a list of profiles (any scope subset already filtered),
// returns the list of contamination signals for app3/app4 slots. Extracted so
// it can be unit-tested without a database.
//
// Three signals:
//  1. cross-profile: the recipe name is the PRIMARY (app1/app2) applicator for
//     a DIFFERENT profile and is NOT this profile's own primary.
//  2. cross-brand: the recipe name contains a known brand-name substring that
//     belongs to a different profile's brand.
//  3. orphaned-type: app3Type or app4Type is a non-blank, non-None, non-Mix
//     value while the companion recipe name is blank.
export function computeApplicatorAudit(profiles: AuditProfile[]): AuditItem[] {
  // Build a map: normalized recipe name → set of profile keys that list it as
  // a primary (app1/app2) applicator.
  const primaryOwners = new Map<string, Set<string>>();
  for (const p of profiles) {
    const v = p.values;
    const pKey = `${p.brand.toLowerCase()}__${p.flavor.toLowerCase()}`;
    for (const field of ["app1CheeseRecipeName", "app2CheeseRecipeName"] as const) {
      const name = String(v[field] ?? "").trim();
      if (!name) continue;
      const nameLower = name.toLowerCase();
      const owners = primaryOwners.get(nameLower) ?? new Set<string>();
      owners.add(pKey);
      primaryOwners.set(nameLower, owners);
    }
  }

  // Build a set of all brand name strings (lowercased, trimmed) for
  // cross-brand substring matching. Short brand names (≤ 3 chars) are
  // excluded to avoid false matches on common words like "red" or "hot".
  const brandNames = new Set<string>();
  for (const p of profiles) {
    const b = (p.brand ?? "").trim().toLowerCase();
    if (b.length > 3) brandNames.add(b);
  }

  const items: AuditItem[] = [];

  for (const p of profiles) {
    const v = p.values;
    const pKey = `${p.brand.toLowerCase()}__${p.flavor.toLowerCase()}`;

    // Collect this profile's own primary names so a recipe stacked at app3/4
    // is never incorrectly flagged.
    const ownPrimary = new Set<string>();
    for (const f of ["app1CheeseRecipeName", "app2CheeseRecipeName"] as const) {
      const n = String(v[f] ?? "").trim().toLowerCase();
      if (n) ownPrimary.add(n);
    }

    const slots = [
      { recipeField: "app3CheeseRecipeName", typeField: "app3Type", slot: "app3" as const },
      { recipeField: "app4CheeseRecipeName", typeField: "app4Type", slot: "app4" as const },
    ];

    for (const { recipeField, typeField, slot } of slots) {
      const recipeName = String(v[recipeField] ?? "").trim();
      const appType = String(v[typeField] ?? "").trim();
      const recipeNameLower = recipeName.toLowerCase();

      // Signal 3: orphaned type — type is set to a non-blank, non-None value
      // but the recipe name is empty. The contaminating run wrote the type
      // field but had no cheese recipe in that slot.
      if (!recipeName) {
        const isOrphanedType =
          appType.length > 0 &&
          appType.toLowerCase() !== "none" &&
          appType.toLowerCase() !== "mix";
        if (isOrphanedType) {
          items.push({
            key: p.key,
            brand: p.brand ?? "",
            flavor: p.flavor ?? "",
            slot,
            recipeName: "",
            appType,
            reason: "orphaned-type",
          });
        }
        continue;
      }

      // Skip if it's one of this profile's own primary applicators.
      if (ownPrimary.has(recipeNameLower)) continue;

      // Signal 1: cross-profile — this recipe name is primary for a
      // DIFFERENT profile and not for this one.
      const owners = primaryOwners.get(recipeNameLower);
      if (owners && [...owners].some((k) => k !== pKey) && !owners.has(pKey)) {
        items.push({
          key: p.key,
          brand: p.brand ?? "",
          flavor: p.flavor ?? "",
          slot,
          recipeName,
          appType,
          reason: "cross-profile",
        });
        continue;
      }

      // Signal 2: cross-brand — the recipe name contains a brand-name string
      // that belongs to a DIFFERENT brand (i.e. not this profile's own brand).
      const ownBrand = (p.brand ?? "").trim().toLowerCase();
      for (const b of brandNames) {
        if (b === ownBrand) continue;
        if (recipeNameLower.includes(b)) {
          items.push({
            key: p.key,
            brand: p.brand ?? "",
            flavor: p.flavor ?? "",
            slot,
            recipeName,
            appType,
            reason: "cross-brand",
          });
          break;
        }
      }
    }
  }

  return items;
}

// Returns profiles where app3 or app4 applicator values look inconsistent with
// the profile's own brand/flavor — a sign of cross-run autosave contamination
// that the one-time heal may have missed. Three signals are checked:
//
//  1. cross-profile: the recipe name appears as the PRIMARY (app1/app2)
//     applicator on a DIFFERENT profile (same logic as the one-time heal, but
//     run on demand so newly-imported profiles are also caught).
//
//  2. cross-brand: the recipe name contains a known brand-name substring that
//     belongs to a different profile's brand (e.g. "Hannaford BBQ Chicken"
//     stored on a "Spinach Goat Cheese" profile).
//
//  3. orphaned-type: app3Type or app4Type is set to a non-empty, non-None
//     value while the companion recipe name is blank — the contaminating run
//     had no recipe for that slot, so only the type field was overwritten.
//
// Managers can use this list to identify profiles that need manual review and
// a profile clear/re-import from the spec sheet.
router.get("/brand-profiles/applicator-audit", async (req: Request, res: Response) => {
  try {
    const scope = currentScope();
    const rows = await db
      .select()
      .from(brandProfilesTable)
      .where(eq(brandProfilesTable.scope, scope));

    const profiles = rows.map((p) => ({
      key: p.key,
      brand: p.brand ?? "",
      flavor: p.flavor ?? "",
      values: (p.values ?? {}) as Record<string, unknown>,
    }));

    const items = computeApplicatorAudit(profiles);
    res.json({ items });
  } catch (err) {
    req.log.error({ err }, "failed to run applicator audit");
    res.status(500).json({ error: "Failed to run applicator audit" });
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
    if (!prev || item.updatedAt >= prev.updatedAt) {
      // A force flag on either duplicate is sticky: the batch asked for an
      // authoritative write of this key, keep that regardless of which stamp
      // wins the in-request dedupe.
      byKey.set(item.key, prev?.force ? { ...item, force: true } : item);
    } else if (item.force && !prev.force) {
      byKey.set(item.key, { ...prev, force: true });
    }
  }

  // Forced (authoritative) writes bypass the LWW stamp guard, so they must
  // not be reachable by every signed-in user — otherwise `force: true` is a
  // client-controlled bypass of the very protection it exists alongside.
  // Gate them on the same capability that gates the spec-import flow that
  // issues them ("use-ai-tools", the AI parse endpoint's guard). Ordinary
  // non-forced saves stay open to all staff (run-form autosaves). Checked
  // BEFORE any write so a mixed batch never half-applies then 403s.
  if ([...byKey.values()].some((i) => i.force)) {
    try {
      const caps = req.userId ? await getUserCapabilities(req.userId) : [];
      if (!caps.includes("use-ai-tools")) {
        res.status(403).json({ error: "Missing capability: use-ai-tools" });
        return;
      }
    } catch (err) {
      req.log.error({ err }, "capability check failed for forced profile save");
      res.status(500).json({ error: "Capability check failed" });
      return;
    }
  }

  try {
    const scope = currentScope();
    for (const item of byKey.values()) {
      if (item.force) {
        // AUTHORITATIVE write (explicit manager Apply, e.g. spec import):
        // overwrite regardless of the stored stamp — the LWW guard exists to
        // stop a *stale device* republishing an old form, not to block a
        // manager's deliberate correction. The stored stamp is advanced past
        // the previous one so this write also wins every future LWW compare
        // (a wrong profile saved "more recently" can no longer resurrect).
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
              updatedAtMs: sql`GREATEST(${brandProfilesTable.updatedAtMs} + 1, ${item.updatedAt})`,
            },
          });
        continue;
      }
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
