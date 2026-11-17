import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_MANAGER_CAPABILITIES,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { signUpAndHandleOnboarding } from "./onboarding";
import { selectCanonicalFixtureRun } from "./canonical-run-selection";

const PASSWORD = "GuardedUndoE2E-Only-73!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const HISTORY_KEY = "run-calc-change-history";
const FIXTURE_PREFIX = uniqueTestId("guarded_undo");

type Receipt = { id: string; description: string; status: string };

async function signIn(page: Page, username: string): Promise<void> {
  if (!SIGNUP_CODE) throw new Error("STAFF_SIGNUP_CODE is required for isolated guarded-Undo browser tests.");
  await signUpAndHandleOnboarding(page, username, PASSWORD, { signupCode: SIGNUP_CODE });
}

async function promoteManager(page: Page, username: string): Promise<void> {
  const identityResponse = await page.request.get("/api/me");
  expect(identityResponse.ok()).toBeTruthy();
  const identity = await identityResponse.json() as { userId?: string };
  expect(identity.userId).toBeTruthy();
  const db = new Client({ connectionString: requireIsolatedTestDatabase("guarded Undo manager fixture") });
  try {
    await db.connect();
    await db.query(
      "UPDATE roles SET capabilities = $1::jsonb, updated_at = NOW() WHERE name = 'manager'",
      [JSON.stringify(DEFAULT_MANAGER_CAPABILITIES)],
    );
    await db.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, 'manager')
       ON CONFLICT (user_id) DO UPDATE SET role = 'manager', updated_at = NOW()`,
      [identity.userId],
    );
  } finally {
    await db.end().catch(() => {});
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  const me = await page.request.get("/api/me");
  expect((await me.json() as { role?: string }).role).toBe("manager");
  expect(username).toBeTruthy();
}

async function openSettings(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Manage Lists & Settings" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openBrands(dialog: Locator): Promise<void> {
  const lists = dialog.getByRole("button", { name: "Lists", exact: true });
  if (await lists.isVisible()) await lists.click();
  const brands = dialog.getByRole("button", { name: "Brands", exact: true });
  if (await brands.isVisible()) await brands.click();
  await expect(dialog.getByPlaceholder("Add to Brands…")).toBeVisible();
}

async function waitForReceipt(page: Page, action: () => Promise<void>): Promise<Receipt> {
  const [response] = await Promise.all([page.waitForResponse((response) =>
    new URL(response.url()).pathname.startsWith("/api/master-data-operations/")
      && new URL(response.url()).pathname.endsWith("/apply")
      && response.request().method() === "POST",
  { timeout: 30_000 }), action()]);
  expect(response.status()).toBe(200);
  const receipt = await response.json() as Receipt;
  expect(receipt.status).toBe("applied");
  expect(receipt.id).toBeTruthy();
  expect(receipt.description).toBeTruthy();
  return { id: receipt.id, description: receipt.description, status: receipt.status };
}

async function addBrand(page: Page, dialog: Locator, name: string): Promise<Receipt> {
  const input = dialog.getByPlaceholder("Add to Brands…");
  const receipt = await waitForReceipt(page, async () => {
    await input.fill(name);
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
  });
  await expect(input).toBeEnabled();
  await expect(dialog.getByRole("button", { name, exact: true })).toBeVisible();
  return receipt;
}

async function getBrands(page: Page): Promise<string[]> {
  const response = await page.request.get("/api/factory-data");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { data?: Record<string, { value?: unknown }> };
  const value = payload.data?.["run-calc-brands"]?.value;
  return Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : [];
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

const guardedLiveSeedState = new Map<string, {
  createdRow: boolean;
  hadDayState: boolean;
}>();

function guardedLiveSeedKey(date: string, runId: string): string {
  return `${date}:${runId}`;
}

async function seedOwnedLiveRun(date: string, runId: string): Promise<void> {
  const db = new Client({ connectionString: requireIsolatedTestDatabase("guarded Undo live-input fixture") });
  const key = guardedLiveSeedKey(date, runId);
  try {
    await db.connect();
    await db.query("BEGIN");
    const inserted = await db.query(
      `INSERT INTO daily_sync (date, scope, data, updated_at)
       VALUES ($1, 'live', '{}'::jsonb, NOW())
       ON CONFLICT (date, scope) DO NOTHING
       RETURNING date`,
      [date],
    );
    const existing = await db.query<{ data: Record<string, unknown> }>(
      "SELECT data FROM daily_sync WHERE scope = 'live' AND date = $1 FOR UPDATE",
      [date],
    );
    if (!existing.rows.length) {
      throw new Error("Guarded-Undo fixture row disappeared while being locked.");
    }
    const originalData = existing.rows[0].data;
    const hadDayState = Object.prototype.hasOwnProperty.call(originalData, "dayState");
    const originalDayState = originalData.dayState;
    if (
      originalDayState !== undefined
      && (!originalDayState || typeof originalDayState !== "object" || Array.isArray(originalDayState))
    ) {
      throw new Error("Refusing to merge a guarded-Undo fixture into malformed day-state.");
    }
    const dayState = (originalDayState ?? {}) as {
      date?: string;
      runs?: Array<{ id?: string }>;
      currentIndex?: number;
      resetAt?: number;
      [key: string]: unknown;
    };
    if (dayState.runs !== undefined && !Array.isArray(dayState.runs)) {
      throw new Error("Refusing to merge a guarded-Undo fixture into malformed run entries.");
    }
    const runs = dayState.runs ?? [];
    if (runs.some((run) => run.id === runId)) {
      throw new Error("Refusing to seed a duplicate guarded-Undo fixture run.");
    }
    const asRecord = (value: unknown, label: string): Record<string, unknown> => {
      if (value === undefined) return {};
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Refusing to merge malformed ${label} fixture state.`);
      }
      return value as Record<string, unknown>;
    };
    const nextData = structuredClone(originalData);
    nextData.dayState = {
      ...dayState,
      date,
      runs: [
        ...runs,
        { id: runId, brand: "Guarded Undo Fixture", flavor: "Live input check", casesNeeded: 21 },
      ],
      currentIndex: Number.isSafeInteger(dayState.currentIndex)
        ? dayState.currentIndex
        : 0,
      resetAt: Number(dayState.resetAt) || 0,
    };
    nextData.runValues = {
      ...asRecord(originalData.runValues, "run-values"),
      [runId]: { casesNeeded: 21, casesPerSkid: 12 },
    };
    nextData.runValuesUpdatedAt = {
      ...asRecord(originalData.runValuesUpdatedAt, "run-value timestamps"),
      [runId]: Date.now(),
    };
    await db.query(
      `UPDATE daily_sync
       SET data = $2::jsonb, canonical_revision = COALESCE(canonical_revision, 0) + 1, updated_at = NOW()
       WHERE scope = 'live' AND date = $1`,
      [date, JSON.stringify(nextData)],
    );
    await db.query("COMMIT");
    guardedLiveSeedState.set(key, {
      createdRow: inserted.rows.length > 0,
      hadDayState,
    });
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await db.end().catch(() => {});
  }
}

