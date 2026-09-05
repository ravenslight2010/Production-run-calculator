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
import {
  dismissOnboardingIfPresent,
  signUpAndHandleOnboarding,
} from "./onboarding";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const testUsernames = new Set<string>();
let fixtureId: number | null = null;
let fixtureDedupKey = "";
let staleWriteFixtureId: number | null = null;
let staleWriteDedupKey = "";
let incidentFixtureId = "";
let incidentQueueFixtureId: number | null = null;
const LARGE_HISTORY_COUNT = 750;
let largeHistoryPrefix = "";

async function dismissWelcomeIfPresent(page: Page, timeout = 1_500): Promise<void> {
  // The shell mounts before the onboarding query resolves. Checking
  // isVisible() immediately after tab-run is therefore racy: the dialog can
  // appear after the check and intercept the next header-menu interaction.
  await dismissOnboardingIfPresent(page, { visibilityTimeout: timeout });
}

async function signUp(page: Page, username: string): Promise<void> {
  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: SIGNUP_CODE,
    onboarding: { visibilityTimeout: 5_000 },
  });
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
    // Other browser fixtures may tailor the built-in manager row for their
    // own journey. Restore the complete role here so this file remains
    // independent of serial suite ordering, including the incident source
    // journeys below.
    await db.query(
      "UPDATE roles SET capabilities = $1::jsonb WHERE name = 'manager'",
      [JSON.stringify([
        "manage-staff",
        "manage-inventory",
        "edit-production-rules",
        "approve-password-resets",
        "review-incidents",
        "use-ai-tools",
        "manage-factory-settings",
        "manage-profiles",
      ])],
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

async function revealHistoryItem(page: Page, title: string): Promise<void> {
  const itemStatus = page.getByLabel(`Status for ${title}`);
  for (let pageNumber = 0; pageNumber < 12 && !(await itemStatus.isVisible().catch(() => false)); pageNumber += 1) {
    const loadOlder = page.getByRole("button", { name: "Load older history", exact: true });
    if (!(await loadOlder.isVisible().catch(() => false))) break;
    await loadOlder.click();
  }
  await expect(itemStatus).toBeVisible();
}

function scopeQueueBody(body: string): string {
  const payload = JSON.parse(body) as {
    items: Array<{ category: string; status: string }>;
    counts: Record<string, number>;
  };
  payload.items = payload.items.filter((item) => item.category === "report");
  payload.counts = Object.fromEntries(
    ["open", "in_progress", "deferred", "resolved"]
      .map((status) => [status, payload.items.filter((item) => item.status === status).length]),
  );
  return JSON.stringify(payload);
}

test.beforeAll(async () => {
  await requireIsolatedTestDatabase("manager action queue stale-write e2e");
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  fixtureDedupKey = `e2e:${uniqueTestId("manager_queue_stale")}`;
  try {
    await db.connect();
    incidentFixtureId = uniqueTestId("incident_queue_source");
    fixtureDedupKey = `e2e:${uniqueTestId("manager_queue_source")}`;
    staleWriteDedupKey = `e2e:${uniqueTestId("manager_queue_stale")}`;
    largeHistoryPrefix = `e2e:${uniqueTestId("manager_queue_history")}`;
    // Recover fixtures left by an interrupted browser run before creating the
    // new bounded history corpus. The marker is exclusive to this scenario.
    await db.query(
      "DELETE FROM action_items WHERE dedup_key LIKE 'e2e:%manager_queue_history%:%'",
    );
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
    const staleWriteResult = await db.query(
      `INSERT INTO action_items
         (scope, dedup_key, category, severity, title, description, source_type, source_id, source_path, status, version)
       VALUES ($1, $2, 'report', 'warning', $3, $4, 'report', $5, '#manager-action-queue', 'open', 1)
       RETURNING id`,
      [
        "live",
        staleWriteDedupKey,
        `Stale queue item ${staleWriteDedupKey}`,
        "Two managers must recover this stale update.",
        staleWriteDedupKey,
      ],
    );
    staleWriteFixtureId = staleWriteResult.rows[0].id as number;
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
    await db.query(
      `INSERT INTO action_items
        (scope, dedup_key, category, severity, title, description, source_type, source_id, source_path, status, version)
       SELECT 'live', $1 || ':' || series::text, 'import', 'warning',
         'Historical queue item ' || series::text,
         'Large-history performance fixture',
         'report', $1 || ':' || series::text, '#manager-action-queue', 'resolved', 1
       FROM generate_series(1, $2) AS series`,
      [largeHistoryPrefix, LARGE_HISTORY_COUNT],
    );
  } finally {
    await db.end().catch(() => {});
  }
});

// The first scenario intentionally advances the shared fixture through
// in_progress -> resolved. Restore its initial version before each independent
// journey so later navigation checks do not depend on test order.
test.beforeEach(async () => {
  if (staleWriteFixtureId === null || !process.env.DATABASE_URL) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await db.query(
      "UPDATE action_items SET status = 'open', version = 1, updated_at = NOW() WHERE id = $1",
      [staleWriteFixtureId],
    );
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
    if (staleWriteFixtureId !== null) await db.query("DELETE FROM action_items WHERE id = $1", [staleWriteFixtureId]);
    if (incidentQueueFixtureId !== null) await db.query("DELETE FROM action_items WHERE id = $1", [incidentQueueFixtureId]);
    if (largeHistoryPrefix) await db.query("DELETE FROM action_items WHERE dedup_key LIKE $1", [`${largeHistoryPrefix}:%`]);
    if (incidentFixtureId) {
      await db.query("DELETE FROM action_items WHERE source_type = 'incident' AND source_id = $1", [incidentFixtureId]);
      await db.query("DELETE FROM incidents WHERE id = $1", [incidentFixtureId]);
    }
    await cleanupTestUsers(db, testUsernames);
  } finally {
    await db.end().catch(() => {});
  }
});

