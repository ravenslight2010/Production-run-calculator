/**
 * E2E: a stale manager queue write is visible and recoverable.
 *
 * Two authenticated contexts deliberately read the same version. The first
 * update wins, the second receives the server's 409, and the manager must
 * refresh before retrying rather than seeing a false success.
 */

import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";
import { cleanupTestUsers, requireIsolatedTestDatabase, uniqueTestId } from "./isolation";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const testUsernames = new Set<string>();
let fixtureId: number | null = null;
let fixtureDedupKey = "";
let incidentFixtureId = "";
let incidentQueueFixtureId: number | null = null;

async function signUp(page: Page, username: string): Promise<void> {
  await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#confirm").fill(PASSWORD);
  await page.locator("#accessCode").fill(SIGNUP_CODE);
  await page.getByRole("button", { name: /create.?account|sign.?up/i }).click();
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  const getStarted = page.getByRole("button", { name: /^get.?started$/i });
  if (await getStarted.isVisible().catch(() => false)) await getStarted.click();
}

async function signIn(page: Page, username: string): Promise<void> {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  // The sign-in page also exposes a "Log in as test user (sandbox)" button.
  // Use the exact real-submit name so this helper cannot accidentally choose
  // the sandbox shortcut when both controls are available.
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  const welcome = page.getByRole("dialog", { name: /welcome to production run calculator/i });
  if (await welcome.isVisible().catch(() => false)) {
    await welcome.getByRole("button", { name: "Close" }).click();
  }
}

async function promoteToManager(username: string): Promise<void> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    const user = await db.query("SELECT id FROM users WHERE username = $1", [username]);
    expect(user.rows).toHaveLength(1);
    await db.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, 'manager')
       ON CONFLICT (user_id) DO UPDATE SET role = 'manager'`,
      [user.rows[0].id],
    );
  } finally {
    await db.end().catch(() => {});
  }
}

async function openQueue(page: Page): Promise<void> {
  if (await page.getByTestId("manager-action-queue").isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: /more/i }).click();
  await page.getByRole("menuitem", { name: "Manager action queue", exact: true }).click();
  await expect(page.getByTestId("manager-action-queue")).toBeVisible();
}

test.beforeAll(async () => {
  await requireIsolatedTestDatabase("manager action queue stale-write e2e");
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  fixtureDedupKey = `e2e:${uniqueTestId("manager_queue_stale")}`;
  try {
    await db.connect();
    incidentFixtureId = uniqueTestId("incident_queue_source");
    await db.query(
      `INSERT INTO incidents
        (id, scope, source, reporter_name, reporter_role, screen, app_platform, context, diagnosis, workaround, status, priority, workflow_state, notes, activity)
       VALUES ($1, 'live', 'user_report', 'Queue fixture manager', 'manager', 'Run', 'web', $2, $3, $4, 'new', 'high', 'new', '[]', '[]')`,
      [
        incidentFixtureId,
        JSON.stringify({ description: `Unique incident review ${incidentFixtureId}` }),
        "Queue fixture diagnosis",
        "Queue fixture workaround",
      ],
    );
    const result = await db.query(
      `INSERT INTO action_items
        (scope, dedup_key, category, severity, title, description, source_type, source_id, source_path, status, version)
       VALUES ($1, $2, 'sync', 'warning', $3, $4, 'sync', $5, '#sync-diagnostics', 'open', 1)
       RETURNING id`,
      ["live", fixtureDedupKey, `Stale queue item ${fixtureDedupKey}`, "Two managers must recover this stale update.", fixtureDedupKey],
    );
    fixtureId = result.rows[0].id as number;
    const incidentQueue = await db.query(
      `INSERT INTO action_items
        (scope, dedup_key, category, severity, title, description, source_type, source_id, source_path, status, version)
       VALUES ($1, $2, 'incident', 'error', $3, $4, 'incident', $5, $6, 'open', 1)
       RETURNING id`,
      [
        "live",
        `e2e:${uniqueTestId("incident_queue_item")}`,
        `Incident source ${incidentFixtureId}`,
        `Unique incident queue ${incidentFixtureId}`,
        incidentFixtureId,
        `#incidents/${encodeURIComponent(incidentFixtureId)}`,
      ],
    );
    incidentQueueFixtureId = incidentQueue.rows[0].id as number;
  } finally {
    await db.end().catch(() => {});
  }
});