async function cleanupOwnedLiveRun(date: string, runId: string): Promise<void> {
  const db = new Client({ connectionString: requireIsolatedTestDatabase("guarded Undo live-input cleanup") });
  const key = guardedLiveSeedKey(date, runId);
  const seedState = guardedLiveSeedState.get(key);
  try {
    await db.connect();
    await db.query("BEGIN");
    const existing = await db.query<{ data: Record<string, unknown> }>(
      "SELECT data FROM daily_sync WHERE scope = 'live' AND date = $1 FOR UPDATE",
      [date],
    );
    if (!existing.rows.length) {
      await db.query("COMMIT");
      return;
    }
    const originalData = existing.rows[0].data;
    const dayState = originalData.dayState as {
      runs?: Array<{ id?: string; brand?: string; flavor?: string }>;
      currentIndex?: number;
    } | undefined;
    const runs = dayState?.runs ?? [];
    const ownedIndexes = runs.flatMap((run, index) => run.id === runId ? [index] : []);
    if (ownedIndexes.length > 1) {
      throw new Error("Refusing to clean a guarded-Undo run ID that appears more than once.");
    }
    if (ownedIndexes.length === 0) {
      await db.query("COMMIT");
      return;
    }
    const ownedRun = runs[ownedIndexes[0]];
    if (
      ownedRun?.brand !== "Guarded Undo Fixture" ||
      ownedRun.flavor !== "Live input check"
    ) {
      throw new Error("Refusing to clean a run that no longer matches this guarded-Undo fixture.");
    }
    if (runs.length === 1 && seedState?.createdRow) {
      await db.query("DELETE FROM daily_sync WHERE scope = 'live' AND date = $1", [date]);
      await db.query("COMMIT");
      guardedLiveSeedState.delete(key);
      return;
    }

    // The browser journey uses multiple accounts against one facility-day row.
    // Remove only this test's uniquely identified run if another context has
    // added or replaced unrelated day-state entries; preserve those entries.
    const remainingRuns = runs.filter((run) => run.id !== runId);
    const nextData = structuredClone(originalData);
    const nextDayState = nextData.dayState as NonNullable<typeof dayState>;
    if (remainingRuns.length > 0 || seedState?.hadDayState !== false) {
      nextDayState.runs = remainingRuns;
    } else {
      delete nextData.dayState;
    }
    const removedIndex = ownedIndexes[0];
    const currentIndex = Number(nextDayState.currentIndex ?? 0);
    nextDayState.currentIndex = remainingRuns.length === 0
      ? 0
      : currentIndex > removedIndex
        ? currentIndex - 1
        : currentIndex === removedIndex
          ? Math.min(removedIndex, remainingRuns.length - 1)
          : currentIndex;
    for (const key of [
      "runValues",
      "runValuesUpdatedAt",
      "packagingProgress",
      "autoTrackServerState",
    ]) {
      const values = nextData[key];
      if (values && typeof values === "object" && !Array.isArray(values)) {
        delete (values as Record<string, unknown>)[runId];
      }
    }
    await db.query(
      `UPDATE daily_sync
       SET data = $2::jsonb, canonical_revision = COALESCE(canonical_revision, 0) + 1, updated_at = NOW()
       WHERE scope = 'live' AND date = $1`,
      [date, JSON.stringify(nextData)],
    );
    await db.query("COMMIT");
    guardedLiveSeedState.delete(key);
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await db.end().catch(() => {});
  }
}

