import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  userRolesTable,
  dailySyncTable,
  productionRulesTable,
  inventoryItemsTable,
  inventoryLotsTable,
  inventoryLedgerTable,
  inventoryConsumedRunsTable,
  inventorySettingsTable,
  facilityKnowledgeTable,
  aiCorrectionsTable,
  deniedMergesTable,
  fillMissingValuesTable,
  importAliasesTable,
  mergeAliasesTable,
  photoAliasesTable,
  specImportAliasesTable,
} from "@workspace/db";
import { hashPassword, newUserId } from "./auth";
import { findUserByUsername, getUserById } from "./users";

// The seeded sandbox account. Signing in as this user routes every read/write to
// the isolated "sandbox" data scope (see lib/requestScope), so anyone can poke
// at every feature without touching the real factory data. Credentials are
// well-known on purpose — both clients offer a one-tap "Log in as test user"
// shortcut — and are re-applied on every server boot so the shortcut always
// works even if someone changed them.
export const SANDBOX_USERNAME = "test";
export const SANDBOX_PASSWORD = "test";

// requireAuth runs on every request (including SSE), so cache whether a user is
// the sandbox account briefly to avoid a DB round-trip per request — mirroring
// the cached existence / daily-reset-boundary reads.
const CACHE_TTL_MS = 15_000;
type Entry = { sandbox: boolean; at: number };
const cache = new Map<string, Entry>();

export async function isSandboxUser(userId: string): Promise<boolean> {
  const now = Date.now();
  const cached = cache.get(userId);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.sandbox;
  let sandbox = false;
  try {
    const user = await getUserById(userId);
    sandbox = user?.sandbox === true;
  } catch {
    // Transient DB error: fall back to the last known value if we have one,
    // else default to live (never silently route a real user into sandbox).
    if (cached) return cached.sandbox;
    return false;
  }
  cache.set(userId, { sandbox, at: now });
  return sandbox;
}

function evictSandboxCache(userId: string): void {
  cache.delete(userId);
}

// Ensure the seeded sandbox account exists with a known password, the sandbox
// flag set, and a manager role (so every manager-gated feature is reachable in
// the sandbox). Idempotent — safe to call on every boot.
export async function seedSandboxUser(): Promise<void> {
  const existing = await findUserByUsername(SANDBOX_USERNAME);
  let userId: string;
  if (existing) {
    userId = existing.id;
    await db
      .update(usersTable)
      .set({ sandbox: true, passwordHash: hashPassword(SANDBOX_PASSWORD) })
      .where(eq(usersTable.id, userId));
  } else {
    const [row] = await db
      .insert(usersTable)
      .values({
        id: newUserId(),
        username: SANDBOX_USERNAME,
        passwordHash: hashPassword(SANDBOX_PASSWORD),
        sandbox: true,
      })
      .returning();
    userId = row.id;
  }
  // The sandbox account is always a manager regardless of how many real managers
  // exist, so every feature is reachable in the sandbox.
  await db
    .insert(userRolesTable)
    .values({ userId, role: "manager" })
    .onConflictDoUpdate({
      target: userRolesTable.userId,
      set: { role: "manager", updatedAt: new Date() },
    });
  evictSandboxCache(userId);
}

