import { Client } from "pg";
import { expect, test } from "@playwright/test";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { signUpAndHandleOnboarding } from "./onboarding";

const PASSWORD = "TestPass123!";
const testUsernames = new Set<string>();

test.beforeAll(() => {
  requireIsolatedTestDatabase("Line Map responsive browser check");
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

test("renders Line Map station cards at the selected responsive viewport", async ({
  page,
}) => {
  const username = uniqueTestId("e2e_line_map");
  testUsernames.add(username);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await signUpAndHandleOnboarding(page, username, PASSWORD);
  await expect(page.getByTestId("tab-run")).toHaveAttribute(
    "data-state",
    "active",
  );

  await page.locator("button").filter({ hasText: "Line Map" }).click();
  await expect(
    page.getByRole("heading", { name: "Production Line Map", exact: true }),
  ).toBeVisible();

  for (const station of [
    "Dough",
    "Sauce",
    "Press / Oven",
    "Frontline",
    "Freeze Tunnel",
    "Packaging",
    "Warehouse",
  ]) {
    const card = page.getByRole("button").filter({ hasText: station }).first();
    await expect(card).toBeVisible();
    await expect(card.getByText(/^(Running|Idle|Waiting|Stopped)$/)).toBeVisible();
  }
  expect(pageErrors).toEqual([]);
});