async function canonicalCases(page: Page, date: string, runId: string): Promise<number | undefined> {
  const response = await page.request.get(`/api/sync/today?today=${date}`);
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { runValues?: Record<string, { casesNeeded?: number }> };
  return payload.runValues?.[runId]?.casesNeeded;
}

async function applySeedBrand(page: Page, name: string): Promise<Receipt> {
  const id = crypto.randomUUID();
  const command = { action: "add", category: "brand", sources: [name] };
  const preview = await page.request.post(`/api/master-data-operations/${id}/preview`, { data: command });
  expect(preview.status()).toBe(200);
  const previewData = await preview.json() as { expectedStateHash?: string };
  expect(previewData.expectedStateHash).toMatch(/^[a-f0-9]{64}$/u);
  const applied = await page.request.post(`/api/master-data-operations/${id}/apply`, {
    data: { command, expectedStateHash: previewData.expectedStateHash },
  });
  expect(applied.status()).toBe(200);
  const receipt = await applied.json() as Receipt;
  expect(receipt.status).toBe("applied");
  return { id: receipt.id, description: receipt.description, status: receipt.status };
}

async function confirmUndo(page: Page, item: Locator, screenshotPath?: string): Promise<void> {
  await item.getByRole("button", { name: "Undo", exact: true }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByText("Undo this shared change?", { exact: true })).toBeVisible();
  const action = confirmation.getByRole("button", { name: "Undo", exact: true });
  await expect(action).toBeVisible();
  await action.scrollIntoViewIfNeeded();
  const bounds = await action.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds && viewport && bounds.x >= 0 && bounds.y >= 0
    && bounds.x + bounds.width <= viewport.width
    && bounds.y + bounds.height <= viewport.height,
  `Undo confirmation action must remain reachable in the ${viewport?.width}×${viewport?.height} viewport after scrolling; bounds=${bounds ? `${Math.round(bounds.x)},${Math.round(bounds.y)},${Math.round(bounds.width)},${Math.round(bounds.height)}` : "unavailable"}`)
    .toBeTruthy();
  if (screenshotPath) {
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
      mask: [page.locator('section[aria-label="Shared master-data history"] li p').filter({ hasText: /· Actor /u })],
      maskColor: "#333333",
    });
  }
}

