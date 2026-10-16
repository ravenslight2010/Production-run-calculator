import { expect, test } from "@playwright/test";
import { Client } from "pg";
import {
  AuthorizedBrowserFixtures,
  requireDedicatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { requireLocalFixtureApiOrigin } from "./isolatedApiOrigin";

const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";

function facilityToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
}

test("renders the daily allergen report from recorded current-day sources", async ({
  browser,
  playwright,
  baseURL,
}) => {
  test.skip(!baseURL, "The isolated browser runner must provide a local web origin.");
  const webOrigin = baseURL!;
  const apiBase = requireLocalFixtureApiOrigin("QC allergen activity responsive browser test");
  const fixtureDbUrl = requireDedicatedTestDatabase("QC allergen activity responsive browser test");
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, apiBase, SIGNUP_CODE);
  const username = uniqueTestId("qc-activity-operator");
  const runId = uniqueTestId("qc-activity-run");
  const date = facilityToday();
  const operationId = uniqueTestId("qc-activity-review-operation");
  const recordId = uniqueTestId("qc-activity-review-record");
  const db = new Client({ connectionString: fixtureDbUrl });
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;

  try {
    await db.connect();
    const account = await fixtures.createAccount({
      username,
      password: "TestPass123!",
      capabilities: ["record-qc"],
      onboardingSeen: true,
    });
    await fixtures.seedTodaySync({
      token: account.token,
      senderId: uniqueTestId("qc-activity-sync-sender"),
      date,
      payload: {
        dayState: {
          date,
          runs: [{ id: runId, brand: "Responsive Fixture", flavor: "Cheese", casesNeeded: 1, seeded: false }],
          currentIndex: 0,
          resetAt: 0,
          substitutions: [],
          substitutionLog: [],
          stagedItems: {},
        },
        runValues: { [runId]: { allergen: "none", casesNeeded: 1, casesPerSkid: 12 } },
        runValuesUpdatedAt: { [runId]: Date.now() },
        packagingProgress: {},
      },
    });
    await db.query(
      `INSERT INTO qc_workflow_events
         (scope, operation_id, record_id, event_type, run_id, actor_id, payload)
       VALUES ('live', $1, $2, 'allergen-review', $3, $4, $5::jsonb)`,
      [
        operationId,
        recordId,
        runId,
        account.userId,
        JSON.stringify({
          footprintReviewed: true,
          footprint: { status: "complete", allergens: [], unknownIngredients: [], missingComponents: [] },
          note: "Responsive fixture review",
        }),
      ],
    );

    context = await browser.newContext({
      viewport: test.info().project.use.viewport as { width: number; height: number } | undefined,
    });
    await context.addCookies([{
      name: "rc_auth",
      value: account.token,
      url: new URL(webOrigin).origin,
      httpOnly: true,
      sameSite: "Lax",
    }]);
    const page = await context.newPage();
    await page.goto(webOrigin, { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await page.getByTitle("More").click();
    await page.getByRole("menuitem", { name: "QC workflows & history", exact: true }).click();
    await expect(page.getByTestId("qc-workflow-tab")).toBeVisible();
    await page.getByTestId("button-toggle-allergen-activity").click();

    const report = page.getByTestId("qc-allergen-activity-report");
    await expect(report).toBeVisible();
    await expect(report.getByLabel("Production date")).toHaveValue(date);
    await expect(page.getByTestId(`card-allergen-activity-${runId}`)).toContainText("Current-day snapshot");
    await expect(page.getByTestId(`text-manual-allergen-${runId}`)).toContainText("none · recorded");
    await expect(page.getByTestId(`text-derived-review-${runId}`))
      .toHaveText("Reviewed — no tracked allergens recorded");
    await expect(report).toContainText("Recorded activity only.");
    await expect(report).toContainText("does not establish cleaning between runs");
    await expect(page.getByRole("button", { name: "Back to run QC" })).toBeVisible();
  } finally {
    await context?.close().catch(() => {});
    await db.query(
      "DELETE FROM qc_workflow_events WHERE scope = 'live' AND run_id = $1 AND operation_id = $2",
      [runId, operationId],
    ).catch(() => {});
    await db.end().catch(() => {});
    await fixtures.cleanup({ syncDates: [date] });
  }
});
