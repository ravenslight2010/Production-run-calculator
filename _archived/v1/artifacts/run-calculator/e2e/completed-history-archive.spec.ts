import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { DEFAULT_VALUES, type FormValues, type RunMeta } from "../src/types";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { signUpAndHandleOnboarding } from "./onboarding";

const PASSWORD = "CompletedHistoryBrowser123!";
const username = uniqueTestId("completed_history_reader");
const runId = uniqueTestId("completed_history_run");
const date = "2031-02-03";
const startedAt = Date.parse(`${date}T14:00:00.000Z`);
const endedAt = Date.parse(`${date}T15:00:00.000Z`);
const brand = `Archive Bakery ${runId}`;
const flavor = "Synthetic completed run";
const run: RunMeta = {
  id: runId,
  brand,
  flavor,
  startedAt,
  endedAt,
  actualCases: 7,
  stoppages: [],
};
const values: FormValues = {
  ...DEFAULT_VALUES,
  casesNeeded: 7,
  pizzasPerCase: 8,
};
const completion = {
  operationId: `task3722:${runId}`,
  runId,
  date,
  completedAt: new Date(endedAt).toISOString(),
  snapshot: {
    dayState: { date, currentIndex: 0, runs: [run] },
    runValues: { [runId]: values },
  },
};

test.beforeAll(async () => {
  await requireIsolatedTestDatabase("completed-history archive browser test");
});

test.afterAll(async () => {
  if (!process.env.DATABASE_URL) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await cleanupTestUsers(db, [username]);
  } finally {
    await db.end().catch(() => {});
  }
});

test("signed-in staff can read a saved completed run after reload", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      errors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: process.env.STAFF_SIGNUP_CODE ?? "",
    waitForApp: (currentPage) =>
      currentPage.getByTestId("tab-run").waitFor({ state: "attached", timeout: 30_000 }),
  });

  const postCompletion = async (payload: Record<string, unknown>) =>
    page.evaluate(async (body) => {
      const response = await fetch("/api/completed-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    }, payload);

  const rejected = await postCompletion({
    ...completion,
    snapshot: {
      ...completion.snapshot,
      dayState: { ...completion.snapshot.dayState, date: "2031-02-02" },
    },
  });
  expect(rejected.status, "invalid date/snapshot boundary is rejected").toBe(400);

  const created = await postCompletion(completion);
  expect(created.status).toBe(201);
  expect(created.body.acknowledged).toBe(true);
  const duplicate = await postCompletion(completion);
  expect(duplicate.status).toBe(200);
  expect(duplicate.body.duplicate).toBe(true);

  const reloadHistory = page.waitForResponse((response) =>
    response.request().method() === "GET" &&
    new URL(response.url()).pathname === "/api/completed-history",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 30_000 });
  const historyResponse = await reloadHistory;
  expect(historyResponse.status()).toBe(200);
  const serverHistory = await historyResponse.json() as {
    history?: Array<{ runId: string; date: string }>;
  };
  expect(serverHistory.history).toContainEqual(expect.objectContaining({ runId, date }));

  const openSummary = async () => {
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Summary", exact: true }).click();
  };
  const verifyArchivedRun = async () => {
    await openSummary();
    await expect(page.getByText("History (1 day)", { exact: true }))
      .toBeVisible({ timeout: 20_000 });
    const dayButton = page.locator('button[aria-expanded="false"]').filter({ hasText: date });
    await expect(dayButton).toHaveCount(1);
    await dayButton.click();
    const summary = page.getByTestId(`run-summary-${runId}`);
    await expect(summary).toBeVisible();
    await expect(summary).toContainText(brand);
    await expect(summary).toContainText(flavor);
    await expect(summary).toContainText("Finished");
  };

  await verifyArchivedRun();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 30_000 });
  await verifyArchivedRun();
  expect(errors).toEqual([]);
});