type CanonicalBrandRead = { containsCreatedBrand: boolean; updatedAtMs: number };

function trackCanonicalBrandReads(page: Page, name: string): CanonicalBrandRead[] {
  const reads: CanonicalBrandRead[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname !== "/api/factory-data" || response.status() !== 200) return;
    void response.json().then((body: { data?: Record<string, { value?: unknown; updatedAt?: unknown }> }) => {
      const entry = body.data?.["run-calc-brands"];
      reads.push({
        containsCreatedBrand: Array.isArray(entry?.value) && entry.value.includes(name),
        updatedAtMs: typeof entry?.updatedAt === "string" ? Date.parse(entry.updatedAt) : Number.NaN,
      });
    }).catch(() => {});
  });
  return reads;
}

async function checkNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(dimensions.documentWidth, `document overflow at ${dimensions.width}px`).toBeLessThanOrEqual(dimensions.width);
  expect(dimensions.bodyWidth, `body overflow at ${dimensions.width}px`).toBeLessThanOrEqual(dimensions.width);
}

async function historyFor(page: Page): Promise<Locator> {
  const section = page.getByRole("region", { name: "Shared master-data history" });
  await expect(section).toBeVisible();
  return section;
}

async function apiHistory(page: Page): Promise<Receipt[]> {
  const response = await page.request.get("/api/master-data-operations?limit=50");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { items?: Receipt[] };
  return payload.items ?? [];
}