test("loads the active view without hiding large queue history", async ({ page }, testInfo: TestInfo) => {
  // Rendering and paging the intentionally large history fixture is a bounded
  // performance scenario, not a unit-sized interaction. Keep the timeout
  // explicit so the release gate does not fail at Playwright's generic 60s
  // limit while retaining every response, rendering, and browser assertion.
  test.setTimeout(180_000);
  const username = uniqueTestId("e2e_manager_queue_scale");
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
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

  const initialResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/manager-action-queue") &&
      !response.url().includes("status=all"),
  );
  await openQueue(page);
  const initialPayload = await (await initialResponse).json() as {
    items: Array<{ status: string; title: string }>;
    counts: Record<string, number>;
  };
  expect(initialPayload.items.every((item) => item.status === "open")).toBe(true);
  expect(initialPayload.items.some((item) => item.title.startsWith("Historical queue item"))).toBe(false);
  expect(initialPayload.counts.resolved).toBeGreaterThanOrEqual(LARGE_HISTORY_COUNT);
  await expect(
    page.getByLabel("Filter action status").locator("option[value='resolved']"),
  ).toContainText(String(LARGE_HISTORY_COUNT));
  await expect(
    page.getByTestId("manager-action-queue").locator('[data-testid^="attention-state-"]'),
  ).toHaveCount(initialPayload.items.length);
  await page.screenshot({ path: testInfo.outputPath("queue-large-history-default.png") });

  const allResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/manager-action-queue") &&
      !new URL(response.url()).searchParams.has("status"),
  );
  await page.getByLabel("Filter action status").selectOption("all");
  const allPayload = await (await allResponse).json() as {
    items: Array<{ status: string }>;
    counts: Record<string, number>;
    nextCursor: string | null;
  };
  expect(allPayload.items.length).toBeLessThan(LARGE_HISTORY_COUNT);
  expect(allPayload.nextCursor).toBeTruthy();
  expect(allPayload.counts.resolved).toBeGreaterThanOrEqual(LARGE_HISTORY_COUNT);
  await expect(
    page.getByText(`Historical queue item ${LARGE_HISTORY_COUNT}`, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Historical queue item 1", { exact: true })).toHaveCount(0);
  const oldestHistoryItem = page.getByText("Historical queue item 1", { exact: true });
  // Visibility is viewport-dependent: after a page append the oldest row can
  // already be mounted just below the viewport while the paging button has
  // correctly disappeared. Check attachment to decide whether another cursor
  // request is needed, then keep the actual visibility assertion below.
  for (let pageNumber = 0; pageNumber < 10 && (await oldestHistoryItem.count()) === 0; pageNumber += 1) {
    const nextPageResponse = page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === "GET" &&
          url.pathname.endsWith("/api/manager-action-queue") &&
          url.searchParams.has("cursor")
        );
      },
    );
    await page.getByRole("button", { name: "Load older history", exact: true }).click();
    await expect((await nextPageResponse).ok()).toBe(true);
    // The click starts an async cursor request. Do not issue the next click
    // while this one is disabled: on the final page the button is removed as
    // soon as item 1 mounts, which can strand a pending Playwright click.
    await expect.poll(async () => {
      if (await oldestHistoryItem.count() > 0) return "item-loaded";
      const button = page.getByRole("button", { name: "Load older history", exact: true });
      if (await button.count() === 0) return "button-missing";
      return await button.isEnabled() ? "ready" : "loading";
    }, { timeout: 10_000 }).toMatch(/^(item-loaded|ready)$/);
  }
  await oldestHistoryItem.scrollIntoViewIfNeeded();
  await expect(oldestHistoryItem).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("queue-large-history-all.png") });
  expect(browserErrors).toEqual([]);
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
    // A full reload re-reads the promoted role from /me without spending
    // another sign-out/sign-in cycle. Sign-up already marked onboarding seen.
    await first.reload({ waitUntil: "domcontentloaded" });
    await first.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await signIn(second, username);
    const queueRoute = "**/api/manager-action-queue";
    let initialQueueBody: string | undefined;
    await first.route(queueRoute, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: scopeQueueBody(await response.text()) });
    });
    await second.route(queueRoute, async (route) => {
      const response = await route.fetch();
      const body = initialQueueBody ?? scopeQueueBody(await response.text());
      initialQueueBody ??= body;
      await route.fulfill({ response, body });
    });
    await Promise.all([openQueue(first), openQueue(second)]);
    // This fixture is a report item. Scope both views before locating the
    // fixture so accumulated historical import findings do not make the
    // serial release browser render hundreds of unrelated cards first.
    await first.getByLabel("Filter action category").selectOption("report");
    await second.getByLabel("Filter action category").selectOption("report");

    const title = `Stale queue item ${staleWriteDedupKey}`;
    await expect(first.getByText(title, { exact: true })).toBeVisible();
    await expect(second.getByText(title, { exact: true })).toBeVisible();
    await first.getByLabel("Filter action status").selectOption("all");
    // Keep the second manager's stale row rendered after the first manager
    // advances it. The all-status view preserves the stale snapshot needed
    // for the intentional 409, rather than filtering the row out underneath
    // the second page.
    await second.getByLabel("Filter action status").selectOption("all");

    const firstStatus = first.getByLabel(`Status for ${title}`);
    const secondStatus = second.getByLabel(`Status for ${title}`);
    const firstOwner = first.getByLabel(`Owner for ${title}`);
    const secondOwner = second.getByLabel(`Owner for ${title}`);
    await expect(firstOwner).toHaveValue("");
    await expect(secondOwner).toHaveValue("");
    await first.screenshot({ path: testInfo.outputPath("queue-before-stale.png") });
    const firstUpdate = first.waitForResponse(
      (response) =>
        response.url().includes("/api/manager-action-queue/") &&
        response.request().method() === "PATCH",
    );
    await firstStatus.selectOption("in_progress");
    await expect((await firstUpdate).status()).toBe(200);
    await expect(firstStatus).toHaveValue("in_progress");
    await secondStatus.selectOption("resolved");

    await expect(second.getByRole("alert")).toContainText("changed; refresh and try again");
    await second.screenshot({ path: testInfo.outputPath("queue-stale-error.png") });
    await expect(secondStatus).toHaveValue("open");
    await expect(second.getByText("Refresh queue", { exact: true })).toBeVisible();
    await expect(first.getByLabel(`Status for ${title}`)).toHaveValue("in_progress");

    await second.unroute(queueRoute);
    await second.getByRole("button", { name: "Refresh queue", exact: true }).click();
    await second.reload({ waitUntil: "domcontentloaded" });
    await openQueue(second);
    await second.getByLabel("Filter action category").selectOption("report");
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
    await second.screenshot({ path: testInfo.outputPath("queue-recovered.png") });
    await second.reload({ waitUntil: "domcontentloaded" });
    await openQueue(second);
    await second.getByLabel("Filter action category").selectOption("report");
    await second.getByLabel("Filter action status").selectOption("resolved");
    await revealHistoryItem(second, title);
    await expect(second.getByLabel(`Status for ${title}`)).toHaveValue("resolved");
    await expect(second.getByLabel(`Owner for ${title}`)).toHaveValue("");

    const db = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await db.connect();
      const row = await db.query("SELECT status, version FROM action_items WHERE id = $1", [staleWriteFixtureId]);
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
  // Keep the established session and reload so the freshly promoted role is
  // fetched again without paying for another full authentication journey.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await openQueue(page);

  const title = `Stale queue item ${fixtureDedupKey}`;
  // This journey exercises the real sync source link. Scope the queue before
  // locating it so accumulated historical action items do not turn a
  // navigation assertion into a full-history render.
  await page.getByLabel("Filter action category").selectOption("sync");
  const item = page.getByText(title, { exact: true });
  await expect(item).toBeVisible();
  await expect(page.getByTestId("manager-action-queue")).toContainText("Sync");
  await page.screenshot({ path: testInfo.outputPath("queue-source-before.png") });

  const visibleQueue = page.locator('[data-testid="manager-action-queue"]:visible');
  const syncHeader = visibleQueue
    .getByText(title, { exact: true })
    .locator("xpath=../../..");
  await syncHeader.getByRole("link", { name: "Open source" }).click();

  // The source link must select the Summary tab and expose the actual sync
  // workflow, rather than only updating the URL hash or invoking a callback.
  await expect(page).toHaveURL(/#sync-diagnostics$/);
  await expect(page.locator('button[title="Sync connected"], button[title^="Sync:"]')).toBeVisible();
  // The source link selects the diagnostics workflow; the download action is
  // inside the status popover, so open that user-facing control before checking
  // its action rather than relying on hidden DOM content.
  await page.locator('button[title="Sync connected"], button[title^="Sync:"]').click();
  await expect(page.getByRole("button", { name: "Download sync diagnostics" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("queue-source-sync-workflow.png") });
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

test("keeps a direct incident link focused after reload", async ({ page }, testInfo: TestInfo) => {
  const username = uniqueTestId("e2e_manager_incident_reload");
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

  const incidentUrl = `/#incidents/${encodeURIComponent(incidentFixtureId)}`;
  // Use a new page in the authenticated context so this is a true direct
  // entry, rather than a hash-only navigation on the already-mounted shell.
  const directPage = await page.context().newPage();
  directPage.on("pageerror", (error) => browserErrors.push(error.message));
  directPage.on("response", (response) => {
    if (response.status() >= 500) {
      browserErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  await directPage.goto(incidentUrl, { waitUntil: "domcontentloaded" });
  await expect(directPage).toHaveURL(new RegExp(`#incidents/${incidentFixtureId}$`));
  await expect(directPage.getByText("Reported issues", { exact: true })).toBeVisible();
  const selectedIncident = directPage
    .getByText(`Unique incident review ${incidentFixtureId}`, { exact: true })
    .first();
  await expect(selectedIncident).toBeVisible();
  await expect(directPage.getByText("Queue fixture diagnosis", { exact: true }).first()).toBeVisible();
  await expect(
    selectedIncident.locator("xpath=../../..").getByRole("button", { name: "Mark reviewed", exact: true }),
  ).toBeVisible();

  await directPage.reload({ waitUntil: "domcontentloaded" });
  await expect(directPage).toHaveURL(new RegExp(`#incidents/${incidentFixtureId}$`));
  await expect(directPage.getByText("Reported issues", { exact: true })).toBeVisible();
  await expect(selectedIncident).toBeVisible();
  await expect(directPage.getByText("Queue fixture diagnosis", { exact: true }).first()).toBeVisible();
  await expect(
    selectedIncident.locator("xpath=../../..").getByRole("button", { name: "Mark reviewed", exact: true }),
  ).toBeVisible();
  await directPage.screenshot({ path: testInfo.outputPath("incident-direct-link-reload.png"), fullPage: true });
  await directPage.close();
  expect(browserErrors).toEqual([]);
});

test("keeps a direct sync diagnostics link focused after reload", async ({ page }, testInfo: TestInfo) => {
  const username = uniqueTestId("e2e_manager_sync_reload");
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

  // Use a new page in the authenticated context so this is a true direct
  // entry, rather than a hash-only navigation on the already-mounted shell.
  const directPage = await page.context().newPage();
  directPage.on("pageerror", (error) => browserErrors.push(error.message));
  directPage.on("response", (response) => {
    if (response.status() >= 500) {
      browserErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  try {
    await directPage.goto("/#sync-diagnostics", { waitUntil: "domcontentloaded" });
    await expect(directPage).toHaveURL(/#sync-diagnostics$/);
    await expect(directPage.getByTestId("summary-tools-header")).toBeVisible();
    await expect(directPage.locator('button[title="Sync connected"], button[title^="Sync:"]')).toBeVisible();
    await directPage.locator('button[title="Sync connected"], button[title^="Sync:"]').click();
    await expect(directPage.getByRole("button", { name: "Download sync diagnostics" })).toBeVisible();

    await directPage.reload({ waitUntil: "domcontentloaded" });
    await expect(directPage).toHaveURL(/#sync-diagnostics$/);
    await expect(directPage.getByTestId("summary-tools-header")).toBeVisible();
    await expect(directPage.locator('button[title="Sync connected"], button[title^="Sync:"]')).toBeVisible();
    await directPage.locator('button[title="Sync connected"], button[title^="Sync:"]').click();
    await expect(directPage.getByRole("button", { name: "Download sync diagnostics" })).toBeVisible();
    // Summary includes a large, live operations surface. A viewport capture
    // retains the visible diagnostics evidence without spending the test
    // budget rasterizing its full scroll height.
    await directPage.screenshot({ path: testInfo.outputPath("sync-diagnostics-direct-link-reload.png") });
    expect(browserErrors).toEqual([]);
  } finally {
    await directPage.close();
  }
});
