import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, fillMissingValuesTable, type FillMissingValue } from "@workspace/db";
import { SaveFillMissingValuesBody } from "@workspace/api-zod";
import { noStore } from "../lib/cacheControl";

const router: IRouter = Router();

// Learned "fill in missing data" values: persisted field values a user confirmed
// for a blank run-setup field, keyed by the run's product (brand + flavor). The
// Fill Missing panel auto-proposes these as a top-priority "learned" source so
// future setups of the same product don't need profile/spec/default/AI. All
// routes sit behind the router-level requireAuth, so any signed-in user
// (operators included) can read and contribute — intentionally NOT manager-gated.

const MAX_BATCH = 500;
const MAX_NAME_LEN = 200;
const MAX_VALUE_LEN = 200;

type ValueRow = {
  brand: string;
  flavor: string;
  fieldKey: string;
  value: string;
};

// Case-insensitive identity key: one product (brand + flavor) field resolves to
// exactly one learned value.
function valueKey(brand: string, flavor: string, fieldKey: string): string {
  return `${brand.toLowerCase()}\u0000${flavor.toLowerCase()}\u0000${fieldKey}`;
}

function toApiValue(row: FillMissingValue): ValueRow {
  return {
    brand: row.brand,
    flavor: row.flavor,
    fieldKey: row.fieldKey,
    value: row.value,
  };
}

async function listAll(): Promise<ValueRow[]> {
  const rows = await db.select().from(fillMissingValuesTable);
  return rows.map(toApiValue);
}

router.get("/fill-missing-values", async (req: Request, res: Response) => {
  try {
    noStore(res);
    const values = await listAll();
    res.json({ values });
  } catch (err) {
    req.log.error({ err }, "failed to list fill-missing values");
    res.status(500).json({ error: "Failed to list fill-missing values" });
  }
});

router.post("/fill-missing-values", async (req: Request, res: Response) => {
  const parsed = SaveFillMissingValuesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  // Normalize, bound, and drop degenerate entries up front.
  const incoming: ValueRow[] = [];
  for (const v of parsed.data.values.slice(0, MAX_BATCH)) {
    const brand = (v.brand ?? "").trim().slice(0, MAX_NAME_LEN);
    const flavor = (v.flavor ?? "").trim().slice(0, MAX_NAME_LEN);
    const fieldKey = (v.fieldKey ?? "").trim().slice(0, MAX_NAME_LEN);
    const value = (v.value ?? "").trim().slice(0, MAX_VALUE_LEN);
    // A value needs a product key (brand + flavor) to be looked up later.
    if (!brand || !flavor || !fieldKey || !value) continue;
    incoming.push({ brand, flavor, fieldKey, value });
  }

  try {
    if (incoming.length > 0) {
      const existing = await db.select().from(fillMissingValuesTable);
      const byKey = new Map<string, FillMissingValue>();
      for (const row of existing) {
        byKey.set(valueKey(row.brand, row.flavor, row.fieldKey), row);
      }

      // Dedupe the incoming batch by identity key (last write wins).
      const toApply = new Map<string, ValueRow>();
      for (const v of incoming) {
        toApply.set(valueKey(v.brand, v.flavor, v.fieldKey), v);
      }

      const inserts: ValueRow[] = [];
      for (const [key, v] of toApply) {
        const prior = byKey.get(key);
        if (!prior) {
          inserts.push(v);
        } else if (prior.value !== v.value) {
          await db
            .update(fillMissingValuesTable)
            .set({ value: v.value, updatedAt: new Date() })
            .where(eq(fillMissingValuesTable.id, prior.id));
        }
      }
      if (inserts.length > 0) {
        await db.insert(fillMissingValuesTable).values(inserts);
      }
    }

    const values = await listAll();
    res.json({ values });
  } catch (err) {
    req.log.error({ err }, "failed to save fill-missing values");
    res.status(500).json({ error: "Failed to save fill-missing values" });
  }
});

export default router;
