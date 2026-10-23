import { expect, test } from "@playwright/test";
import { Client } from "pg";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
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