test.afterAll(async () => {
  if (!process.env.DATABASE_URL) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    if (fixtureId !== null) await db.query("DELETE FROM action_items WHERE id = $1", [fixtureId]);
    if (incidentQueueFixtureId !== null) await db.query("DELETE FROM action_items WHERE id = $1", [incidentQueueFixtureId]);
    if (incidentFixtureId) {
      await db.query("DELETE FROM action_items WHERE source_type = 'incident' AND source_id = $1", [incidentFixtureId]);
      await db.query("DELETE FROM incidents WHERE id = $1", [incidentFixtureId]);
    }
    await cleanupTestUsers(db, testUsernames);
  } finally {
    await db.end().catch(() => {});
  }
});

test("shows a stale update error, then refreshes and safely retries", async ({ browser }: { browser: Browser }, testInfo: TestInfo) => {
  const username = uniqueTestId("e2e_manager_queue");
  testUsernames.add(username);
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  const browserErrors: string[] = [];
  for (const page of [first, second]) {
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 500) {
        browserErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });
  }

  try {
    await signUp(first, username);
    await promoteToManager(username);
    await first.evaluate(() => fetch("/api/auth/sign-out", { method: "POST" }));
    await signIn(first, username);
    await signIn(second, username);
    await Promise.all([openQueue(first), openQueue(second)]);

    const title = `Stale queue item ${fixtureDedupKey}`;
    await expect(first.getByText(title, { exact: true })).toBeVisible();
    await expect(second.getByText(title, { exact: true })).toBeVisible();

    const firstStatus = first.getByLabel(`Status for ${title}`);
    const secondStatus = second.getByLabel(`Status for ${title}`);
    const firstOwner = first.getByLabel(`Owner for ${title}`);
    const secondOwner = second.getByLabel(`Owner for ${title}`);
    await expect(firstOwner).toHaveValue("");
    await expect(secondOwner).toHaveValue("");
    await first.screenshot({ path: testInfo.outputPath("queue-before-stale.png"), fullPage: true });
    const firstUpdate = first.waitForResponse(
      (response) =>
        response.url().includes("/api/manager-action-queue/") &&
        response.request().method() === "PATCH",
    );
    await firstStatus.selectOption("in_progress");
    await expect((await firstUpdate).status()).toBe(200);
    await first.reload({ waitUntil: "domcontentloaded" });
    await openQueue(first);
    await first.getByLabel("Filter action status").selectOption("in_progress");
    await expect(first.getByLabel(`Status for ${title}`)).toHaveValue("in_progress");
    await expect(firstStatus).toHaveValue("in_progress");
    await secondStatus.selectOption("resolved");

    await expect(second.getByRole("alert")).toContainText("changed; refresh and try again");
    await second.screenshot({ path: testInfo.outputPath("queue-stale-error.png"), fullPage: true });
    await expect(secondStatus).toHaveValue("open");
    await expect(second.getByText("Refresh queue", { exact: true })).toBeVisible();
    await expect(first.getByLabel(`Status for ${title}`)).toHaveValue("in_progress");

    await second.getByRole("button", { name: "Refresh queue", exact: true }).click();
    await second.reload({ waitUntil: "domcontentloaded" });
    await openQueue(second);
    await second.getByLabel("Filter action status").selectOption("in_progress");
    await expect(second.getByLabel(`Status for ${title}`)).toHaveValue("in_progress");
    const retryUpdate = second.waitForResponse(
      (response) =>
        response.url().includes("/api/manager-action-queue/") &&
        response.request().method() === "PATCH",
    );
    await second.getByLabel(`Status for ${title}`).selectOption("resolved");
    await expect((await retryUpdate).status()).toBe(200);
    await expect(second.getByRole("alert")).toHaveCount(0);
    await second.screenshot({ path: testInfo.outputPath("queue-recovered.png"), fullPage: true });
    await second.reload({ waitUntil: "domcontentloaded" });
    await openQueue(second);
    await second.getByLabel("Filter action status").selectOption("resolved");
    await expect(second.getByLabel(`Status for ${title}`)).toHaveValue("resolved");
    await expect(second.getByLabel(`Owner for ${title}`)).toHaveValue("");

    const db = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await db.connect();
      const row = await db.query("SELECT status, version FROM action_items WHERE id = $1", [fixtureId]);
      expect(row.rows[0]).toEqual({ status: "resolved", version: 3 });
    } finally {
      await db.end().catch(() => {});
    }
    expect(browserErrors).toEqual([]);
  } finally {
    await first.close();
    await second.close();
    await firstContext.close();
    await secondContext.close();
  }
});