// Re-copy live → sandbox: wipe the sandbox scope's data and repopulate it from a
// fresh snapshot of live. Runs in one transaction so a failure can't leave the
// sandbox half-reset. Operates on explicit scope columns (NOT currentScope), so
// it is independent of which session triggers it.
export async function resetSandbox(): Promise<void> {
  await db.transaction(async (tx) => {
    // ── daily_sync (composite PK date+scope; no serial id) ──
    await tx.delete(dailySyncTable).where(eq(dailySyncTable.scope, "sandbox"));
    const daily = await tx.select().from(dailySyncTable).where(eq(dailySyncTable.scope, "live"));
    if (daily.length) {
      await tx.insert(dailySyncTable).values(
        daily.map((r) => ({ date: r.date, scope: "sandbox", data: r.data, updatedAt: r.updatedAt })),
      );
    }

    // ── production_rules (PK id+scope; id is a client-generated text id) ──
    await tx.delete(productionRulesTable).where(eq(productionRulesTable.scope, "sandbox"));
    const rules = await tx
      .select()
      .from(productionRulesTable)
      .where(eq(productionRulesTable.scope, "live"));
    if (rules.length) {
      await tx
        .insert(productionRulesTable)
        .values(rules.map(({ scope: _s, ...r }) => ({ ...r, scope: "sandbox" })));
    }

    // ── inventory_settings (PK scope) ──
    await tx.delete(inventorySettingsTable).where(eq(inventorySettingsTable.scope, "sandbox"));
    const settings = await tx
      .select()
      .from(inventorySettingsTable)
      .where(eq(inventorySettingsTable.scope, "live"));
    if (settings.length) {
      await tx.insert(inventorySettingsTable).values(
        settings.map((s) => ({
          // Fixed singleton id for the sandbox row (live is 1, sandbox is 2);
          // see settingsRowId in routes/inventory.ts.
          id: 2,
          scope: "sandbox",
          expirySoonDays: s.expirySoonDays,
          updatedAt: s.updatedAt,
        })),
      );
    }

    // ── inventory items/lots/ledger: serial ids are scope-specific, so they get
    // brand-new ids in the sandbox and we remap the FK references (lots.itemId,
    // ledger.itemId/lotId). Deleting sandbox items cascades sandbox lots+ledger.
    await tx
      .delete(inventoryConsumedRunsTable)
      .where(eq(inventoryConsumedRunsTable.scope, "sandbox"));
    await tx.delete(inventoryItemsTable).where(eq(inventoryItemsTable.scope, "sandbox"));

    const liveItems = await tx
      .select()
      .from(inventoryItemsTable)
      .where(eq(inventoryItemsTable.scope, "live"));
    const itemIdMap = new Map<number, number>();
    for (const it of liveItems) {
      const [ins] = await tx
        .insert(inventoryItemsTable)
        .values({
          scope: "sandbox",
          key: it.key,
          category: it.category,
          name: it.name,
          unit: it.unit,
          reorderThreshold: it.reorderThreshold,
          createdAt: it.createdAt,
          updatedAt: it.updatedAt,
        })
        .returning();
      itemIdMap.set(it.id, ins.id);
    }

    const liveLots = await tx
      .select()
      .from(inventoryLotsTable)
      .where(eq(inventoryLotsTable.scope, "live"));
    const lotIdMap = new Map<number, number>();
    for (const lot of liveLots) {
      const newItemId = itemIdMap.get(lot.itemId);
      if (newItemId == null) continue;
      const [ins] = await tx
        .insert(inventoryLotsTable)
        .values({
          scope: "sandbox",
          itemId: newItemId,
          lotNumber: lot.lotNumber,
          qtyReceived: lot.qtyReceived,
          qtyRemaining: lot.qtyRemaining,
          receivedDate: lot.receivedDate,
          expirationDate: lot.expirationDate,
          createdAt: lot.createdAt,
        })
        .returning();
      lotIdMap.set(lot.id, ins.id);
    }

    const liveLedger = await tx
      .select()
      .from(inventoryLedgerTable)
      .where(eq(inventoryLedgerTable.scope, "live"));
    const ledgerRows = liveLedger
      .map((e) => {
        const newItemId = itemIdMap.get(e.itemId);
        if (newItemId == null) return null;
        return {
          scope: "sandbox" as const,
          itemId: newItemId,
          lotId: e.lotId != null ? (lotIdMap.get(e.lotId) ?? null) : null,
          type: e.type,
          qtyDelta: e.qtyDelta,
          runId: e.runId,
          note: e.note,
          createdAt: e.createdAt,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (ledgerRows.length) await tx.insert(inventoryLedgerTable).values(ledgerRows);

    const liveConsumed = await tx
      .select()
      .from(inventoryConsumedRunsTable)
      .where(eq(inventoryConsumedRunsTable.scope, "live"));
    if (liveConsumed.length) {
      await tx.insert(inventoryConsumedRunsTable).values(
        liveConsumed.map((c) => ({ runId: c.runId, scope: "sandbox", createdAt: c.createdAt })),
      );
    }

    // ── learned-memory + alias tables (serial id, no cross-row FKs): drop the
    // serial id + scope and re-insert under the sandbox scope. ──
    await copySimpleScoped(tx, facilityKnowledgeTable);
    await copySimpleScoped(tx, aiCorrectionsTable);
    await copySimpleScoped(tx, deniedMergesTable);
    await copySimpleScoped(tx, fillMissingValuesTable);
    await copySimpleScoped(tx, importAliasesTable);
    await copySimpleScoped(tx, mergeAliasesTable);
    await copySimpleScoped(tx, photoAliasesTable);
    await copySimpleScoped(tx, specImportAliasesTable);
  });
}

// Transaction handle type (so the copy helper can run inside resetSandbox's tx).
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Generic live→sandbox copy for the simple serial-id tables that have a `scope`
// column and no FK references between their own rows: wipe the sandbox rows, then
// re-insert the live rows minus their serial id under scope "sandbox". Typed as
// `any` because expressing "any of these heterogeneous tables, each with id +
// scope columns" across drizzle's table types is not worth the generic gymnastics.
async function copySimpleScoped(tx: Tx, table: any): Promise<void> {
  await tx.delete(table).where(eq(table.scope, "sandbox"));
  const live = (await tx.select().from(table).where(eq(table.scope, "live"))) as Array<
    Record<string, unknown>
  >;
  if (!live.length) return;
  const rows = live.map(({ id: _id, scope: _scope, ...rest }) => ({ ...rest, scope: "sandbox" }));
  await tx.insert(table).values(rows);
}
