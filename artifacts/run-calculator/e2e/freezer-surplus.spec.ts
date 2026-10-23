/**
 * E2E: confirm a finished-case surplus, explicitly apply part of it to a
 * matching future run, and verify the server-backed decision survives reload.
 *
 * Matching browser and server run fixtures live only in the approved
 * disposable database. Receipts, lots and allocations use the real API.
 */

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { Client } from "pg";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const API_BASE =
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;
const testUsernames = new Set<string>();

type Fixture = {
  username: string;
  brand: string;
  runId: string;
  secondRunId: string;
  thirdRunId: string;
  futureRunId: string;
  lotId?: string;
};

function localDate(): string {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

async function createManager(
  request: APIRequestContext,
  db: Client,
  username: string,
): Promise<void> {
  const response = await request.post(`${API_BASE}/api/auth/sign-up`, {
    headers: { "Content-Type": "application/json" },
    data: { username, password: PASSWORD, accessCode: SIGNUP_CODE },
  });
  expect(response.ok(), `sign-up failed: ${response.status()}`).toBe(true);

  const user = await db.query<{ id: string }>(
    "SELECT id FROM users WHERE username = $1",
    [username],
  );
  expect(user.rows).toHaveLength(1);
  await db.query(
    `INSERT INTO user_roles (user_id, role) VALUES ($1, 'manager')
     ON CONFLICT (user_id) DO UPDATE SET role = 'manager'`,
    [user.rows[0].id],
  );
  await db.query(
    "UPDATE roles SET capabilities = $1::jsonb WHERE name = 'manager'",
    [JSON.stringify(["manage-staff", "manage-inventory", "manage-profiles", "use-ai-tools"])],
  );
  await db.query("UPDATE users SET onboarding_seen = true WHERE id = $1", [user.rows[0].id]);
}

async function signIn(page: Page, username: string): Promise<void> {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await page.waitForURL((url) => url.pathname === "/" || url.pathname === "", { timeout: 25_000 });
  await page.waitForTimeout(300);
}

async function seedRuns(page: Page, fixture: Fixture, db: Client): Promise<void> {
  const date = localDate();
  const endedAt = Date.now() - 15 * 60_000;
  const secondEndedAt = endedAt - 60_000;
  const finishedValues = {
    casesNeeded: 500,
    casesPerSkid: 100,
    skidsCompleted: 5,
    casesOnCurrentSkid: 0,
    pizzasPerCase: 1,
    freezerTime: 20,
  };
  const futureValues = {
    casesNeeded: 500,
    casesPerSkid: 100,
    skidsCompleted: 0,
    casesOnCurrentSkid: 0,
    pizzasPerCase: 1,
  };
  const runs = [
    {
      id: fixture.runId,
      brand: fixture.brand,
      flavor: "Pepperoni",
      casesNeeded: 500,
      startedAt: endedAt - 30 * 60_000,
      endedAt,
    },
    {
      id: fixture.secondRunId,
      brand: fixture.brand,
      flavor: "Pepperoni",
      casesNeeded: 500,
      startedAt: secondEndedAt - 30 * 60_000,
      endedAt: secondEndedAt,
    },
    {
      id: fixture.thirdRunId,
      brand: fixture.brand,
      flavor: "Pepperoni",
      casesNeeded: 500,
      startedAt: secondEndedAt - 31 * 60_000,
      endedAt: secondEndedAt - 60_000,
    },
    {
      id: fixture.futureRunId,
      brand: fixture.brand,
      flavor: "Pepperoni",
      casesNeeded: 500,
    },
  ];
  const values = {
    [fixture.runId]: finishedValues,
    [fixture.secondRunId]: finishedValues,
    [fixture.thirdRunId]: finishedValues,
    [fixture.futureRunId]: futureValues,
  };
  await page.evaluate(
    ({ date, runs, values }) => {
      for (const [runId, runValues] of Object.entries(values)) {
        localStorage.setItem(`run-calc-run-${runId}`, JSON.stringify(runValues));
      }
      localStorage.setItem(
        "run-calc-day",
        JSON.stringify({
          date,
          runs,
          runValues: values,
          currentIndex: 0,
          resetAt: 0,
        }),
      );
    },
    { date, runs, values },
  );
  await db.query(
    `INSERT INTO daily_sync (date, scope, data)
     VALUES ($1, 'live', $2::jsonb)`,
    [date, JSON.stringify({
      dayState: { date, runs, currentIndex: 0, resetAt: 0 },
      runValues: values,
    })],
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
}

async function removeSurplusFixture(db: Client, fixture: Fixture): Promise<void> {
  await db.query(
    "DELETE FROM freezer_surplus_confirmations WHERE scope = 'live' AND run_id = ANY($1::text[])",
    [[fixture.runId, fixture.secondRunId, fixture.thirdRunId]],
  );
  await db.query(
    "DELETE FROM freezer_surplus_adjustments WHERE lot_id IN (SELECT id FROM freezer_surplus_lots WHERE brand = $1)",
    [fixture.brand],
  );
  await db.query(
    "DELETE FROM freezer_surplus_allocations WHERE lot_id IN (SELECT id FROM freezer_surplus_lots WHERE brand = $1)",
    [fixture.brand],
  );
  await db.query("DELETE FROM freezer_surplus_lots WHERE brand = $1", [fixture.brand]);
  const item = await db.query<{ id: number }>(
    "SELECT id FROM inventory_items WHERE scope = 'live' AND key = $1",
    [`finished:${fixture.brand.trim().toLowerCase()}:pepperoni`],
  );
  if (item.rows[0]) {
    await db.query("DELETE FROM inventory_lots WHERE item_id = $1", [item.rows[0].id]);
    await db.query("DELETE FROM inventory_ledger WHERE item_id = $1", [item.rows[0].id]);
    await db.query("DELETE FROM inventory_items WHERE id = $1", [item.rows[0].id]);
  }
}

async function removeRunFixture(db: Client, fixture: Fixture): Promise<void> {
  await db.query(
    `UPDATE daily_sync
     SET data = jsonb_set(
       jsonb_set(
         data,
         '{dayState,runs}',
         COALESCE((
           SELECT jsonb_agg(run)
           FROM jsonb_array_elements(COALESCE(data->'dayState'->'runs', '[]'::jsonb)) AS run
            WHERE run->>'id' NOT IN ($1, $2, $3, $4)
         ), '[]'::jsonb)
       ),
       '{runValues}',
       COALESCE((
         SELECT jsonb_object_agg(key, value)
         FROM jsonb_each(COALESCE(data->'runValues', '{}'::jsonb))
          WHERE key NOT IN ($1, $2, $3, $4)
       ), '{}'::jsonb)
     )
     WHERE data->'dayState'->'runs' IS NOT NULL`,
     [fixture.runId, fixture.secondRunId, fixture.thirdRunId, fixture.futureRunId],
  );
}

test.beforeAll(async () => {
  await requireIsolatedTestDatabase("freezer surplus browser check");
});

test.afterAll(async () => {
  if (!process.env.DATABASE_URL) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await cleanupTestUsers(db, testUsernames);
      await db.query(
        "DELETE FROM inventory_locations WHERE scope = 'live' AND name = 'Freezer Surplus Browser Test'",
      );
  } finally {
    await db.end().catch(() => {});
  }
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 },
]) {
  test(`confirms and applies dated surplus at ${viewport.name}`, async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const fixture: Fixture = {
      username: uniqueTestId(`surplus_${viewport.name}`),
      brand: uniqueTestId(`FreezerE2E${viewport.name}`).replace(/[^A-Za-z0-9 ]/g, ""),
      runId: uniqueTestId("surplus_finished_run"),
      secondRunId: uniqueTestId("surplus_second_finished_run"),
      thirdRunId: uniqueTestId("surplus_third_finished_run"),
      futureRunId: uniqueTestId("surplus_future_run"),
    };
    testUsernames.add(fixture.username);

    const browserErrors: string[] = [];
    const simulatedLostResponseUrls = new Set<string>();
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 500 && !simulatedLostResponseUrls.has(response.url())) {
        browserErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });

    const db = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await db.connect();
      await createManager(request, db, fixture.username);
      await db.query(
        `INSERT INTO inventory_locations (scope, name, is_onsite)
         VALUES ('live', 'Freezer Surplus Browser Test', false)
         ON CONFLICT (name, scope) DO NOTHING`,
      );
      await signIn(page, fixture.username);
      // daily_sync is factory-wide rather than user-scoped. A preceding
      // browser journey can leave a newer day snapshot that wins during the
      // reload in seedRuns, replacing this fixture with an unrelated run.
      // Reset today's disposable snapshot before inserting matching browser
      // and server fixtures, so authoritative eligibility and the UI agree.
      await db.query("DELETE FROM daily_sync WHERE date = $1", [localDate()]);
      await seedRuns(page, fixture, db);

      await page.getByTestId("tab-packaging").click();
      const confirmPanel = page.getByTestId("freezer-surplus-confirm");
      await expect(confirmPanel).toBeVisible();
      for (const size of [
        { width: 1280, height: 900 },
        { width: 390, height: 844 },
        { width: 768, height: 1024 },
        { width: 1024, height: 768 },
      ]) {
        await page.setViewportSize(size);
        const noExtra = confirmPanel.getByRole("button", { name: "No extra cases" });
        await noExtra.scrollIntoViewIfNeeded();
        await expect(noExtra).toBeInViewport();
        await expect(confirmPanel.getByRole("button", { name: "Confirm surplus", exact: true })).toBeInViewport();
        expect(await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        )).toBe(true);
      }
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const operatorUsername = uniqueTestId("surplus_operator");
      testUsernames.add(operatorUsername);
      await createManager(request, db, operatorUsername);
      await db.query(
        "UPDATE user_roles SET role = 'operator' WHERE user_id = (SELECT id FROM users WHERE username = $1)",
        [operatorUsername],
      );
      const operatorContext = await page.context().browser()!.newContext({
        baseURL: API_BASE,
        serviceWorkers: "block",
      });
      try {
        const operatorPage = await operatorContext.newPage();
        await signIn(operatorPage, operatorUsername);
        await operatorPage.getByTestId("tab-packaging").click();
        await expect(operatorPage.getByTestId("freezer-surplus-record-read-only")).toBeVisible();
        await expect(operatorPage.getByRole("button", { name: "No extra cases" })).toHaveCount(0);
        const denied = await operatorContext.request.post("/api/freezer-surplus/confirmations", {
          data: { runId: fixture.runId, cases: 0 },
        });
        expect(denied.status()).toBe(403);
      } finally {
        await operatorContext.close();
      }

      for (const invalidValue of ["", "1.5", "-1", "1000001"]) {
        await confirmPanel.getByLabel("Excess finished cases").fill(invalidValue);
        await confirmPanel.getByRole("button", { name: "Confirm surplus", exact: true }).click();
        await expect(confirmPanel).toBeVisible();
        await expect(confirmPanel.getByRole("alert")).toContainText(/whole number from 0/i);
      }

      let rejectedPost = false;
      let committedButResponseLost = false;
      await page.route("**/api/freezer-surplus/confirmations", async (route) => {
        if (route.request().method() === "POST" && !rejectedPost) {
          rejectedPost = true;
          await route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              error: "Freezer surplus save rejected for browser recovery check.",
            }),
          });
          return;
        }
        if (route.request().method() === "POST" && !committedButResponseLost) {
          committedButResponseLost = true;
          simulatedLostResponseUrls.add(route.request().url());
          const committed = await route.fetch();
          expect(committed.status()).toBe(201);
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Confirmation response lost after commit." }),
          });
          return;
        }
        await route.continue();
      });

      await confirmPanel.getByLabel("Excess finished cases").fill("20");
      await confirmPanel.getByRole("button", { name: "Confirm surplus", exact: true }).click();
      await expect(confirmPanel).toBeVisible();
      await expect(confirmPanel.getByRole("alert")).toContainText(
        "Freezer surplus save rejected for browser recovery check.",
      );
      expect(rejectedPost).toBe(true);

      await confirmPanel.getByRole("button", { name: "Confirm surplus", exact: true }).click();
      await expect(confirmPanel).toBeVisible();
      await expect(confirmPanel.getByRole("alert")).toContainText(
        "Confirmation response lost after commit.",
      );
      await expect(confirmPanel.getByLabel("Excess finished cases")).toHaveValue("20");
      await expect(confirmPanel.getByLabel("Freezer lot production date")).toHaveValue(localDate());

      let ledgerRefreshFailed = false;
      await page.route("**/api/freezer-surplus", async (route) => {
        if (route.request().method() === "GET" && !ledgerRefreshFailed) {
          ledgerRefreshFailed = true;
          simulatedLostResponseUrls.add(route.request().url());
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Ledger refresh failed after saved confirmation." }),
          });
          return;
        }
        await route.continue();
      });
      await confirmPanel.getByRole("button", { name: "Confirm surplus", exact: true }).click();
      await expect(confirmPanel).toHaveAttribute("data-run-id", fixture.secondRunId);
      await expect.poll(() => ledgerRefreshFailed).toBe(true);
      await page.unroute("**/api/freezer-surplus");
      await page.unroute("**/api/freezer-surplus/confirmations");
      await expect(confirmPanel.getByRole("button", { name: "No extra cases" })).toBeVisible();
      await confirmPanel.getByRole("button", { name: "No extra cases" }).click();
      await expect(confirmPanel).toHaveAttribute("data-run-id", fixture.thirdRunId);
      await confirmPanel.getByLabel("Excess finished cases").fill("0");
      await confirmPanel.getByLabel("Freezer lot production date").fill("");
      await confirmPanel.getByRole("button", { name: "Confirm surplus", exact: true }).click();
      await expect(confirmPanel).toBeHidden();

      const lots = await db.query<{ id: string }>(
        "SELECT id FROM freezer_surplus_lots WHERE brand = $1 ORDER BY created_at DESC",
        [fixture.brand],
      );
      expect(lots.rows).toHaveLength(1);
      fixture.lotId = lots.rows[0].id;
      const receipts = await db.query<{ run_id: string; cases: number; lot_id: string | null }>(
        "SELECT run_id, cases, lot_id FROM freezer_surplus_confirmations WHERE scope = 'live' ORDER BY run_id",
      );
      expect(receipts.rows).toEqual([
        { run_id: fixture.runId, cases: 20, lot_id: fixture.lotId },
        { run_id: fixture.secondRunId, cases: 0, lot_id: null },
        { run_id: fixture.thirdRunId, cases: 0, lot_id: null },
      ].sort((a, b) => a.run_id.localeCompare(b.run_id)));
      const stockReceipts = await db.query<{ qty_delta: number }>(
        `SELECT qty_delta FROM inventory_ledger
         WHERE item_id = (SELECT inventory_item_id FROM freezer_surplus_lots WHERE id = $1)`,
        [fixture.lotId],
      );
      expect(stockReceipts.rows).toEqual([{ qty_delta: 20 }]);

      await page.getByTestId("tab-warehouse").click();
      const warehousePanel = page.getByTestId("freezer-surplus-warehouse");
      await expect(warehousePanel).toBeVisible();
      const adjustmentPanel = page.getByTestId("finished-case-adjustments");
      await expect(adjustmentPanel).toBeVisible();
      await adjustmentPanel.getByLabel("Finished-case adjustment lot").selectOption(fixture.lotId);
      await adjustmentPanel.getByLabel("Finished-case adjustment cases").fill("2");
      await adjustmentPanel.getByLabel("Finished-case adjustment reason").fill("Two cases damaged in storage");

      let adjustmentCommittedButResponseLost = false;
      await page.route("**/api/freezer-surplus/lots/**/adjustments", async (route) => {
        if (route.request().method() === "POST" && !adjustmentCommittedButResponseLost) {
          adjustmentCommittedButResponseLost = true;
          simulatedLostResponseUrls.add(route.request().url());
          const committed = await route.fetch();
          expect(committed.status()).toBe(201);
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Adjustment response lost after commit." }),
          });
          return;
        }
        await route.continue();
      });
      await adjustmentPanel.getByRole("button", { name: "Record adjustment" }).click();
      await expect(adjustmentPanel.getByRole("alert")).toContainText("Adjustment response lost after commit.");
      await page.unroute("**/api/freezer-surplus/lots/**/adjustments");
      await adjustmentPanel.getByRole("button", { name: "Record adjustment" }).click();
      await expect(adjustmentPanel).toContainText("damage · 2 cases");
      await expect(adjustmentPanel).toContainText("Two cases damaged in storage");
      const manager = await db.query<{ id: string }>(
        "SELECT id FROM users WHERE username = $1",
        [fixture.username],
      );
      const adjustmentRows = await db.query<{
        cases: number;
        reason: string;
        actor_id: string;
      }>(
        "SELECT cases, reason, actor_id FROM freezer_surplus_adjustments WHERE lot_id = $1",
        [fixture.lotId],
      );
      expect(adjustmentRows.rows).toEqual([{
        cases: 2,
        reason: "Two cases damaged in storage",
        actor_id: manager.rows[0].id,
      }]);

      const futureRun = warehousePanel.getByTestId(`freezer-surplus-run-${fixture.futureRunId}`);
      await expect(futureRun).toContainText("Original target 500");
      await expect(futureRun).toContainText("Carried in 0");
      await expect(futureRun).toContainText("Still to produce 500");
      await futureRun.getByRole("button", { name: "Choose pull", exact: true }).click();
      await futureRun.getByLabel(/Cases from freezer lot dated/).fill("12");

      let rejectedAllocationPut = false;
      await page.route("**/api/freezer-surplus/allocations/**", async (route) => {
        if (route.request().method() === "PUT" && !rejectedAllocationPut) {
          rejectedAllocationPut = true;
          await route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              error: "Freezer pull save rejected for browser recovery check.",
            }),
          });
          return;
        }
        await route.continue();
      });

      await futureRun.getByRole("button", { name: "Confirm pull", exact: true }).click();
      await expect(futureRun).toBeVisible();
      await expect(futureRun).toContainText("Original target 500");
      await expect(futureRun).toContainText("Carried in 0");
      await expect(futureRun).toContainText("Still to produce 500");
      await expect(futureRun.getByLabel(/Cases from freezer lot dated/)).toHaveValue("12");
      await expect(futureRun.getByRole("button", { name: "Close pull", exact: true })).toBeVisible();
      await expect(warehousePanel.getByRole("alert")).toContainText(
        "Freezer pull save rejected for browser recovery check.",
      );
      expect(rejectedAllocationPut).toBe(true);

      await page.unroute("**/api/freezer-surplus/allocations/**");
      await futureRun.getByRole("button", { name: "Confirm pull", exact: true }).click();

      await expect(futureRun).toContainText("Original target 500");
      await expect(futureRun).toContainText("Carried in 12");
      await expect(futureRun).toContainText("Still to produce 488");
      await expect(warehousePanel).toContainText(/Applied 12 carried-in cases/);

      const stored = await db.query<{ remaining_cases: number; cases: number }>(
        `SELECT l.remaining_cases, a.cases
         FROM freezer_surplus_lots l
         JOIN freezer_surplus_allocations a ON a.lot_id = l.id
         WHERE l.id = $1 AND a.run_id = $2`,
        [fixture.lotId, fixture.futureRunId],
      );
      expect(stored.rows).toEqual([{ remaining_cases: 6, cases: 12 }]);

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
      await page.getByTestId("tab-packaging").click();
      await expect(page.getByTestId("freezer-surplus-confirm")).toBeHidden();
      const peer = await page.context().browser()!.newContext({
        baseURL: API_BASE,
        serviceWorkers: "block",
        viewport: { width: viewport.width, height: viewport.height },
      });
      try {
        const peerPage = await peer.newPage();
        await signIn(peerPage, fixture.username);
        await peerPage.getByTestId("tab-packaging").click();
        await expect(peerPage.getByTestId("freezer-surplus-confirm")).toBeHidden();
      } finally {
        await peer.close();
      }
      await page.getByTestId("tab-warehouse").click();
      const reloadedPanel = page.getByTestId("freezer-surplus-warehouse");
      const reloadedRun = reloadedPanel.getByTestId(`freezer-surplus-run-${fixture.futureRunId}`);
      await expect(reloadedRun).toContainText("Original target 500");
      await expect(reloadedRun).toContainText("Carried in 12");
      await expect(reloadedRun).toContainText("Still to produce 488");
      const horizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(horizontalOverflow).toBe(false);
      for (const tablet of [
        { width: 800, height: 1100 },
        { width: 1100, height: 800 },
      ]) {
        await page.setViewportSize(tablet);
        await expect(page.getByTestId("freezer-surplus-warehouse")).toBeVisible();
        expect(await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        )).toBe(true);
      }
      expect(browserErrors).toEqual([]);

      await page.screenshot({
        path: testInfo.outputPath(`freezer-surplus-${viewport.name}.png`),
        fullPage: true,
      });
    } finally {
      await removeSurplusFixture(db, fixture);
      await removeRunFixture(db, fixture);
      await db.end().catch(() => {});
    }
  });
}