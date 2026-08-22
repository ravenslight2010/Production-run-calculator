/**
 * E2E: Sync diagnostics can be downloaded from the authenticated home screen.
 *
 * This intentionally uses a healthy, fresh account. The browser download path
 * should be verifiable independently of a real sync failure.
 */

import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
} from "./isolation";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const testUsernames = new Set<string>();

function uid(): string {
  return `e2e_sync_diag_${Math.random().toString(36).slice(2, 10)}`;
}

test.beforeAll(async () => {
  await requireIsolatedTestDatabase();
});

test.afterAll(async () => {
  if (!process.env.DATABASE_URL || testUsernames.size === 0) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await cleanupTestUsers(db, testUsernames);
  } finally {
    await db.end().catch(() => {});
  }
});

async function signUp(page: Page, username: string): Promise<void> {
  await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#confirm").fill(PASSWORD);
  await page.locator("#accessCode").fill(SIGNUP_CODE);
  await page.getByRole("button", { name: /create.?account|sign.?up/i }).click();

  await page.getByTestId("tab-run").waitFor({
    state: "attached",
    timeout: 25_000,
  });
  const getStarted = page.getByRole("button", { name: /^get.?started$/i });
  if (await getStarted.isVisible().catch(() => false)) {
    await getStarted.click();
    await page
      .locator('[data-state="open"][aria-hidden="true"]')
      .waitFor({ state: "detached", timeout: 5_000 })
      .catch(() => {});
  }
}

test("downloads a date-scoped sync diagnostic JSON report", async ({ page }) => {
  const username = uid();
  testUsernames.add(username);
  await signUp(page, username);

  const syncStatus = page.locator('button[title^="Sync:"]');
  await expect(syncStatus).toBeVisible();
  await syncStatus.click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download sync diagnostics" }).click();
  const download = await downloadPromise;

  const today = await page.evaluate(() => {
    const date = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  });
  expect(download.suggestedFilename()).toBe(
    `sync-diagnostic-history-${today}.json`,
  );

  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const report = JSON.parse(await readFile(downloadPath as string, "utf8"));
  expect(report).toEqual(
    expect.objectContaining({
      reportType: "sync-diagnostic-history",
      label: "Sync diagnostic history",
      scope: "current facility",
      productionDate: today,
      status: expect.any(String),
      lastAcknowledgedAt: expect.anything(),
      pendingCount: expect.any(Number),
      failedCount: expect.any(Number),
      responseCategories: expect.any(Object),
      affectedRunIds: expect.any(Array),
      events: expect.any(Array),
    }),
  );
  expect(report.exportedAt).toEqual(expect.any(String));
  expect(Number.isNaN(Date.parse(report.exportedAt))).toBe(false);
  expect(report.events.length).toBeGreaterThan(0);
  for (const event of report.events) {
    expect(event).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        kind: expect.any(String),
        at: expect.any(Number),
        date: today,
        message: expect.any(String),
      }),
    );
  }
});

test("filters older local sync diagnostics from the downloaded report", async ({ page }) => {
  const username = uid();
  testUsernames.add(username);
  await signUp(page, username);

  const dates = await page.evaluate(() => {
    const current = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    const format = (date: Date) =>
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const prior = new Date(current);
    prior.setDate(prior.getDate() - 1);
    return { current: format(current), prior: format(prior) };
  });
  const seededEvents = {
    prior: {
      id: "e2e-prior-date-sync-event",
      kind: "failure",
      at: Date.now() - 60_000,
      date: dates.prior,
      message: "Prior production date diagnostic should be excluded",
    },
    current: {
      id: "e2e-current-date-sync-event",
      kind: "ack",
      at: Date.now(),
      date: dates.current,
      message: "Current production date diagnostic should be included",
    },
  };

  await page.evaluate(({ dates, seededEvents }) => {
    localStorage.setItem(
      `run-calc-sync-diagnostics:${dates.prior}`,
      JSON.stringify([seededEvents.prior]),
    );
    localStorage.setItem(
      `run-calc-sync-diagnostics:${dates.current}`,
      JSON.stringify([seededEvents.current]),
    );
  }, { dates, seededEvents });
  await page.reload({ waitUntil: "domcontentloaded" });

  const syncStatus = page.locator('button[title^="Sync:"]');
  await expect(syncStatus).toBeVisible();
  await syncStatus.click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download sync diagnostics" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();

  const report = JSON.parse(await readFile(downloadPath as string, "utf8"));
  expect(report.productionDate).toBe(dates.current);
  expect(report.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: seededEvents.current.id,
        date: dates.current,
        message: seededEvents.current.message,
      }),
    ]),
  );
  expect(report.events).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: seededEvents.prior.id,
        date: dates.prior,
      }),
    ]),
  );
  for (const event of report.events) {
    expect(event.date).toBe(dates.current);
  }
});
