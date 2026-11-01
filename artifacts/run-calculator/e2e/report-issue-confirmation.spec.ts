import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import {
  AuthorizedBrowserFixtures,
  cleanupTestUsers,
  requireDedicatedTestDatabase,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { requireLocalFixtureApiOrigin } from "./isolatedApiOrigin";
import { signUpAndHandleOnboarding } from "./onboarding";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const testUsernames = new Set<string>();
const incidentIds = new Set<string>();

test.beforeAll(() => {
  requireIsolatedTestDatabase("issue report confirmation browser test");
});

test.afterAll(async () => {
  if (!process.env.DATABASE_URL) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    if (incidentIds.size > 0) {
      await db.query("DELETE FROM incidents WHERE id = ANY($1::text[])", [
        [...incidentIds],
      ]);
    }
    await cleanupTestUsers(db, testUsernames);
  } finally {
    await db.end().catch(() => {});
  }
});

test("staff can retry a failed issue report without retyping and sees its diagnostic reference", async ({
  page,
}) => {
  const username = uniqueTestId("issue_report");
  testUsernames.add(username);
  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: SIGNUP_CODE,
  });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

  await page.getByTitle("More").click();
  await page.getByRole("menuitem", { name: "Report an issue", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Report an issue" });
  const description = "The Save button did not respond.";
  const descriptionField = dialog.getByPlaceholder(/tapped Save/i);
  await descriptionField.fill(description);

  let rejectNextReport = true;
  await page.route("**/api/incidents", async (route) => {
    if (route.request().method() === "POST" && rejectNextReport) {
      rejectNextReport = false;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await dialog.getByRole("button", { name: "Send report" }).click();
  await expect(dialog).toContainText("Couldn't send your report. Please try again.");
  await expect(descriptionField).toHaveValue(description);

  const submission = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/api/incidents"),
  );
  await dialog.getByRole("button", { name: "Send report" }).click();
  const response = await submission;
  expect(response.status()).toBe(200);
  const result = await response.json() as {
    incidentId: string;
    correlationId: string;
    recurrence: unknown;
  };
  incidentIds.add(result.incidentId);

  await expect(descriptionField).not.toBeVisible();
  await expect(dialog).toContainText("Your report was recorded for manager review.");
  await expect(dialog.locator("code")).toHaveText(result.correlationId);
  await expect(dialog).not.toContainText(/seen before|last time this helped|kind of problem has come up before/i);
  expect(result.recurrence).toBeNull();
});

test("manager reviews a staff issue report and retains the review after reload", async ({
  browser,
  playwright,
  request,
  baseURL,
}, testInfo) => {
  test.skip(!baseURL, "Requires the isolated browser runner.");
  const apiOrigin = requireLocalFixtureApiOrigin(
    "manager issue-report review browser verification",
  );
  const fixtures = await AuthorizedBrowserFixtures.create(
    playwright,
    apiOrigin,
    SIGNUP_CODE,
  );
  const databaseUrl = requireDedicatedTestDatabase(
    "manager issue-report review browser verification",
  );
  const createdIncidentIds = new Set<string>();
  const contexts: Array<Awaited<ReturnType<typeof browser.newContext>>> = [];
  let db: Client | null = null;

  const openAuthenticated = async (token: string): Promise<Page> => {
    const context = await browser.newContext({
      viewport: testInfo.project.use.viewport as
        | { width: number; height: number }
        | undefined,
      serviceWorkers: "block",
    });
    contexts.push(context);
    await context.addCookies([
      {
        name: "rc_auth",
        value: token,
        url: new URL(baseURL!).origin,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
    await page.goto(baseURL!, { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({
      state: "attached",
      timeout: 25_000,
    });
    return page;
  };

  try {
    db = new Client({ connectionString: databaseUrl });
    await db.connect();
    const manager = await fixtures.createAccount({
      username: uniqueTestId("issue_review_manager"),
      password: PASSWORD,
      capabilities: [],
      onboardingSeen: true,
    });
    await fixtures.assignManagerRole(manager);
    const staff = await fixtures.createAccount({
      username: uniqueTestId("issue_review_staff"),
      password: PASSWORD,
      capabilities: [],
      onboardingSeen: true,
    });

    const denied = await request.get(`${apiOrigin}/api/incidents`, {
      headers: staff.cookieHeader,
    });
    expect(denied.status()).toBe(403);

    const description = "Synthetic report for manager review";
    const submitted = await request.post(`${apiOrigin}/api/incidents`, {
      headers: staff.cookieHeader,
      data: {
        source: "user_report",
        screen: "Run",
        appPlatform: "web",
        description,
      },
    });
    expect(submitted.status()).toBe(200);
    const report = (await submitted.json()) as {
      incidentId: string;
      correlationId: string;
    };
    createdIncidentIds.add(report.incidentId);

    const managerPage = await openAuthenticated(manager.token);
    await managerPage.getByTitle("More").click();
    await managerPage
      .getByRole("menuitem", { name: "Reported issues", exact: true })
      .click();
    const incident = managerPage
      .getByTestId("incident-row")
      .filter({ hasText: staff.username })
      .filter({ hasText: report.correlationId });
    await expect(incident).toBeVisible();
    await expect(incident).toContainText(report.correlationId);
    const reviewResponse = managerPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          `/api/incidents/${report.incidentId}/review`,
    );
    await incident
      .getByRole("button", { name: "Mark reviewed", exact: true })
      .click();
    expect((await reviewResponse).status()).toBe(200);
    await expect(
      incident.getByText("Reviewed", { exact: true }).first(),
    ).toBeVisible();

    await managerPage.reload({ waitUntil: "domcontentloaded" });
    await managerPage.getByTestId("tab-run").waitFor({
      state: "attached",
      timeout: 25_000,
    });
    await managerPage.getByTitle("More").click();
    await managerPage
      .getByRole("menuitem", { name: "Reported issues", exact: true })
      .click();
    const reloadedIncident = managerPage
      .getByTestId("incident-row")
      .filter({ hasText: staff.username })
      .filter({ hasText: report.correlationId });
    await expect(reloadedIncident).toBeVisible();
    await expect(
      reloadedIncident.getByText("Reviewed", { exact: true }),
    ).toBeVisible();
    await reloadedIncident
      .getByRole("button")
      .first()
      .click();
    await expect(reloadedIncident).toContainText(description);
    await expect(reloadedIncident).toContainText(report.correlationId);
    await expect(
      reloadedIncident.getByRole("button", {
        name: "Mark reviewed",
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    for (const context of contexts) {
      await context.close().catch(() => {});
    }
    if (db) {
      try {
        if (createdIncidentIds.size > 0) {
          await db.query("DELETE FROM incidents WHERE id = ANY($1::text[])", [
            [...createdIncidentIds],
          ]);
        }
      } finally {
        await db.end().catch(() => {});
      }
    }
    await fixtures.cleanup();
  }
});