test("opens a scoped sync queue item in the sync diagnostics workflow", async ({
  page,
}, testInfo: TestInfo) => {
  const username = uniqueTestId("e2e_manager_queue_source");
  testUsernames.add(username);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      browserErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  await signUp(page, username);
  await promoteToManager(username);
  await page.evaluate(() => fetch("/api/auth/sign-out", { method: "POST" }));
  await signIn(page, username);
  await openQueue(page);

  const title = `Stale queue item ${fixtureDedupKey}`;
  const item = page.getByText(title, { exact: true });
  await expect(item).toBeVisible();
  await expect(page.getByTestId("manager-action-queue")).toContainText("Sync");
  await page.screenshot({ path: testInfo.outputPath("queue-source-before.png"), fullPage: true });

  await page.getByRole("link", { name: "Open source" }).click();

  // The source link must select the Summary tab and expose the actual sync
  // workflow, rather than only updating the URL hash or invoking a callback.
  await expect(page).toHaveURL(/#sync-diagnostics$/);
  await expect(page.locator('button[title="Sync connected"], button[title^="Sync:"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Download sync diagnostics" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("queue-source-sync-workflow.png"), fullPage: true });
  expect(browserErrors).toEqual([]);
});

test("opens an incident queue item in the matching incident review surface", async ({
  page,
}, testInfo: TestInfo) => {
  const username = uniqueTestId("e2e_manager_incident_source");
  testUsernames.add(username);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      browserErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  await signUp(page, username);
  await promoteToManager(username);
  await page.evaluate(() => fetch("/api/auth/sign-out", { method: "POST" }));
  await signIn(page, username);
  await openQueue(page);

  await expect(page.getByText(`Incident source ${incidentFixtureId}`, { exact: true })).toBeVisible();
  await expect(page.getByTestId("manager-action-queue")).toContainText("Incident");
  await page.screenshot({ path: testInfo.outputPath("incident-queue-source-before.png"), fullPage: true });

  const visibleQueue = page.locator('[data-testid="manager-action-queue"]:visible');
  const incidentHeader = visibleQueue
    .getByText(`Incident source ${incidentFixtureId}`, { exact: true })
    .locator("xpath=../../..");
  await incidentHeader.getByRole("link", { name: "Open source" }).click();

  // Assert the rendered review surface and the selected incident's content,
  // not merely the hash that the source link wrote.
  await expect(page).toHaveURL(new RegExp(`#incidents/${incidentFixtureId}$`));
  await expect(page.getByText("Reported issues", { exact: true })).toBeVisible();
  const selectedIncident = page
    .getByText(`Unique incident review ${incidentFixtureId}`, { exact: true })
    .first();
  await expect(selectedIncident).toBeVisible();
  await expect(page.getByText("Queue fixture diagnosis", { exact: true }).first()).toBeVisible();
  await expect(selectedIncident.locator("xpath=../../..").getByRole("button", { name: "Mark reviewed", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("incident-queue-review-surface.png"), fullPage: true });
  expect(browserErrors).toEqual([]);
});