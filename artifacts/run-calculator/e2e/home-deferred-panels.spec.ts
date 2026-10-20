import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
  uniqueTestId,
  DEFAULT_MANAGER_CAPABILITIES,
} from "./isolation";
import {
  dismissOnboardingIfPresent,
  signUpAndHandleOnboarding,
} from "./onboarding";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const testUsernames = new Set<string>();

async function openMore(page: Page): Promise<void> {
  const menu = page.getByRole("menu");
  if (await menu.isVisible().catch(() => false)) {
    await expect(menu).toBeHidden({ timeout: 5_000 });
  }
  await page.getByTitle("More").click();
  await expect(menu).toBeVisible();
}

async function promoteToManager(username: string): Promise<void> {
  const db = new Client({
    connectionString: requireIsolatedTestDatabase("promote Home panel fixture"),
  });
  try {
    await db.connect();
    await db.query(
      "UPDATE roles SET capabilities = $1::jsonb, updated_at = NOW() WHERE name = 'manager'",
      [JSON.stringify(DEFAULT_MANAGER_CAPABILITIES)],
    );
    const user = await db.query<{ id: string }>(
      "SELECT id FROM users WHERE username = $1",
      [username],
    );
    expect(user.rows).toHaveLength(1);
    await db.query(
      `INSERT INTO user_roles (user_id, role)
       VALUES ($1, 'manager')
       ON CONFLICT (user_id) DO UPDATE SET role = 'manager', updated_at = NOW()`,
      [user.rows[0].id],
    );
  } finally {
    await db.end().catch(() => {});
  }
}

test.beforeAll(() => {
  requireIsolatedTestDatabase("Home deferred panels browser check");
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

test("Home opens each deferred panel in the selected browser and viewport", async ({
  page,
}) => {
  const username = uniqueTestId("e2e_home_deferred");
  const pageErrors: string[] = [];
  testUsernames.add(username);
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: SIGNUP_CODE,
  });
  await dismissOnboardingIfPresent(page);
  await promoteToManager(username);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("tab-run")).toHaveAttribute(
    "data-state",
    "active",
  );

  await page.getByTestId("tab-warehouse").click();
  await expect(page.getByTestId("warehouse-page-heading")).toBeVisible();

  await openMore(page);
  await page.getByRole("menuitem", { name: "Setup", exact: true }).click();
  await expect(page.getByTestId("setup-header")).toBeVisible();

  await openMore(page);
  await page.getByRole("menuitem", { name: "Mix Plan", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Mix Plan", exact: true }),
  ).toBeVisible();

  await openMore(page);
  await page.getByRole("menuitem", { name: "Summary", exact: true }).click();
  await expect(page.getByTestId("summary-tools-header")).toBeVisible();
  expect(pageErrors).toEqual([]);
});
