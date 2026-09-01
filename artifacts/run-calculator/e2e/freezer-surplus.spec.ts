/**
 * E2E: confirm a finished-case surplus, explicitly apply part of it to a
 * matching future run, and verify the server-backed decision survives reload.
 *
 * The run fixture lives in this browser's local storage, while the surplus lot
 * and allocation use the real authenticated API. This avoids mutating the
 * shared live schedule and still exercises the production user journey.
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
  runId: string;
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

async function seedRuns(page: Page, fixture: Fixture): Promise<void> {
  const date = localDate();
  await page.evaluate(
    ({ date, runId, futureRunId }) => {
      const endedAt = Date.now() - 15 * 60_000;
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
      localStorage.setItem(`run-calc-run-${runId}`, JSON.stringify(finishedValues));
      localStorage.setItem(`run-calc-run-${futureRunId}`, JSON.stringify(futureValues));
      localStorage.setItem(
        "run-calc-day",
        JSON.stringify({
          date,
          runs: [
            {
              id: runId,
              brand: "Freezer E2E",
              flavor: "Pepperoni",
              casesNeeded: 500,
              startedAt: endedAt - 30 * 60_000,
              endedAt,
            },
            {
              id: futureRunId,
              brand: "Freezer E2E",
              flavor: "Pepperoni",
              casesNeeded: 500,
            },
          ],
          runValues: {
            [runId]: finishedValues,
            [futureRunId]: futureValues,
          },
          currentIndex: 0,
          resetAt: 0,
        }),
      );
    },
    { date, runId: fixture.runId, futureRunId: fixture.futureRunId },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
}

async function removeSurplusFixture(db: Client, lotId?: string): Promise<void> {
  if (!lotId) return;
  await db.query("DELETE FROM freezer_surplus_allocations WHERE lot_id = $1", [lotId]);
  await db.query("DELETE FROM freezer_surplus_lots WHERE id = $1", [lotId]);
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
           WHERE run->>'id' NOT IN ($1, $2)
         ), '[]'::jsonb)
       ),
       '{runValues}',
       COALESCE((
         SELECT jsonb_object_agg(key, value)
         FROM jsonb_each(COALESCE(data->'runValues', '{}'::jsonb))
         WHERE key NOT IN ($1, $2)
       ), '{}'::jsonb)
     )
     WHERE data->'dayState'->'runs' IS NOT NULL`,
    [fixture.runId, fixture.futureRunId],
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
      runId: uniqueTestId("surplus_finished_run"),
      futureRunId: uniqueTestId("surplus_future_run"),
    };
    testUsernames.add(fixture.username);

    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 500) {
        browserErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });

    const db = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await db.connect();
      await createManager(request, db, fixture.username);
      await signIn(page, fixture.username);
      // daily_sync is factory-wide rather than user-scoped. A preceding
      // browser journey can leave a newer day snapshot that wins during the
      // reload in seedRuns, replacing this fixture with an unrelated run.
      // Reset today's disposable snapshot immediately before seeding so the
      // server cannot overwrite the browser-owned fixture.
      await db.query("DELETE FROM daily_sync WHERE date = $1", [localDate()]);
      await seedRuns(page, fixture);

      await page.getByTestId("tab-packaging").click();
      const confirmPanel = page.getByTestId("freezer-surplus-confirm");
      await expect(confirmPanel).toBeVisible();

      for (const invalidValue of ["", "1.5", "0", "-1"]) {
        await confirmPanel.getByLabel("Excess finished cases").fill(invalidValue);
        await confirmPanel.getByRole("button", { name: "Confirm surplus", exact: true }).click();
        await expect(confirmPanel).toBeVisible();
        await expect(confirmPanel.getByRole("status")).toContainText(
          "Enter a positive whole number of excess cases.",
        );
      }

      let rejectedPost = false;
      await page.route("**/api/freezer-surplus", async (route) => {
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
        await route.continue();
      });

      await confirmPanel.getByLabel("Excess finished cases").fill("20");
      await confirmPanel.getByRole("button", { name: "Confirm surplus", exact: true }).click();
      await expect(confirmPanel).toBeVisible();
      await expect(confirmPanel.getByRole("alert")).toContainText(
        "Freezer surplus save rejected for browser recovery check.",
      );
      expect(rejectedPost).toBe(true);

      await page.unroute("**/api/freezer-surplus");
      await confirmPanel.getByRole("button", { name: "Confirm surplus", exact: true }).click();
      await expect(confirmPanel).toBeHidden();

      const lots = await db.query<{ id: string }>(
        "SELECT id FROM freezer_surplus_lots WHERE brand = 'Freezer E2E' ORDER BY created_at DESC",
      );
      expect(lots.rows).toHaveLength(1);
      fixture.lotId = lots.rows[0].id;

      await page.getByTestId("tab-warehouse").click();
      const warehousePanel = page.getByTestId("freezer-surplus-warehouse");
      await expect(warehousePanel).toBeVisible();
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
      expect(stored.rows).toEqual([{ remaining_cases: 8, cases: 12 }]);

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
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
      expect(browserErrors).toEqual([]);

      await page.screenshot({
        path: testInfo.outputPath(`freezer-surplus-${viewport.name}.png`),
        fullPage: true,
      });
    } finally {
      await removeSurplusFixture(db, fixture.lotId);
      await removeRunFixture(db, fixture);
      await db.end().catch(() => {});
    }
  });
}