async function ensureImportAndHealthOwners(dialog: Locator): Promise<void> {
  const history = dialog.getByRole("region", { name: "Shared master-data history" });
  await history.getByRole("button", { name: "Data Health", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Data Health & Audit", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Lists", exact: true }).click();
  await dialog.getByRole("button", { name: "Brands", exact: true }).click();
  const backToHistory = await historyFor(dialog.page());
  await backToHistory.getByRole("button", { name: "Import history", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Import", exact: true })).toBeVisible();
}

test("guarded server Undo, legacy evidence, access, pagination, and responsive controls", async ({ browser, page }, testInfo) => {
  const projectFixture = `${FIXTURE_PREFIX}_${testInfo.project.name.replace(/[^a-z0-9]+/giu, "_")}`;
  const firstName = uniqueTestId(`${projectFixture}_one`);
  const sourceName = uniqueTestId(`${projectFixture}_source`);
  const targetName = uniqueTestId(`${projectFixture}_target`);
  const renamedTarget = uniqueTestId(`${projectFixture}_renamed`);
  const accountPrefix = testInfo.project.name.replace(/[^a-z0-9]/giu, "").slice(0, 20);
  const accountName = (role: string) => uniqueTestId(`undo_${accountPrefix}_${role}`);
  const managerA = accountName("manager_a");
  const managerB = accountName("manager_b");
  const staff = accountName("staff");
  const screenshots = join("generated-artifacts", "guarded-undo-browser", testInfo.project.name);
  await mkdir(screenshots, { recursive: true });
  const liveDate = utcToday();
  const liveRunId = uniqueTestId("guardedlive");

  const contextB = await browser.newContext({
    baseURL: testInfo.project.use.baseURL as string | undefined,
    viewport: testInfo.project.use.viewport as { width: number; height: number } | undefined,
    isMobile: testInfo.project.use.isMobile as boolean | undefined,
    hasTouch: testInfo.project.use.hasTouch as boolean | undefined,
  });
  const pageB = await contextB.newPage();
  const canonicalBrandReads = trackCanonicalBrandReads(page, firstName);
  let contextStaff: BrowserContext | undefined;
  let leakedLegacyBytes = false;
  try {
    await signIn(page, managerA);
    await promoteManager(page, managerA);
    await seedOwnedLiveRun(liveDate, liveRunId);
    await page.reload({ waitUntil: "domcontentloaded" });
    await selectCanonicalFixtureRun(page, liveRunId);
    const liveInput = page.getByTestId("input-casesNeeded");
    await expect(liveInput).toBeVisible();
    await liveInput.fill("37");
    await expect.poll(() => canonicalCases(page, liveDate, liveRunId), { timeout: 20_000 }).toBe(37);
    await signIn(pageB, managerB);
    await promoteManager(pageB, managerB);

    // Maintained manager UI creates the shared brand. The second independent
    // account confirms the receipt and compensates it through Shared history.
    const settingsA = await openSettings(page);
    await openBrands(settingsA);
    const createdBrand = await addBrand(page, settingsA, firstName);
    expect(await getBrands(page)).toContain(firstName);
    await expect.poll(() => canonicalBrandReads.at(-1)?.containsCreatedBrand, {
      timeout: 20_000,
      message: "the creating device did not adopt its canonical factory directory",
    }).toBe(true);
    const createdDirectoryVersion = canonicalBrandReads.at(-1)?.updatedAtMs ?? Number.NaN;
    const historyA = await historyFor(page);
    await expect(historyA.getByText(createdBrand.description, { exact: true })).toBeVisible();

    const settingsB = await openSettings(pageB);
    await openBrands(settingsB);
    const historyB = await historyFor(pageB);
    await expect(historyB.getByText(createdBrand.description, { exact: true })).toBeVisible();
    const createdItem = historyB.getByRole("listitem").filter({ hasText: createdBrand.description });
    const undoCapture = join(screenshots, "undo-confirmation.png");
    await confirmUndo(pageB, createdItem, undoCapture);
    const undoPromise = pageB.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/master-data-operations/${createdBrand.id}/undo`,
    );
    await pageB.getByRole("alertdialog").getByRole("button", { name: "Undo", exact: true }).click();
    const undoResponse = await undoPromise;
    expect(undoResponse.status()).toBe(200);
    await expect(createdItem).toContainText("undone");
    await expect(historyB.getByText("Undo confirmed by the server.", { exact: false })).toBeVisible();
    await expect.poll(async () => (await getBrands(page)).includes(firstName), {
      timeout: 20_000,
      message: "the first device did not adopt the canonical directory invalidation without a reload",
    }).toBe(false);
    await expect.poll(() => canonicalBrandReads.at(-1)?.containsCreatedBrand, {
      timeout: 20_000,
      message: "the first device did not fetch its canonical factory directory after the peer Undo",
    }).toBe(false);
    expect(canonicalBrandReads.at(-1)?.updatedAtMs).toBeGreaterThan(createdDirectoryVersion);
    await expect(
      settingsA.getByRole("button", { name: firstName, exact: true }),
      `Canonical reads after Undo: ${JSON.stringify(canonicalBrandReads.slice(-3))}`,
    ).toHaveCount(0);
    await expect(page.getByTestId("input-casesNeeded")).toHaveValue("37");
    expect(await getBrands(pageB)).not.toContain(firstName);
    const idempotentRetry = await pageB.request.post(
      `/api/master-data-operations/${createdBrand.id}/undo`,
      { data: {} },
    );
    expect(idempotentRetry.status()).toBe(200);
    expect((await idempotentRetry.json() as { status?: string }).status).toBe("undone");

    // Rename/merge operations are initiated through the maintained Lists UI;
    // a later rename makes the older merge compensation conflict atomically.
    await openBrands(settingsA);
    await addBrand(page, settingsA, sourceName);
    await addBrand(page, settingsA, targetName);
    const sourceRow = settingsA.getByRole("listitem").filter({ has: page.getByRole("button", { name: sourceName, exact: true }) });
    await sourceRow.getByRole("button", { name: sourceName, exact: true }).click();
    await sourceRow.getByPlaceholder("Pick or type a name to keep…").fill(targetName);
    await sourceRow.getByRole("button", { name: "Merge…", exact: true }).click();
    await sourceRow.getByRole("button", { name: "Confirm", exact: true }).click();
    await settingsA.getByRole("button", { name: "Merge…", exact: true }).click();
    const mergeReceipt = await waitForReceipt(page, async () => {
      await settingsA.getByRole("button", { name: "Confirm merge", exact: true }).click();
    });
    expect(await getBrands(page)).toContain(targetName);
    expect(await getBrands(page)).not.toContain(sourceName);
    await expect(historyA.getByText(mergeReceipt.description, { exact: true })).toBeVisible();

    await openBrands(settingsA);
    const targetRow = settingsA.getByRole("listitem").filter({ has: page.getByRole("button", { name: targetName, exact: true }) });
    await targetRow.getByRole("button", { name: targetName, exact: true }).click();
    await targetRow.locator("input").first().fill(renamedTarget);
    const laterRename = await waitForReceipt(page, async () => {
      await targetRow.getByRole("button", { name: "Save", exact: true }).click();
    });
    expect(laterRename.status).toBe("applied");
    expect(await getBrands(page)).toContain(renamedTarget);

    await historyB.getByRole("button", { name: "Refresh history", exact: true }).click();
    await expect(historyB.getByText(laterRename.description, { exact: true })).toBeVisible();
    const olderMerge = historyB.getByRole("listitem").filter({ hasText: mergeReceipt.description });
    await expect(olderMerge.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
    await confirmUndo(pageB, olderMerge, join(screenshots, "conflict-confirmation.png"));
    const conflictPromise = pageB.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/master-data-operations/${mergeReceipt.id}/undo`,
    );
    await pageB.getByRole("alertdialog").getByRole("button", { name: "Undo", exact: true }).click();
    const conflictResponse = await conflictPromise;
    expect(conflictResponse.status()).toBe(409);
    await expect(historyB.getByRole("alert")).toContainText(/changed|Nothing was restored/u);
    await expect(olderMerge).toContainText("conflicting");
    await expect(olderMerge.getByRole("button", { name: "Recheck guarded Undo", exact: true })).toBeEnabled();
    const canonicalAfterConflict = await getBrands(pageB);
    expect(canonicalAfterConflict).not.toContain(sourceName);
    expect(canonicalAfterConflict).toContain(renamedTarget);
    const verifiedMergeReceipt = (await apiHistory(pageB)).find((entry) => entry.id === mergeReceipt.id);
    expect(verifiedMergeReceipt?.status).toBe("conflicting");

    // Owner links are domain-specific; history is read-only while offline.
    await ensureImportAndHealthOwners(settingsB);
    await openBrands(settingsB);
    const onlineHistory = await historyFor(pageB);
    await contextB.setOffline(true);
    await expect(onlineHistory.getByText(/Offline: history may be out of date/u)).toBeVisible();
    await expect(onlineHistory.getByRole("button", { name: "Refresh history", exact: true })).toBeDisabled();
    const offlineUndo = onlineHistory.getByRole("listitem").filter({ hasText: laterRename.description })
      .getByRole("button", { name: "Undo", exact: true });
    await expect(offlineUndo).toBeDisabled();
    await contextB.setOffline(false);
    await onlineHistory.getByRole("button", { name: "Refresh history", exact: true }).click();
    await expect(onlineHistory.getByText(laterRename.description, { exact: true })).toBeVisible();

    // Inject synthetic legacy evidence and an unrelated sentinel only into
    // this isolated browser. The before-data is never returned, logged, or saved.
    const evidenceSecret = `synthetic-private-evidence-${crypto.randomUUID()}`;
    const sentinelKey = `guarded-undo-recovery-sentinel-${crypto.randomUUID()}`;
    const sentinelValue = `preserve-${crypto.randomUUID()}`;
    pageB.on("request", (request) => {
      if (request.method() === "POST" && request.postData()?.includes(evidenceSecret)) {
        leakedLegacyBytes = true;
      }
    });
    await settingsB.getByRole("button", { name: "Close settings" }).click();
    await pageB.evaluate(({ historyKey, secret, sentinel, sentinelText }) => {
      localStorage.setItem(historyKey, JSON.stringify([{
        id: "synthetic-legacy-evidence",
        type: "rename",
        ts: Date.now(),
        description: "Synthetic old device-only record",
        before: { securityBearingBeforeData: secret },
      }]));
      localStorage.setItem(sentinel, sentinelText);
    }, { historyKey: HISTORY_KEY, secret: evidenceSecret, sentinel: sentinelKey, sentinelText: sentinelValue });
    await pageB.reload({ waitUntil: "domcontentloaded" });
    await pageB.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    const reopenedSettings = await openSettings(pageB);
    await openBrands(reopenedSettings);
    await expect(reopenedSettings.getByText("Synthetic old device-only record", { exact: true })).toBeVisible();
    await expect(reopenedSettings.getByText("Legacy only · Undo unavailable", { exact: true })).toBeVisible();
    const resolveButton = reopenedSettings.getByRole("button", { name: "Resolve legacy snapshots", exact: true });
    await resolveButton.click();
    let resolveDialog = pageB.getByRole("alertdialog");
    await expect(resolveDialog).toContainText("Discard device-only legacy snapshots?");
    await resolveDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    const legacyStillPresent = await pageB.evaluate((historyKey) => localStorage.getItem(historyKey) !== null, HISTORY_KEY);
    expect(legacyStillPresent).toBe(true);

    await contextB.setOffline(true);
    await resolveButton.click();
    resolveDialog = pageB.getByRole("alertdialog");
    await resolveDialog.getByRole("button", { name: "Discard legacy snapshots", exact: true }).click();
    await expect(pageB.getByText("Legacy resolution was not confirmed", { exact: true })).toBeVisible();
    expect(await pageB.evaluate((historyKey) => localStorage.getItem(historyKey) !== null, HISTORY_KEY)).toBe(true);
    await contextB.setOffline(false);
    await onlineHistory.getByRole("button", { name: "Refresh history", exact: true }).click();

    await resolveButton.click();
    resolveDialog = pageB.getByRole("alertdialog");
    await expect(resolveDialog).toBeVisible();
    await resolveDialog.getByRole("button", { name: "Discard legacy snapshots", exact: true }).click();
    await expect(pageB.getByText("Legacy snapshots discarded", { exact: true })).toBeVisible();
    const storageResult = await pageB.evaluate(({ historyKey, sentinel, sentinelText }) => ({
      historyRemoved: localStorage.getItem(historyKey) === null,
      sentinelPreserved: localStorage.getItem(sentinel) === sentinelText,
    }), { historyKey: HISTORY_KEY, sentinel: sentinelKey, sentinelText: sentinelValue });
    expect(storageResult).toEqual({ historyRemoved: true, sentinelPreserved: true });
    expect(leakedLegacyBytes).toBe(false);
    expect((await apiHistory(pageB)).some((entry) => entry.id === mergeReceipt.id)).toBeTruthy();

    // Manager-only surface and server authorization are both checked for staff.
    contextStaff = await browser.newContext({
      baseURL: testInfo.project.use.baseURL as string | undefined,
      viewport: testInfo.project.use.viewport as { width: number; height: number } | undefined,
      isMobile: testInfo.project.use.isMobile as boolean | undefined,
      hasTouch: testInfo.project.use.hasTouch as boolean | undefined,
    });
    const staffPage = await contextStaff.newPage();
    await signIn(staffPage, staff);
    const staffSettings = await openSettings(staffPage);
    await openBrands(staffSettings);
    await expect(staffSettings.getByRole("region", { name: "Shared master-data history" })).toHaveCount(0);
    expect((await staffPage.request.get("/api/master-data-operations")).status()).toBe(403);
    expect((await staffPage.request.post(`/api/master-data-operations/${mergeReceipt.id}/undo`, { data: {} })).status()).toBe(403);

    // More than one page of preview+apply fixtures exercises actual UI paging.
    const pageBrands = Array.from({ length: 25 }, (_, index) => uniqueTestId(`${projectFixture}_page_${index}`));
    for (const brand of pageBrands) await applySeedBrand(pageB, brand);
    await openBrands(reopenedSettings);
    const pagedHistory = await historyFor(pageB);
    await pagedHistory.getByRole("button", { name: "Refresh history", exact: true }).click();
    await expect(pagedHistory.getByRole("listitem")).toHaveCount(20);
    const firstPageText = await pagedHistory.getByRole("listitem").allTextContents();
    expect(new Set(firstPageText).size).toBe(firstPageText.length);
    await pagedHistory.getByRole("button", { name: "Load older changes", exact: true }).click();
    await expect.poll(() => pagedHistory.getByRole("listitem").count()).toBeGreaterThan(20);
    const secondPageText = await pagedHistory.getByRole("listitem").allTextContents();
    expect(new Set(secondPageText).size).toBe(secondPageText.length);
    expect(secondPageText.length).toBeGreaterThan(firstPageText.length);
    await pageB.screenshot({
      path: join(screenshots, "history-load-more.png"),
      fullPage: true,
      mask: [pagedHistory.locator("li p").filter({ hasText: /· Actor /u })],
      maskColor: "#333333",
    });

    await checkNoHorizontalOverflow(page);
    await checkNoHorizontalOverflow(pageB);
  } finally {
    await contextStaff?.close().catch(() => {});
    await contextB.close().catch(() => {});
    await cleanupOwnedLiveRun(liveDate, liveRunId);
  }
});
